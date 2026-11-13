import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { configureHttp } from './http';
import {
  failureText,
  isJobDone,
  isJobStage,
  isJobUnsettled,
  isUuid,
  JOB_STAGES,
  JOB_STEPS,
  jobKeys,
  jobProgress,
  jobsApi,
  newJobKey,
  type JobState,
} from './jobs';

const JOB_ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';

/** A JobRead as the backend sends it. */
const jobBody = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  job_id: JOB_ID,
  kind: 'image_generation',
  creative_id: 'sim-cr-0001',
  creative_version: 3,
  state: 'RUNNING',
  stage: 'submitting',
  provider_request_id: null,
  failure_code: null,
  failure_message: null,
  result_asset_id: null,
  created_at: '2026-11-12T09:00:00Z',
  updated_at: '2026-11-12T09:00:01Z',
  completed_at: null,
  ...patch,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('job states', () => {
  it('stops polling only on the backend terminal states', () => {
    const done: JobState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
    const notDone: JobState[] = ['QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'UNKNOWN', 'NEEDS_REVIEW', 'CANCEL_REQUESTED'];
    expect(done.every(isJobDone)).toBe(true);
    expect(notDone.some(isJobDone)).toBe(false);
  });

  it('treats UNKNOWN and NEEDS_REVIEW as unsettled, not done', () => {
    expect(isJobUnsettled('UNKNOWN')).toBe(true);
    expect(isJobUnsettled('NEEDS_REVIEW')).toBe(true);
    expect(isJobUnsettled('RUNNING')).toBe(false);
    expect(isJobUnsettled('SUCCEEDED')).toBe(false);
  });
});

describe('jobProgress', () => {
  it('follows the backend stages in order', () => {
    const steps = [
      jobProgress({ state: 'QUEUED', stage: null }),
      jobProgress({ state: 'RUNNING', stage: 'submitting' }),
      jobProgress({ state: 'WAITING_PROVIDER', stage: 'waiting_provider' }),
      jobProgress({ state: 'RUNNING', stage: 'fetching_output' }),
      jobProgress({ state: 'SUCCEEDED', stage: 'stored' }),
    ].map((p) => p.step);
    expect(steps).toEqual([0, 1, 2, 3, JOB_STEPS.length - 1]);
  });

  it('never jumps ahead on a stage it does not know', () => {
    expect(jobProgress({ state: 'RUNNING', stage: 'generating' }).step).toBe(1);
    expect(jobProgress({ state: 'WAITING_PROVIDER', stage: 'something_new' }).step).toBe(2);
  });

  it('maps every backend stage to a running step', () => {
    for (const stage of JOB_STAGES) {
      const { step } = jobProgress({ state: 'RUNNING', stage });
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThan(JOB_STEPS.length - 1);
    }
  });

  it('names stopping, review and confirmation apart from progress', () => {
    expect(jobProgress({ state: 'CANCEL_REQUESTED', stage: null }).label).toBe('Stopping');
    expect(jobProgress({ state: 'NEEDS_REVIEW', stage: null }).label).toMatch(/person is reviewing/);
    expect(jobProgress({ state: 'UNKNOWN', stage: 'reconcile' }).label).toMatch(/Confirming/);
  });
});

describe('isJobStage', () => {
  it('accepts only the backend JobStage values', () => {
    expect(isJobStage('fetching_output')).toBe(true);
    expect(isJobStage('generating')).toBe(false);
    expect(isJobStage(null)).toBe(false);
  });
});

describe('failureText', () => {
  it('explains known codes, then falls back to the server message', () => {
    expect(failureText('content_rejected', 'raw')).toMatch(/refused this brief/);
    expect(failureText('PROVIDER_INSUFFICIENT_BALANCE', null)).toMatch(/out of credit/);
    expect(failureText('SOMETHING_ELSE', 'The provider timed out.')).toBe('The provider timed out.');
    expect(failureText(null, null)).toMatch(/reported a failure/);
  });
});

describe('newJobKey and jobKeys', () => {
  it('makes a new key each time that fits the Idempotency-Key format', () => {
    const a = newJobKey();
    expect(a).not.toBe(newJobKey());
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('scopes job query keys by tenant', () => {
    expect(jobKeys.detail('t1', JOB_ID)).toEqual(['job', 't1', JOB_ID]);
    expect(jobKeys.detail('t1', JOB_ID)).not.toEqual(jobKeys.detail('t2', JOB_ID));
  });
});

describe('isUuid', () => {
  it('accepts a UUID and nothing that could change the path', () => {
    expect(isUuid(JOB_ID)).toBe(true);
    expect(isUuid(JOB_ID.toUpperCase())).toBe(true);
    for (const bad of ['', '..', '../admin', 'sim-job-1a2b3c4d', `${JOB_ID}/..`, `${JOB_ID} `]) expect(isUuid(bad)).toBe(false);
  });
});

describe('jobsApi', () => {
  afterEach(() => {
    configureHttp({ fetch: (...args) => fetch(...args) });
    vi.restoreAllMocks();
  });

  /** A fetch that answers with `answer`, or never answers and fails with the signal's reason once aborted. */
  const fakeFetch = (answer?: () => Response) =>
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(signal.reason as Error);
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
          if (answer) resolve(answer());
        }),
    );
  const start = (signal?: AbortSignal) => jobsApi.startImage('sim-cr-0001', 3, newJobKey(), signal);

  it('keeps a job that matches the contract', async () => {
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody())) });
    expect(await jobsApi.get(JOB_ID)).toEqual(jobBody());
  });

  it('reads a state this build does not know as UNKNOWN instead of failing', async () => {
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody({ state: 'PAUSED_BY_OPERATOR' }))) });
    expect((await jobsApi.get(JOB_ID)).state).toBe('UNKNOWN');
  });

  it('refuses a job body whose id is not a UUID', async () => {
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody({ job_id: '../admin' }))) });
    await expect(jobsApi.get(JOB_ID)).rejects.toMatchObject({ kind: 'contract' });
  });

  it('never requests a job id that is not a UUID and answers not found', async () => {
    const f = fakeFetch(() => json(200, jobBody()));
    configureHttp({ fetch: f });
    await expect(jobsApi.get('../admin')).rejects.toMatchObject({ kind: 'not_found' });
    expect(f).not.toHaveBeenCalled();
  });

  it('reads an accepted start with an unknown state as UNKNOWN, and refuses a non-UUID job id', async () => {
    configureHttp({ fetch: fakeFetch(() => json(202, { job_id: JOB_ID, state: 'NEW' })) });
    expect(await start()).toEqual({ job_id: JOB_ID, state: 'UNKNOWN' });
    configureHttp({ fetch: fakeFetch(() => json(202, { job_id: '../../admin', state: 'QUEUED' })) });
    await expect(start()).rejects.toMatchObject({ kind: 'contract' });
  });

  it('treats a start that times out as a lost answer, so a retry reuses the same key', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    configureHttp({ fetch: fakeFetch() });
    const e = await start().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ kind: 'network', retryable: true });
  });

  it('gives every request a timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody())) });
    await jobsApi.get(JOB_ID);
    configureHttp({ fetch: fakeFetch(() => json(202, { job_id: JOB_ID, state: 'QUEUED' })) });
    await start();
    expect(timeout).toHaveBeenCalledTimes(2);
  });

  it('stops a start when the caller aborts, without turning it into a lost answer', async () => {
    configureHttp({ fetch: fakeFetch() });
    const ctrl = new AbortController();
    const pending = start(ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
