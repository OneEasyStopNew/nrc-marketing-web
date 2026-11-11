import { API_BASE_URL, API_PREFIX } from '@/config/env';
import { ApiError, type ApiErrorBody } from './errors';

/**
 * The only way the app talks to the Marketing API.
 *
 * - Sends the Cognito access token as a Bearer token. API Gateway's Cognito
 *   authorizer checks it; the API rechecks membership and resource scope.
 * - On 401 it asks the session for one refreshed token and retries once. The
 *   refresh itself is single-flight (see AuthProvider), so a burst of 401s
 *   produces one token request, not a storm. Still 401 → the session ends.
 * - 403 never signs anyone out: it is a permission answer, shown to the user.
 * - Never logs tokens, request bodies or signed URLs.
 */
export interface TokenSource {
  getAccessToken(): string | null;
  /** Resolves to a new access token, or null when the session cannot be renewed. */
  refresh(): Promise<string | null>;
  /** Called when a request is still unauthenticated after a refresh attempt. */
  onUnauthenticated(): void;
}

interface HttpConfig {
  baseUrl: string;
  fetch: typeof fetch;
  tokens: TokenSource | null;
  /** Selected tenant. The server verifies membership; the header only says which one the user chose. */
  tenantId: string | null;
}

const cfg: HttpConfig = {
  baseUrl: API_BASE_URL + API_PREFIX,
  fetch: (...args) => fetch(...args),
  tokens: null,
  tenantId: null,
};

export function configureHttp(patch: Partial<HttpConfig>) {
  Object.assign(cfg, patch);
}

export const setTenant = (tenantId: string | null) => configureHttp({ tenantId });

export const TENANT_HEADER = 'X-Tenant-Id';

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** ETag of the version being edited (If-Match). */
  etag?: string;
  /** Stable key for one intended operation; reuse it when retrying the same payload. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function url(path: string, query?: Query) {
  const qs = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return `${cfg.baseUrl}${path}${s ? `?${s}` : ''}`;
}

async function send(method: string, path: string, opts: RequestOptions, token: string | null) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cfg.tenantId) headers[TENANT_HEADER] = cfg.tenantId;
  if (opts.etag) headers['If-Match'] = opts.etag;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  try {
    return await cfg.fetch(url(path, opts.query), {
      method,
      headers,
      // Bearer tokens only; no ambient cookies are sent to the API domain.
      credentials: 'omit',
      signal: opts.signal,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0);
  }
}

async function read<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const payload: unknown = isJson ? await res.json().catch(() => undefined) : undefined;
  if (!res.ok) {
    const body = payload && typeof payload === 'object' && 'code' in payload ? (payload as ApiErrorBody) : undefined;
    throw new ApiError(res.status, body);
  }
  return payload as T;
}

/** A response body plus the headers the app acts on. */
export interface ApiResponse<T> {
  data: T;
  /** Version token for If-Match on the next edit. */
  etag: string | null;
  status: number;
}

export async function requestWithMeta<T>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const tokens = cfg.tokens;
  let res = await send(method, path, opts, tokens?.getAccessToken() ?? null);
  if (res.status === 401 && tokens) {
    const fresh = await tokens.refresh();
    if (fresh) res = await send(method, path, opts, fresh);
    if (res.status === 401) tokens.onUnauthenticated();
  }
  return { data: await read<T>(res), etag: res.headers.get('ETag'), status: res.status };
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  return (await requestWithMeta<T>(method, path, opts)).data;
}

export const http = {
  get: <T>(path: string, query?: Query, opts?: RequestOptions) => request<T>('GET', path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
