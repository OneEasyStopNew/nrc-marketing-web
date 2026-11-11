import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp, http, setTenant, TENANT_HEADER, type TokenSource } from './http';
import { ApiError } from './errors';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake API that accepts exactly one token value at a time. */
function fakeApi(valid: { token: string }) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), headers });
    if (headers.get('Authorization') !== `Bearer ${valid.token}`) return json(401, { code: 'UNAUTHENTICATED', message: 'Sign in again.' });
    if (String(input).endsWith('/forbidden')) return json(403, { code: 'FORBIDDEN', message: 'Not your study.', request_id: 'req-1' });
    return json(200, { ok: true });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function tokens(initial: string, renewTo: string | null) {
  let current = initial;
  const source: TokenSource & { refreshCount: number; expired: number } = {
    refreshCount: 0,
    expired: 0,
    getAccessToken: () => current,
    refresh: vi.fn(async () => {
      source.refreshCount++;
      await new Promise((r) => setTimeout(r, 5));
      if (renewTo) current = renewTo;
      return renewTo;
    }),
    onUnauthenticated: () => { source.expired++; },
  };
  return source;
}

/** Same single-flight wrapper AuthProvider puts around the provider's refresh. */
function singleFlight(t: TokenSource): TokenSource {
  let inflight: Promise<string | null> | null = null;
  return { ...t, refresh: () => (inflight ??= t.refresh().finally(() => { inflight = null; })) };
}

/** Resolves to the ApiError a request fails with; fails the test if it succeeds. */
const failure = (p: Promise<unknown>) =>
  p.then(() => { throw new Error('expected the request to fail'); }, (e: ApiError) => e);

beforeEach(() => setTenant(null));

describe('http', () => {
  it('sends the access token as a Bearer header and the chosen tenant', async () => {
    const api = fakeApi({ token: 'a1' });
    configureHttp({ baseUrl: 'https://api.test/v1/marketing', fetch: api.fetch, tokens: tokens('a1', null) });
    setTenant('tenant-7');
    await expect(http.get('/me')).resolves.toEqual({ ok: true });
    expect(api.calls[0].url).toBe('https://api.test/v1/marketing/me');
    expect(api.calls[0].headers.get(TENANT_HEADER)).toBe('tenant-7');
  });

  it('refreshes once on 401 and retries the request', async () => {
    const api = fakeApi({ token: 'a2' });
    const t = tokens('a1', 'a2');
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    await expect(http.get('/context')).resolves.toEqual({ ok: true });
    expect(t.refreshCount).toBe(1);
    expect(api.calls).toHaveLength(2);
    expect(t.expired).toBe(0);
  });

  it('shares one refresh between concurrent 401s', async () => {
    const api = fakeApi({ token: 'a2' });
    const t = tokens('a1', 'a2');
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: singleFlight(t) });
    await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);
    expect(t.refreshCount).toBe(1);
  });

  it('ends the session when the refresh fails, without retrying in a loop', async () => {
    const api = fakeApi({ token: 'never' });
    const t = tokens('a1', null);
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    const err = await failure(http.get('/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('unauthenticated');
    expect(t.expired).toBe(1);
    expect(api.calls).toHaveLength(1);
  });

  it('treats 403 as a permission answer, not a session problem', async () => {
    const api = fakeApi({ token: 'a1' });
    const t = tokens('a1', null);
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    const err = await failure(http.get('/forbidden'));
    expect(err.kind).toBe('forbidden');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.requestId).toBe('req-1');
    expect(t.refreshCount).toBe(0);
    expect(t.expired).toBe(0);
  });

  it('reports a lost network as a retryable network error', async () => {
    configureHttp({ baseUrl: '', fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, tokens: tokens('a1', null) });
    const err = await failure(http.get('/me'));
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('does not put the token anywhere but the Authorization header', async () => {
    const api = fakeApi({ token: 'secret-token' });
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: tokens('secret-token', null) });
    await http.get('/me', { q: 'x' });
    expect(api.calls[0].url).not.toContain('secret-token');
  });
});
