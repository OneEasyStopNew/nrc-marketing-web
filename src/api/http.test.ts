import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { configureHttp, http, setTenant, TENANT_HEADER, type TokenSource } from './http';
import { ApiError } from './errors';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake API that accepts exactly one token value at a time. */
function fakeApi(valid: { token: string }) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, headers });
    if (headers.get('Authorization') !== `Bearer ${valid.token}`) return Promise.resolve(json(401, { code: 'UNAUTHENTICATED', message: 'Sign in again.' }));
    if (url.endsWith('/forbidden')) return Promise.resolve(json(403, { code: 'FORBIDDEN', message: 'Not your study.', request_id: 'req-1' }));
    return Promise.resolve(json(200, { ok: true }));
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

/** The body the fake API returns on success. */
const Ok = z.object({ ok: z.literal(true) });

describe('http', () => {
  it('sends the access token as a Bearer header and the chosen tenant', async () => {
    const api = fakeApi({ token: 'a1' });
    configureHttp({ baseUrl: 'https://api.test/v1/marketing', fetch: api.fetch, tokens: tokens('a1', null) });
    setTenant('tenant-7');
    await expect(http.get('/me', Ok)).resolves.toEqual({ ok: true });
    expect(api.calls[0].url).toBe('https://api.test/v1/marketing/me');
    expect(api.calls[0].headers.get(TENANT_HEADER)).toBe('tenant-7');
  });

  it('refreshes once on 401 and retries the request', async () => {
    const api = fakeApi({ token: 'a2' });
    const t = tokens('a1', 'a2');
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    await expect(http.get('/context', Ok)).resolves.toEqual({ ok: true });
    expect(t.refreshCount).toBe(1);
    expect(api.calls).toHaveLength(2);
    expect(t.expired).toBe(0);
  });

  it('shares one refresh between concurrent 401s', async () => {
    const api = fakeApi({ token: 'a2' });
    const t = tokens('a1', 'a2');
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: singleFlight(t) });
    await Promise.all([http.get('/a', Ok), http.get('/b', Ok), http.get('/c', Ok)]);
    expect(t.refreshCount).toBe(1);
  });

  it('ends the session when the refresh fails, without retrying in a loop', async () => {
    const api = fakeApi({ token: 'never' });
    const t = tokens('a1', null);
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    const err = await failure(http.get('/me', Ok));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('unauthenticated');
    expect(t.expired).toBe(1);
    expect(api.calls).toHaveLength(1);
  });

  it('treats 403 as a permission answer, not a session problem', async () => {
    const api = fakeApi({ token: 'a1' });
    const t = tokens('a1', null);
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: t });
    const err = await failure(http.get('/forbidden', Ok));
    expect(err.kind).toBe('forbidden');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.requestId).toBe('req-1');
    expect(t.refreshCount).toBe(0);
    expect(t.expired).toBe(0);
  });

  it('reports a lost network as a retryable network error', async () => {
    configureHttp({ baseUrl: '', fetch: () => Promise.reject(new TypeError('Failed to fetch')), tokens: tokens('a1', null) });
    const err = await failure(http.get('/me', Ok));
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('does not put the token anywhere but the Authorization header', async () => {
    const api = fakeApi({ token: 'secret-token' });
    configureHttp({ baseUrl: '', fetch: api.fetch, tokens: tokens('secret-token', null) });
    await http.get('/me', Ok, { query: { q: 'x' } });
    expect(api.calls[0].url).not.toContain('secret-token');
  });

  it('fails a body that does not match its schema as CONTRACT_MISMATCH, without echoing its values', async () => {
    const body = { id: 'c-1', state: 'TELEPORTED', secret_note: 'do not log me' };
    configureHttp({ baseUrl: '', fetch: () => Promise.resolve(json(200, body)), tokens: tokens('a1', null) });
    const Run = z.object({ id: z.string(), state: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED']) });
    const err = await failure(http.get('/validations/c-1', Run));
    expect(err.kind).toBe('contract');
    expect(err.code).toBe('CONTRACT_MISMATCH');
    expect(err.retryable).toBe(false);
    // The cause names the request and the field, never the response's values.
    const cause = String((err.cause as Error).message);
    expect(cause).toContain('GET /validations/c-1');
    expect(cause).toContain('state');
    expect(cause).not.toContain('TELEPORTED');
    expect(cause).not.toContain('do not log me');
  });

  it('keeps fields the app does not know yet out of the result instead of failing', async () => {
    configureHttp({ baseUrl: '', fetch: () => Promise.resolve(json(200, { ok: true, added_later: 1 })), tokens: tokens('a1', null) });
    await expect(http.get('/me', Ok)).resolves.toEqual({ ok: true });
  });
});
