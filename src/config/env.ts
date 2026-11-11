/**
 * Build-time configuration (see .env.example). Every value is public: it is
 * compiled into the browser bundle, so nothing secret may be read here.
 */
export type AuthMode = 'cognito' | 'simulation';

const env = import.meta.env;
const trim = (v: string | undefined) => (v ?? '').trim();

/**
 * Explicit setting wins. Unset: simulation in `npm run dev` (dummy data, no
 * backend needed), Cognito in every build (which refuses simulation anyway).
 */
const requestedMode = trim(env.VITE_AUTH_MODE);
export const AUTH_MODE: AuthMode =
  requestedMode === 'simulation' || requestedMode === 'cognito' ? requestedMode : env.DEV ? 'simulation' : 'cognito';
/**
 * Build-time switch: simulation code (fake sign-in, fake API, local dummy
 * data) is compiled in only for `npm run dev` or an explicit
 * VITE_ALLOW_SIMULATION=true build. It is a constant expression, so a
 * production build drops those modules entirely instead of shipping them unused.
 */
export const SIMULATION_BUILD = import.meta.env.DEV || import.meta.env.VITE_ALLOW_SIMULATION === 'true';
export const API_BASE_URL = trim(env.VITE_API_BASE_URL).replace(/\/$/, '');
export const API_PREFIX = '/v1/marketing';

export interface CognitoConfig {
  /** OIDC issuer: https://cognito-idp.{region}.amazonaws.com/{userPoolId} */
  authority: string;
  clientId: string;
  /** Managed login domain, without a trailing slash. */
  domain: string;
  scopes: string;
}

export const COGNITO: CognitoConfig = {
  authority: `https://cognito-idp.${trim(env.VITE_COGNITO_REGION) || 'us-east-1'}.amazonaws.com/${trim(env.VITE_COGNITO_USER_POOL_ID)}`,
  clientId: trim(env.VITE_COGNITO_CLIENT_ID),
  domain: trim(env.VITE_COGNITO_DOMAIN).replace(/\/$/, ''),
  scopes: trim(env.VITE_COGNITO_SCOPES) || 'openid email profile marketing/api',
};

/** Where Cognito sends the user back to. Both must be registered on the app client. */
export const redirectUri = () => `${window.location.origin}/auth/callback`;
export const logoutUri = () => `${window.location.origin}/signed-out`;

/**
 * Returns what is wrong with the configuration, or null. The app shows this
 * instead of a blank page or a half-working sign-in.
 */
export function configProblem(): string | null {
  if (AUTH_MODE === 'simulation') {
    if (env.PROD && trim(env.VITE_ALLOW_SIMULATION) !== 'true') {
      return 'This build is set to simulation sign-in, which is turned off for production builds. Set VITE_AUTH_MODE=cognito.';
    }
    return null;
  }
  const missing = [
    !trim(env.VITE_COGNITO_USER_POOL_ID) && 'VITE_COGNITO_USER_POOL_ID',
    !COGNITO.clientId && 'VITE_COGNITO_CLIENT_ID',
    !COGNITO.domain && 'VITE_COGNITO_DOMAIN',
  ].filter(Boolean);
  if (missing.length) return `Sign-in is not configured. Missing: ${missing.join(', ')}.`;
  if (!COGNITO.domain.startsWith('https://')) return 'VITE_COGNITO_DOMAIN must start with https://.';
  return null;
}
