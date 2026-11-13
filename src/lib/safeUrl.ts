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

// The local S3 (SeaweedFS from the API's docker compose) serves plain http on this machine only.
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export interface ImageSrcRules {
  /** The simulation's `data:image/` placeholders. */
  allowDataImage: boolean;
  /** http links to localhost / 127.0.0.1, for a dev build talking to the local S3. */
  allowLocalHttp: boolean;
}

/**
 * An image source from the server (a signed `download_url`), or null when it must not be drawn.
 * Only https, plus what `rules` allows. Checked with `URL`, but the original text is returned:
 * re-serialising a signed link could re-encode its signature and break it.
 */
export function safeImageSrc(src: string, { allowDataImage, allowLocalHttp }: ImageSrcRules): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // Relative or not a URL: refuse rather than guess.
    return null;
  }
  if (url.protocol === 'https:') return src;
  if (allowDataImage && url.protocol === 'data:' && src.startsWith('data:image/')) return src;
  if (allowLocalHttp && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return src;
  return null;
}
