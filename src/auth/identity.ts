import type { Profile } from '@/api/session';

/**
 * The identity provider behind the session. Cognito in staging and
 * production; a labelled simulation for local development and tests. Both
 * follow the same redirect → callback → token-in-memory flow, so the rest of
 * the app cannot tell them apart.
 */
export interface IdentityProvider {
  readonly mode: 'cognito' | 'simulation' | 'devtoken';
  /** Leaves the app for the sign-in page. `returnTo` must already be validated. */
  startSignIn(returnTo: string, opts?: { identity?: string; forceLogin?: boolean }): Promise<void>;
  /** Completes the redirect on /auth/callback. Resolves to the stored return path. */
  completeSignIn(url: string): Promise<{ returnTo: unknown }>;
  getAccessToken(): string | null;
  /**
   * Development-token mode only: the session exists although the browser holds
   * no token (the dev server adds it to each request).
   */
  hasSession?(): boolean;
  /** Name and email from the ID token, for display only. */
  getProfile(): Profile;
  /** One refresh attempt with the in-memory refresh token. Null when it cannot renew. */
  refresh(): Promise<string | null>;
  /** Forgets tokens in this tab. */
  clear(): Promise<void>;
  /** Ends the provider session too, then lands on /signed-out. */
  signOut(): Promise<void>;
  /** Simulation only: test controls for the expiry paths. */
  readonly simulation?: SimulationControls;
}

export interface SimulationControls {
  /** The access token stops working; a refresh still succeeds. */
  expireAccessToken(): void;
  /** The access token stops working and the refresh is refused. */
  endSession(): void;
}

/** Why a callback failed, in words the sign-in page can show. */
export type CallbackFailure = 'cancelled' | 'consent' | 'expired_link' | 'failed'
  // The identity provider refused the account itself (the API never sees these users).
  | 'disabled' | 'mfa_required';

export class SignInError extends Error {
  constructor(readonly reason: CallbackFailure) {
    super(reason);
    this.name = 'SignInError';
  }
}
