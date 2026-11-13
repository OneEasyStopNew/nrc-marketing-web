import { HOME_PATH } from './returnTo';
import type { IdentityProvider } from './identity';

/**
 * Development sign-in against the real Marketing API while Cognito is not set
 * up. The API accepts a local development token; the Vite dev server adds it
 * to every proxied request (vite.config.ts, DEV_API_TOKEN in .env).
 *
 * The browser never holds the token: this provider has no access token, the
 * app sends no Authorization header, and nothing here can reach a build
 * (config/env.ts refuses this mode outside `npm run dev`).
 */

/** This tab chose to continue. Not a credential. */
const ACTIVE = 'nrc.dev.active';

const flag = {
  get: () => { try { return sessionStorage.getItem(ACTIVE) === '1'; } catch { return false; } },
  set: (on: boolean) => { try { if (on) sessionStorage.setItem(ACTIVE, '1'); else sessionStorage.removeItem(ACTIVE); } catch { /* storage blocked */ } },
};

export function createDevTokenProvider(): IdentityProvider {
  return {
    mode: 'devtoken',

    startSignIn(returnTo) {
      flag.set(true);
      window.location.assign(returnTo || HOME_PATH);
      return Promise.resolve();
    },

    completeSignIn() {
      flag.set(true);
      return Promise.resolve({ returnTo: HOME_PATH });
    },

    getAccessToken: () => null,
    hasSession: () => flag.get(),
    // The development token carries no name or email; the username from /me is shown.
    getProfile: () => ({}),
    // A refused token cannot be renewed from the browser: it is replaced in .env.
    refresh: () => Promise.resolve(null),

    clear() {
      flag.set(false);
      return Promise.resolve();
    },

    signOut() {
      flag.set(false);
      window.location.assign('/signed-out');
      return Promise.resolve();
    },
  };
}
