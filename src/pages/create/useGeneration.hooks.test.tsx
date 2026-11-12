// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { configureHttp } from '@/api/http';
import { jobPath, useJob, useStartGeneration } from './useGeneration';

/**
 * The Generate hooks against a fake API (MSW): the double-click guard, key
 * reuse across retries, navigation on 202, leaving the page mid-request, and
 * reading a job. Pure helpers are covered in useGeneration.test.ts.
 */

const BASE = 'http://api.test/v1/marketing';
const JOB_ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const CREATIVE = { id: 'sim-cr-0001', version: 3 };

const navigate = vi.fn();
vi.mock('react-router-dom', async (actual) => ({ ...(await actual<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
vi.mock('@/auth/AuthProvider', () => ({ useSession: () => ({ context: { tenant: { tenant_id: 'tenant-1' } } }) }));

const jobBody = (patch: Record<string, unknown> = {}) => ({
  job_id: JOB_ID, kind: 'image_generation', creative_id: CREATIVE.id, creative_version: 3, state: 'RUNNING', stage: 'submitting',
  provider_request_id: null, failure_code: null, failure_message: null, result_asset_id: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, ...patch,
});

/** Idempotency-Key of every POST /creative-jobs the fake API received, in order. */
let keys: string[] = [];
let jobReads = 0;
/** The signal of the last request the app sent. */
let lastSignal: AbortSignal | null | undefined;
const server = setupServer();

/**
 * jsdom swaps in its own AbortSignal, which Node's fetch refuses ("Expected
 * signal to be an instance of AbortSignal"); browsers have only one. So the
 * signal is kept out of Node's fetch and its abort rejects the call, as a
 * browser's fetch would.
 */
const fetchHonouringJsdomSignal: typeof fetch = (input, init) => {
  const { signal, ...rest } = init ?? {};
  lastSignal = signal;
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason));
    fetch(input, rest).then(resolve, reject);
  });
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  configureHttp({ baseUrl: BASE, fetch: fetchHonouringJsdomSignal });
});
beforeEach(() => {
  keys = [];
  jobReads = 0;
  lastSignal = undefined;
  navigate.mockReset();
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

/** POST /creative-jobs answering each call with the next responder (the last one repeats). */
function startAnswers(...answers: (() => Response | Promise<Response>)[]) {
  server.use(mock.post(`${BASE}/creative-jobs`, ({ request }) => {
    keys.push(request.headers.get('Idempotency-Key') ?? '');
    return answers[Math.min(keys.length, answers.length) - 1]();
  }));
}
const accepted = () => HttpResponse.json({ job_id: JOB_ID, state: 'QUEUED' }, { status: 202 });
const refused = (status: number, code: string) => () => HttpResponse.json({ code, message: 'x' }, { status });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('useStartGeneration', () => {
  it('starts one job for a double click and opens its page', async () => {
    startAnswers(accepted);
    const { result } = renderHook(() => useStartGeneration(), { wrapper });
    await act(async () => { await Promise.all([result.current.start(CREATIVE), result.current.start(CREATIVE)]); });
    expect(keys).toHaveLength(1);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(jobPath(CREATIVE.id, JOB_ID), { replace: true });
    expect(result.current.starting).toBe(false);
  });

  it('resends the same key after a lost answer, so only one job can exist', async () => {
    startAnswers(() => HttpResponse.error(), accepted);
    const { result } = renderHook(() => useStartGeneration(), { wrapper });
    await act(() => result.current.start(CREATIVE));
    expect(result.current.problem?.sameCommand).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await act(() => result.current.start(CREATIVE));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('treats a timeout as a lost answer and resends the same key', async () => {
    startAnswers(accepted);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const { result } = renderHook(() => useStartGeneration(), { wrapper });
    await act(() => result.current.start(CREATIVE));
    expect(result.current.problem).toMatchObject({ sameCommand: true, title: 'No answer from NRC Marketing' });
    timeout.mockRestore();
    await act(() => result.current.start(CREATIVE));
    // The timed-out request never reached the server; the retry carries the key it would have used.
    expect(keys).toHaveLength(1);
    expect(navigate).toHaveBeenCalledOnce();
    expect(result.current.problem).toBeNull();
  });

  it('uses a new key after a refusal for good', async () => {
    startAnswers(refused(409, 'VALIDATION_NOT_PASSED'), accepted);
    const { result } = renderHook(() => useStartGeneration(), { wrapper });
    await act(() => result.current.start(CREATIVE));
    expect(result.current.problem?.sameCommand).toBe(false);
    await act(() => result.current.start(CREATIVE));
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('never opens a job whose id is not a UUID', async () => {
    startAnswers(() => HttpResponse.json({ job_id: '../../admin', state: 'QUEUED' }, { status: 202 }));
    const { result } = renderHook(() => useStartGeneration(), { wrapper });
    await act(() => result.current.start(CREATIVE));
    expect(navigate).not.toHaveBeenCalled();
    // The job may exist, so trying again resends the same key.
    expect(result.current.problem?.sameCommand).toBe(true);
  });

  it('does nothing when the answer arrives after the user left', async () => {
    let answer: (r: Response) => void = () => undefined;
    let received = false;
    server.use(mock.post(`${BASE}/creative-jobs`, () => {
      received = true;
      return new Promise<Response>((resolve) => { answer = resolve; });
    }));
    const { result, unmount } = renderHook(() => useStartGeneration(), { wrapper });
    let started: Promise<void> = Promise.resolve();
    act(() => { started = result.current.start(CREATIVE); });
    await waitFor(() => expect(received).toBe(true));
    unmount();
    answer(accepted());
    await started;
    expect(lastSignal?.aborted).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('useJob', () => {
  const readJob = (...answers: (() => Response)[]) => server.use(mock.get(`${BASE}/jobs/:id`, () => {
    jobReads++;
    return answers[Math.min(jobReads, answers.length) - 1]();
  }));

  it('reads nothing without a job in the address', () => {
    readJob(() => HttpResponse.json(jobBody()));
    const { result } = renderHook(() => useJob(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(jobReads).toBe(0);
  });

  it('answers not found for an id that is not a UUID, without a request', async () => {
    readJob(() => HttpResponse.json(jobBody()));
    const { result } = renderHook(() => useJob('sim-gen-1a2b3c4d'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ kind: 'not_found' });
    expect(jobReads).toBe(0);
  });

  it('shows a state this build does not know as UNKNOWN', async () => {
    readJob(() => HttpResponse.json(jobBody({ state: 'PAUSED_BY_OPERATOR' })));
    const { result } = renderHook(() => useJob(JOB_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.state).toBe('UNKNOWN'));
  });

  it('polls until the job is saved, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      readJob(() => HttpResponse.json(jobBody()), () => HttpResponse.json(jobBody({ state: 'SUCCEEDED', stage: 'stored' })));
      const { result } = renderHook(() => useJob(JOB_ID), { wrapper });
      await waitFor(() => expect(result.current.data?.state).toBe('RUNNING'));
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      await waitFor(() => expect(result.current.data?.state).toBe('SUCCEEDED'));
      const reads = jobReads;
      await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
      expect(jobReads).toBe(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([[404, 'not_found'], [403, 'forbidden']] as const)('reports %i as %s and stops', async (status, kind) => {
    readJob(refused(status, kind.toUpperCase()));
    const { result } = renderHook(() => useJob(JOB_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ kind });
    expect(jobReads).toBe(1);
  });
});
