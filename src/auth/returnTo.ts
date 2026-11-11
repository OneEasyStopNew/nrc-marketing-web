/**
 * Where to send a user after sign-in. Only same-origin application paths under
 * an allowed prefix are kept; anything else falls back to the home page. The
 * query string and hash are dropped so nothing typed into a form or a token
 * fragment rides along through the identity provider and back.
 */
export const HOME_PATH = '/marketing';
const ALLOWED_PREFIXES = ['/marketing'];

export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return HOME_PATH;
  let path: string;
  try {
    const base = 'https://app.invalid';
    const u = new URL(raw, base);
    if (u.origin !== base) return HOME_PATH;
    path = u.pathname;
  } catch {
    return HOME_PATH;
  }
  const allowed = ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
  return allowed ? path.replace(/\/+$/, '') || HOME_PATH : HOME_PATH;
}
