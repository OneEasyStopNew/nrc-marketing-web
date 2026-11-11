import { ErrorResponse, InMemoryWebStorage, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { COGNITO, logoutUri, redirectUri } from '@/config/env';
import { SignInError, type CallbackFailure, type IdentityProvider } from './identity';

/**
 * Cognito managed login with authorization code + PKCE (public client, no
 * secret). Passwords, MFA, federation and password reset all happen on the
 * Cognito pages; this app never sees a password.
 *
 * Storage:
 * - Tokens (access, id, refresh) live in memory only. A reload forgets them and
 *   the user goes back through Cognito, which signs them straight in while
 *   their Cognito session is still valid.
 * - The PKCE verifier and state for the redirect in flight live in
 *   sessionStorage, because they must survive the round trip. oidc-client-ts
 *   removes them when the callback is processed.
 */
export function createCognitoProvider(): IdentityProvider {
  const manager = new UserManager({
    authority: COGNITO.authority,
    client_id: COGNITO.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: COGNITO.scopes,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage, prefix: 'nrc.oidc.' }),
    metadataSeed: { revocation_endpoint: `${COGNITO.domain}/oauth2/revoke` },
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
  });

  // Mirrors the in-memory user so getAccessToken() can stay synchronous.
  let current: User | null = null;
  manager.events.addUserLoaded((u) => { current = u; });
  manager.events.addUserUnloaded(() => { current = null; });

  return {
    mode: 'cognito',

    async startSignIn(returnTo, opts) {
      await manager.signinRedirect({ state: { returnTo }, prompt: opts?.forceLogin ? 'login' : undefined });
    },

    async completeSignIn(url) {
      try {
        const user = await manager.signinCallback(url);
        return { returnTo: (user?.state as { returnTo?: unknown } | undefined)?.returnTo };
      } catch (e) {
        throw new SignInError(callbackFailure(e));
      }
    },

    getAccessToken: () => current?.access_token ?? null,

    getProfile: () => {
      const p = current?.profile;
      if (!p) return {};
      const full = [p.given_name, p.family_name].filter(Boolean).join(' ');
      return { name: p.name || full || undefined, email: p.email };
    },

    async refresh() {
      const user = await manager.getUser();
      if (!user?.refresh_token) return null;
      try {
        const renewed = await manager.signinSilent();
        return renewed?.access_token ?? null;
      } catch {
        return null;
      }
    },

    async clear() {
      current = null;
      await manager.removeUser();
    },

    async signOut() {
      // Revoke the refresh token so it cannot be used again, then end the Cognito session.
      await manager.revokeTokens(['refresh_token']).catch(() => undefined);
      current = null;
      await manager.removeUser();
      const q = new URLSearchParams({ client_id: COGNITO.clientId, logout_uri: logoutUri() });
      window.location.assign(`${COGNITO.domain}/logout?${q}`);
    },
  };
}

function callbackFailure(e: unknown): CallbackFailure {
  if (e instanceof ErrorResponse) {
    // Cognito reports a refused account through the redirect; the wording is in error_description.
    const why = e.error_description ?? '';
    if (/disabled/i.test(why)) return 'disabled';
    if (/mfa|multi-factor|two-step|software token/i.test(why)) return 'mfa_required';
    if (e.error === 'access_denied') return 'cancelled';
    if (e.error === 'consent_required' || e.error === 'interaction_required' || e.error === 'login_required') return 'consent';
    return 'failed';
  }
  // No matching state: the link was used already, opened in another tab, or is stale.
  if (e instanceof Error && /state/i.test(e.message)) return 'expired_link';
  return 'failed';
}
