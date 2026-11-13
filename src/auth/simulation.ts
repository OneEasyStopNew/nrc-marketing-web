import { mockServer } from '@/mocks/server';
import { loadMockData } from '@/mocks/load';
import type { Profile } from '@/api/session';
import { SignInError, type IdentityProvider } from './identity';

/**
 * Simulation sign-in for local development and automated tests. It walks the
 * same redirect → /auth/callback → in-memory token path as Cognito. Identities
 * come from mocks/data.ts; the fake API (mocks/api.ts) accepts the tokens
 * issued here. A dummy user with `signInError` is refused on the "sign-in
 * page" the way Cognito refuses a disabled or MFA-less account.
 *
 * Everything here is labelled "simulation" on screen. A production build
 * refuses this mode (config/env.ts). Never use it as live evidence.
 */

const PENDING = 'nrc.sim.pending';

/** The error_description Cognito sends back for each refusal (to confirm with the identity team). */
const REFUSAL: Record<string, string> = {
  disabled: 'User is disabled.',
  mfa_required: 'Multi-factor authentication is required.',
};

export function createSimulationProvider(): IdentityProvider {
  let access: string | null = null;
  let userId: string | null = null;
  let profile: Profile = {};

  const clear = (): Promise<void> => {
    mockServer.revokeToken(access);
    access = null;
    userId = null;
    profile = {};
    return Promise.resolve();
  };

  return {
    mode: 'simulation',

    async startSignIn(returnTo, opts) {
      const state = crypto.randomUUID();
      const id = opts?.identity ?? 'creator';
      sessionStorage.setItem(PENDING, JSON.stringify({ state, returnTo, userId: id }));
      const user = (await loadMockData())?.USERS.find((u) => u.id === id);
      const q = user?.signInError
        ? new URLSearchParams({ error: 'access_denied', error_description: REFUSAL[user.signInError], state })
        : new URLSearchParams({ code: 'sim', state });
      window.location.assign(`/auth/callback?${q}`);
    },

    async completeSignIn(url) {
      const params = new URL(url).searchParams;
      const raw = sessionStorage.getItem(PENDING);
      sessionStorage.removeItem(PENDING);
      const why = params.get('error_description') ?? '';
      if (/disabled/i.test(why)) throw new SignInError('disabled');
      if (/multi-factor/i.test(why)) throw new SignInError('mfa_required');
      if (params.get('error') === 'access_denied') throw new SignInError('cancelled');
      const pending = raw ? (JSON.parse(raw) as { state: string; returnTo: string; userId: string }) : null;
      if (pending?.state !== params.get('state')) throw new SignInError('expired_link');
      userId = pending.userId;
      const user = (await loadMockData())?.USERS.find((u) => u.id === userId);
      profile = { name: user?.display_name, email: user?.email };
      mockServer.refreshAllowed = true;
      access = mockServer.issueToken(userId);
      return { returnTo: pending.returnTo };
    },

    getAccessToken: () => access,
    getProfile: () => profile,

    async refresh() {
      await new Promise((r) => setTimeout(r, 150));
      if (!userId || !mockServer.refreshAllowed) return null;
      mockServer.revokeToken(access);
      access = mockServer.issueToken(userId);
      return access;
    },

    clear,

    async signOut() {
      await clear();
      window.location.assign('/signed-out');
    },

    simulation: {
      expireAccessToken: () => mockServer.revokeToken(access),
      endSession: () => { mockServer.revokeToken(access); mockServer.refreshAllowed = false; },
    },
  };
}
