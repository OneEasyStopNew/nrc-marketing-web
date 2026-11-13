// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Creative } from '@/api/creatives';
import { configureHttp } from '@/api/http';
import { SLOW_POLL_MS } from './generationRules';
import { useGeneration } from './useDraftChecks';

/**
 * The Generate hook against a fake API (MSW): the double-click guard, key
 * reuse across retries, leaving the page mid-request, the stored job and how
 * it is read. Pure rules are covered in generationRules.test.ts.
 */

const BASE = 'http://api.test/v1/marketing';
const TENANT = 'tenant-1';
const JOB_ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const STORE_KEY = `nrc.job.${TENANT}.sim-cr-0001`;

const toast = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({ useSession: () => ({ context: { tenant: { tenant_id: TENANT } } }) }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }));
// The image lookups are not under test; they answer "no image yet".
vi.mock('@/api/assets', () => ({
  useAsset: () => ({ data: undefined, isPending: false }),
  useDraftExport: () => ({ data: undefined, isPending: false }),
}));

// Test fixture: the hook reads only id, version and asset_id of a draft.
const CREATIVE = { id: 'sim-cr-0001', version: 3, asset_id: null } as unknown as Creative;

const jobBody = (patch: Record<string, unknown> = {}) => ({
  job_id: JOB_ID,
  kind: 'image_generation',
  creative_id: CREATIVE.id,
  creative_version: 3,
  state: 'RUNNING',
  stage: 'submitting',
  provider_request_id: null,
  failure_code: null,
  failure_message: null,
  result_asset_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  completed_at: null,
  ...patch,
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
    if (signal?.aborted) return reject(signal.reason as Error);
    signal?.addEventListener('abort', () => reject(signal.reason as Error));
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
  toast.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

/** POST /creative-jobs answering each call with the next responder (the last one repeats). */
function startAnswers(...answers: (() => Response | Promise<Response>)[]) {
  server.use(
    mock.post(`${BASE}/creative-jobs`, ({ request }) => {
      keys.push(request.headers.get('Idempotency-Key') ?? '');
      return answers[Math.min(keys.length, answers.length) - 1]();
    }),
  );
}
/** GET /jobs/:id answering each read with the next responder (the last one repeats). */
function readAnswers(...answers: (() => Response)[]) {
  server.use(
    mock.get(`${BASE}/jobs/:id`, () => {
      jobReads++;
      return answers[Math.min(jobReads, answers.length) - 1]();
    }),
  );
}
const accepted = () => HttpResponse.json({ job_id: JOB_ID, state: 'QUEUED' }, { status: 202 });
const refused = (status: number, code: string) => () => HttpResponse.json({ code, message: 'Server says why.' }, { status });
const storedJob = (): unknown => JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const renderGeneration = () => renderHook(() => useGeneration(CREATIVE), { wrapper });

describe('useGeneration: starting a job', () => {
  it('starts one job for a double click and remembers it for this tab', async () => {
    startAnswers(accepted);
    readAnswers(() => HttpResponse.json(jobBody()));
    const { result } = renderGeneration();
    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });
    expect(keys).toHaveLength(1);
    expect(storedJob()).toEqual({ job_id: JOB_ID, version: 3 });
    await waitFor(() => expect(result.current.active).toBe(true));
  });

  it('resends the same key after a lost answer, and says the request may have arrived', async () => {
    startAnswers(() => HttpResponse.error(), accepted);
    readAnswers(() => HttpResponse.json(jobBody()));
    const { result } = renderGeneration();
    await act(() => result.current.start());
    expect(toast).toHaveBeenCalledWith('No answer from NRC Marketing', 'waiting', expect.stringMatching(/may have reached/));
    await act(() => result.current.start());
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(storedJob()).toEqual({ job_id: JOB_ID, version: 3 });
  });

  it('treats a timeout as a lost answer and resends the same key', async () => {
    startAnswers(accepted);
    readAnswers(() => HttpResponse.json(jobBody()));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const { result } = renderGeneration();
    await act(() => result.current.start());
    expect(toast).toHaveBeenCalledWith('No answer from NRC Marketing', 'waiting', expect.any(String));
    timeout.mockRestore();
    const sentBefore = keys.length;
    await act(() => result.current.start());
    // The timed-out request never reached the server here; the retry carries the key it would have used.
    expect(keys).toHaveLength(sentBefore + 1);
    expect(storedJob()).toEqual({ job_id: JOB_ID, version: 3 });
  });

  it('uses a new key after a refusal for good', async () => {
    startAnswers(refused(409, 'VALIDATION_NOT_PASSED'), accepted);
    readAnswers(() => HttpResponse.json(jobBody()));
    const { result } = renderGeneration();
    await act(() => result.current.start());
    expect(toast).toHaveBeenCalledWith('This version cannot be generated yet', 'blocked', 'Server says why.');
    await act(() => result.current.start());
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('never stores a job whose id is not a UUID, and keeps the key because the job may exist', async () => {
    startAnswers(() => HttpResponse.json({ job_id: '../../admin', state: 'QUEUED' }, { status: 202 }));
    const { result } = renderGeneration();
    await act(() => result.current.start());
    expect(storedJob()).toBeNull();
    expect(toast).toHaveBeenCalledWith('Generation may have started', 'waiting', expect.any(String));
    await act(() => result.current.start());
    expect(keys[1]).toBe(keys[0]);
  });

  it('does nothing when the answer arrives after the user left', async () => {
    let answer: (r: Response) => void = () => undefined;
    let received = false;
    server.use(
      mock.post(`${BASE}/creative-jobs`, () => {
        received = true;
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      }),
    );
    const { result, unmount } = renderGeneration();
    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(received).toBe(true));
    unmount();
    answer(accepted());
    await started;
    expect(lastSignal?.aborted).toBe(true);
    expect(storedJob()).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('useGeneration: reading the job', () => {
  it('ignores a stored job id that is not a UUID, without a request', () => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ job_id: '../admin', version: 3 }));
    readAnswers(() => HttpResponse.json(jobBody()));
    const { result } = renderGeneration();
    expect(result.current.job).toBeUndefined();
    expect(jobReads).toBe(0);
  });

  it('shows a state this build does not know as UNKNOWN, keeps Generate off and polls slowly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ job_id: JOB_ID, version: 3 }));
    readAnswers(() => HttpResponse.json(jobBody({ state: 'PAUSED_BY_OPERATOR' })));
    startAnswers(accepted);
    const { result } = renderGeneration();
    await waitFor(() => expect(result.current.job?.state).toBe('UNKNOWN'));
    expect(result.current.unsettled).toBe(true);
    await act(() => result.current.start());
    expect(keys).toHaveLength(0);
    const reads = jobReads;
    await act(() => vi.advanceTimersByTimeAsync(SLOW_POLL_MS + 100));
    await waitFor(() => expect(jobReads).toBeGreaterThan(reads));
  });

  it('polls until the job is saved, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ job_id: JOB_ID, version: 3 }));
    readAnswers(
      () => HttpResponse.json(jobBody()),
      () => HttpResponse.json(jobBody({ state: 'SUCCEEDED', stage: 'stored' })),
    );
    const { result } = renderGeneration();
    await waitFor(() => expect(result.current.active).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(result.current.job?.state).toBe('SUCCEEDED'));
    expect(result.current.active).toBe(false);
    const reads = jobReads;
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(jobReads).toBe(reads);
  });

  it('forgets a job the API no longer knows', async () => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ job_id: JOB_ID, version: 3 }));
    readAnswers(refused(404, 'NOT_FOUND'));
    const { result } = renderGeneration();
    await waitFor(() => expect(jobReads).toBe(1));
    expect(result.current.job).toBeUndefined();
    expect(result.current.active).toBe(false);
  });
});
