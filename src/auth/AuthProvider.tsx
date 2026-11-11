import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AUTH_MODE, configProblem, SIMULATION_BUILD, type AuthMode } from '@/config/env';
import { configureHttp, setTenant } from '@/api/http';
import { isApiError } from '@/api/errors';
import { SESSION_CODES, sessionApi, type Capability, type MarketingContext, type Me } from '@/api/session';
import { SignInError, type CallbackFailure, type IdentityProvider, type SimulationControls } from './identity';
import { HOME_PATH, safeReturnTo } from './returnTo';

/**
 * The session, as one explicit state machine. Every state has its own screen;
 * nothing renders protected content until the server has answered /me and
 * /context for the chosen tenant.
 *
 *   booting ─┬─ /auth/callback ──► loading ─┬─► ready
 *            ├─ token in memory ──► loading ├─► choose_tenant ──► loading
 *            └─ otherwise ──► signed_out    ├─► blocked (disabled, no access, MFA)
 *                                           └─► failed (network / server, retry)
 *   any ── 401 after one refresh ──► signed_out (expired)
 */
export type SignedOutReason = 'none' | 'signed_out' | 'expired' | Exclude<CallbackFailure, 'disabled' | 'mfa_required'>;
export type BlockedReason = 'disabled' | 'no_access' | 'mfa_required';

export type AuthStatus =
  | { kind: 'booting' }
  | { kind: 'misconfigured'; message: string }
  | { kind: 'signed_out'; reason: SignedOutReason }
  | { kind: 'loading' }
  | { kind: 'choose_tenant'; me: Me; notice?: string }
  | { kind: 'ready'; me: Me; context: MarketingContext }
  | { kind: 'blocked'; reason: BlockedReason }
  | { kind: 'failed'; message: string; requestId?: string; retryable: boolean };

interface AuthValue {
  status: AuthStatus;
  mode: AuthMode;
  signIn: (opts?: { identity?: string; forceLogin?: boolean }) => void;
  signOut: () => void;
  chooseTenant: (tenantId: string) => void;
  /** Back to the organisation chooser; drops every cached answer from the current tenant. */
  switchTenant: () => void;
  retry: () => void;
  /** Usability only. The API rechecks every request. */
  can: (capability: Capability) => boolean;
  simulation?: SimulationControls;
}

const Ctx = createContext<AuthValue | null>(null);

/** sessionStorage keys. Neither holds a credential. */
const ACTIVE = 'nrc.auth.active'; // this tab completed a sign-in; a reload may go straight back through Cognito
const AUTO_AT = 'nrc.auth.autoAt'; // time of the last automatic redirect, to stop loops
const TENANT = 'nrc.auth.tenant'; // last chosen tenant id
const CHANNEL = 'nrc-auth';

const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
};

async function createProvider(): Promise<IdentityProvider> {
  if (AUTH_MODE === 'simulation' && SIMULATION_BUILD) {
    const [sim, mock] = await Promise.all([import('./simulation'), import('@/mocks/api')]);
    configureHttp({ fetch: mock.mockFetch });
    return sim.createSimulationProvider();
  }
  const { createCognitoProvider } = await import('./cognito');
  return createCognitoProvider();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<AuthStatus>({ kind: 'booting' });
  const provider = useRef<IdentityProvider | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const meRef = useRef<Me | null>(null);
  const booted = useRef(false);
  // One channel object per tab: a BroadcastChannel never receives its own messages,
  // so signing out here does not also run this tab's "signed out elsewhere" handler.
  const channel = useRef<BroadcastChannel | null>(null);

  /** Forget everything tenant-scoped held in this tab. */
  const dropTenantData = useCallback(() => {
    setTenant(null);
    qc.cancelQueries();
    qc.clear();
  }, [qc]);

  const expire = useCallback(() => {
    void provider.current?.clear();
    dropTenantData();
    meRef.current = null;
    setStatus((s) => (s.kind === 'signed_out' ? s : { kind: 'signed_out', reason: 'expired' }));
  }, [dropTenantData]);

  const fail = useCallback((e: unknown) => {
    if (isApiError(e)) {
      if (e.kind === 'unauthenticated') return expire();
      if (e.kind === 'forbidden') return setStatus({ kind: 'blocked', reason: 'no_access' });
      return setStatus({ kind: 'failed', message: e.message, requestId: e.requestId, retryable: e.retryable });
    }
    setStatus({ kind: 'failed', message: 'Something failed while opening Marketing. Nothing was changed.', retryable: true });
  }, [expire]);

  const enterTenant = useCallback(async (me: Me, tenantId: string) => {
    setStatus({ kind: 'loading' });
    dropTenantData();
    setTenant(tenantId);
    try {
      const context = await sessionApi.context();
      store.set(TENANT, tenantId);
      setStatus({ kind: 'ready', me, context });
    } catch (e) {
      if (isApiError(e) && e.code === SESSION_CODES.forbidden) {
        setTenant(null);
        store.del(TENANT);
        setStatus({ kind: 'choose_tenant', me, notice: 'You no longer have access to that organisation. Choose another.' });
        return;
      }
      fail(e);
    }
  }, [dropTenantData, fail]);

  const loadSession = useCallback(async () => {
    setStatus({ kind: 'loading' });
    let me: Me;
    try {
      me = await sessionApi.me(provider.current?.getProfile() ?? {});
    } catch (e) {
      return fail(e);
    }
    meRef.current = me;
    if (!me.tenants.length) return setStatus({ kind: 'blocked', reason: 'no_access' });
    const remembered = store.get(TENANT);
    const pick = me.tenants.length === 1 ? me.tenants[0] : me.tenants.find((t) => t.tenant_id === remembered);
    if (pick) return enterTenant(me, pick.tenant_id);
    setStatus({ kind: 'choose_tenant', me });
  }, [enterTenant, fail]);

  // Boot once (StrictMode runs effects twice in development; the callback must not be processed twice).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const problem = configProblem();
    if (problem) { setStatus({ kind: 'misconfigured', message: problem }); return; }

    void (async () => {
      const p = await createProvider();
      provider.current = p;
      configureHttp({
        tokens: {
          getAccessToken: () => p.getAccessToken(),
          // Single flight: concurrent 401s share one refresh.
          refresh: () => (refreshing.current ??= p.refresh().finally(() => { refreshing.current = null; })),
          onUnauthenticated: expire,
        },
      });

      const path = window.location.pathname;
      if (path === '/auth/callback') {
        try {
          const { returnTo } = await p.completeSignIn(window.location.href);
          store.set(ACTIVE, '1');
          store.del(AUTO_AT);
          // Replace the callback URL so the code and state leave the address bar and history.
          navigate(safeReturnTo(returnTo), { replace: true });
          await loadSession();
        } catch (e) {
          navigate(HOME_PATH, { replace: true });
          const reason = e instanceof SignInError ? e.reason : 'failed';
          // Accounts the identity provider refuses get their own screen, not a retry prompt.
          if (reason === 'disabled' || reason === 'mfa_required') setStatus({ kind: 'blocked', reason });
          else setStatus({ kind: 'signed_out', reason });
        }
        return;
      }
      if (path === '/signed-out') { setStatus({ kind: 'signed_out', reason: 'signed_out' }); return; }
      if (p.getAccessToken()) { await loadSession(); return; }

      // Reload in a tab that was signed in: tokens were in memory, so go back
      // through Cognito once. Its own session signs the user straight in.
      const lastAuto = Number(store.get(AUTO_AT) ?? 0);
      if (p.mode === 'cognito' && store.get(ACTIVE) && Date.now() - lastAuto > 30_000) {
        store.set(AUTO_AT, String(Date.now()));
        await p.startSignIn(safeReturnTo(path));
        return;
      }
      setStatus({ kind: 'signed_out', reason: 'none' });
    })();
  }, [expire, loadSession, navigate]);

  // Signing out in one tab signs out every tab of this browser.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (e) => {
      if (e.data !== 'signed_out') return;
      void provider.current?.clear();
      dropTenantData();
      store.del(ACTIVE);
      store.del(TENANT);
      setStatus({ kind: 'signed_out', reason: 'signed_out' });
    };
    return () => { ch.close(); channel.current = null; };
  }, [dropTenantData]);

  const signIn = useCallback((opts?: { identity?: string; forceLogin?: boolean }) => {
    const p = provider.current;
    if (!p) return;
    const from = location.pathname === '/signed-out' ? HOME_PATH : location.pathname;
    void p.startSignIn(safeReturnTo(from), opts);
  }, [location.pathname]);

  const signOut = useCallback(() => {
    dropTenantData();
    store.del(ACTIVE);
    store.del(TENANT);
    store.del(AUTO_AT);
    channel.current?.postMessage('signed_out');
    setStatus({ kind: 'loading' });
    void provider.current?.signOut();
  }, [dropTenantData]);

  const chooseTenant = useCallback((tenantId: string) => {
    const me = meRef.current;
    if (me) void enterTenant(me, tenantId);
  }, [enterTenant]);

  const switchTenant = useCallback(() => {
    const me = meRef.current;
    if (!me) return;
    dropTenantData();
    store.del(TENANT);
    navigate(HOME_PATH);
    setStatus({ kind: 'choose_tenant', me });
  }, [dropTenantData, navigate]);

  const retry = useCallback(() => { void loadSession(); }, [loadSession]);

  const value = useMemo<AuthValue>(() => ({
    status,
    mode: AUTH_MODE,
    signIn,
    signOut,
    chooseTenant,
    switchTenant,
    retry,
    can: (c) => status.kind === 'ready' && status.context.capabilities.includes(c),
    simulation: provider.current?.simulation,
  }), [status, signIn, signOut, chooseTenant, switchTenant, retry]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}

/** The ready session. Only call inside the signed-in shell. */
export function useSession() {
  const { status } = useAuth();
  if (status.kind !== 'ready') throw new Error('useSession needs a ready session');
  return status;
}
