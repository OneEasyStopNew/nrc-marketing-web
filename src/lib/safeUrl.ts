const SAFE_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:', 'tel:']);

/**
 * An external link destination, normalised, or null when it must not become a
 * link. Only http(s), mailto and tel are allowed, so `javascript:` and `data:`
 * URLs from the server (contact URLs, permalinks, activity links) can never
 * run script when clicked. Parsed with `URL`, never a regex (JS-33, JS-58).
 * Relative and protocol-relative values (`//host`) are refused here: in-app
 * paths are routed by the caller before this is reached.
 */
export function safeExternalHref(dest: string): string | null {
  try {
    const url = new URL(dest);
    return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    // Not an absolute URL: refuse rather than guess.
    return null;
  }
}

/**
 * An in-app path for the router: starts with one `/` (not `//host`, which
 * leaves the site) and has no backslash anywhere. Browsers read `/\host` as
 * another site; React Router 6 has an open-redirect advisory for exactly that
 * (GHSA-wrjc-x8rr-h8h6), so such paths never reach a router link.
 */
export const isAppPath = (dest: string): boolean => dest.startsWith('/') && !dest.startsWith('//') && !dest.includes('\\');
