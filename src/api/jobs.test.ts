import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { configureHttp } from './http';
import {
  failureText, InvalidResponseError, isJobStage, isJobTerminal, isUuid, JOB_STAGES, JOB_STEPS, jobProgress, jobsApi, newJobKey,
  parseJob, parseJobAccepted,
} from './jobs';
import type { ExecutionState } from './validations';

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('job states', () => {
  it('stops polling only on finished states', () => {
    const finished: ExecutionState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
    const unfinished: ExecutionState[] = ['QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'UNKNOWN', 'NEEDS_REVIEW', 'CANCEL_REQUESTED'];
    expect(finished.every(isJobTerminal)).toBe(true);
    expect(unfinished.some(isJobTerminal)).toBe(false);
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
    expect(jobProgress({ state: 'RUNNING', stage: 'something_new' }).step).toBe(1);
    expect(jobProgress({ state: 'WAITING_PROVIDER', stage: 'something_new' }).step).toBe(2);
  });

  it('shows a retry as still sending, not as progress', () => {
    expect(jobProgress({ state: 'RUNNING', stage: 'retry_wait' }).step).toBe(1);
  });

  it('maps every backend stage to a running step', () => {
    for (const stage of JOB_STAGES) {
      const { step } = jobProgress({ state: 'RUNNING', stage });
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThan(JOB_STEPS.length - 1);
    }
  });

  it('names stopping, cancelled and review apart from progress', () => {
    expect(jobProgress({ state: 'CANCEL_REQUESTED', stage: null }).label).toBe('Stopping');
    expect(jobProgress({ state: 'CANCELLED', stage: null }).label).toBe('Cancelled');
    expect(jobProgress({ state: 'NEEDS_REVIEW', stage: null }).label).toMatch(/person is reviewing/);
    expect(jobProgress({ state: 'UNKNOWN', stage: 'reconcile' }).label).toMatch(/Confirming/);
  });
});

describe('isJobStage', () => {
  it('accepts only the backend JobStage values', () => {
    expect(isJobStage('fetching_output')).toBe(true);
    expect(isJobStage('something_new')).toBe(false);
    expect(isJobStage(null)).toBe(false);
  });
});

describe('failureText', () => {
  it('explains a content refusal and an unknown code', () => {
    expect(failureText('content_rejected')).toMatch(/refused/);
    expect(failureText('SOMETHING_ELSE')).toMatch(/could not be made/);
    expect(failureText(null)).toMatch(/could not be made/);
  });
});

describe('newJobKey', () => {
  it('is new each time and fits the Idempotency-Key format', () => {
    const a = newJobKey();
    expect(a).not.toBe(newJobKey());
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});

describe('isUuid', () => {
  it('accepts a UUID and nothing that could change the path', () => {
    expect(isUuid(JOB_ID)).toBe(true);
    expect(isUuid(JOB_ID.toUpperCase())).toBe(true);
    for (const bad of ['', '..', '../admin', 'sim-gen-1a2b3c4d', `${JOB_ID}/..`, `${JOB_ID} `]) expect(isUuid(bad)).toBe(false);
  });
});

describe('parseJob', () => {
  it('keeps a job that matches the contract', () => {
    expect(parseJob(jobBody())).toEqual(jobBody());
  });

  it('reads a state it does not know as UNKNOWN instead of failing the page', () => {
    expect(parseJob(jobBody({ state: 'PAUSED_BY_OPERATOR' })).state).toBe('UNKNOWN');
    expect(parseJob(jobBody({ state: 42 })).state).toBe('UNKNOWN');
  });

  it('reads a missing optional field as null', () => {
    const body = jobBody();
    delete body.failure_code;
    delete body.completed_at;
    expect(parseJob(body)).toMatchObject({ failure_code: null, completed_at: null });
  });

  it('refuses a body that breaks the contract', () => {
    for (const bad of [
      null, 'job', [], jobBody({ job_id: '../admin' }), jobBody({ creative_version: '3' }), jobBody({ creative_version: 0 }),
      jobBody({ kind: 'video_generation' }), jobBody({ stage: 7 }), jobBody({ created_at: undefined }), jobBody({ result_asset_id: {} }),
    ]) {
      expect(() => parseJob(bad)).toThrow(InvalidResponseError);
    }
  });
});

describe('parseJobAccepted', () => {
  it('keeps a valid answer and reads an unknown state as UNKNOWN', () => {
    expect(parseJobAccepted({ job_id: JOB_ID, state: 'QUEUED' })).toEqual({ job_id: JOB_ID, state: 'QUEUED' });
    expect(parseJobAccepted({ job_id: JOB_ID, state: 'NEW' }).state).toBe('UNKNOWN');
  });

  it('refuses a job id that is not a UUID, so it never reaches the address', () => {
    expect(() => parseJobAccepted({ job_id: '../../admin', state: 'QUEUED' })).toThrow(InvalidResponseError);
    expect(() => parseJobAccepted({ state: 'QUEUED' })).toThrow(InvalidResponseError);
  });
});

describe('jobsApi', () => {
  afterEach(() => {
    configureHttp({ fetch: (...args) => fetch(...args) });
    vi.restoreAllMocks();
  });

  /** A fetch that answers with `answer`, or never answers and fails with the signal's reason once aborted. */
  const fakeFetch = (answer?: () => Response) =>
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason));
      if (answer) resolve(answer());
    }));

  it('never requests a job id that is not a UUID and answers not found', async () => {
    const f = fakeFetch(() => json(200, jobBody()));
    configureHttp({ fetch: f });
    await expect(jobsApi.get('../admin')).rejects.toMatchObject({ kind: 'not_found' });
    expect(f).not.toHaveBeenCalled();
  });

  it('reads a job with an unknown state as UNKNOWN', async () => {
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody({ state: 'SOMETHING_NEW' }))) });
    expect((await jobsApi.get(JOB_ID)).state).toBe('UNKNOWN');
  });

  it('treats a start that times out as a lost answer, so a retry reuses the same key', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    configureHttp({ fetch: fakeFetch() });
    const e = await jobsApi.start({ creative_id: 'sim-cr-0001', creative_version: 3 }, newJobKey()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ kind: 'network', retryable: true });
  });

  it('gives every request a timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    configureHttp({ fetch: fakeFetch(() => json(200, jobBody())) });
    await jobsApi.get(JOB_ID);
    configureHttp({ fetch: fakeFetch(() => json(202, { job_id: JOB_ID, state: 'QUEUED' })) });
    await jobsApi.start({ creative_id: 'sim-cr-0001', creative_version: 3 }, newJobKey());
    expect(timeout).toHaveBeenCalledTimes(2);
  });

  it('stops a start when the caller aborts, without turning it into a lost answer', async () => {
    configureHttp({ fetch: fakeFetch() });
    const ctrl = new AbortController();
    const pending = jobsApi.start({ creative_id: 'sim-cr-0001', creative_version: 3 }, newJobKey(), ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
