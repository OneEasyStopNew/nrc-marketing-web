import { z } from 'zod';
import { exhaustive } from '@/lib/exhaustive';
import { ApiError } from './errors';
import { http, requestWithMeta } from './http';
import * as S from './schemas.gen';

/**
 * Image generation jobs (D3), per contracts/openapi.json. POST /creative-jobs
 * starts one for a validated version; GET /jobs/{id} is polled until it ends.
 * A job's state says how the work is going; it says nothing about validation
 * or approval of the image it produced.
 */

export type Job = S.JobRead;
export type JobAccepted = S.JobAccepted;
export type JobState = Job['state'];

/**
 * Where a job is inside its state, in pipeline order. Mirrors the backend's
 * JobStage (app/models/enums.py); the contract types `stage` as a plain
 * string, so an unknown stage must never break the page.
 */
export const JOB_STAGES = [
  'submitting',
  'retry_wait',
  'reconcile',
  'waiting_provider',
  'output_ready',
  'fetching_output',
  'stored',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const isJobStage = (s: string | null | undefined): s is JobStage => JOB_STAGES.some((known) => known === s);

/**
 * The job will not change any more; stop polling. Matches the backend's
 * TERMINAL_STATES (app/services/jobs.py): UNKNOWN and NEEDS_REVIEW are not
 * here, because reconciliation or a person can still settle them.
 */
const DONE: readonly JobState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
export const isJobDone = (state: JobState): boolean => DONE.includes(state);

/** Waiting on reconciliation or a person: not progressing by itself, and Generate stays off. */
export const isJobUnsettled = (state: JobState): boolean => state === 'UNKNOWN' || state === 'NEEDS_REVIEW';

/** Query keys for jobs: tenant-scoped, and the only place they are written. */
export const jobKeys = {
  detail: (tenantId: string, jobId: string | undefined) => ['job', tenantId, jobId] as const,
};

/** A new key per intended generation; the same key when retrying the same request, so a retry never starts a second one. */
export const newJobKey = (): string => `generate_${crypto.randomUUID().replace(/-/g, '')}`;

/**
 * How long one request waits for an answer. Past it the answer counts as lost:
 * http.ts reports a timeout as a network failure, so retrying resends the same
 * Idempotency-Key and cannot start a second job.
 */
export const JOB_START_TIMEOUT_MS = 15_000;
export const JOB_READ_TIMEOUT_MS = 15_000;

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Job ids go into a path; the API only issues UUIDs, and anything else could point elsewhere (`..` survives encoding). */
export const isUuid = (s: string): boolean => UUID.test(s);

// Checks the generated schemas can't express: the contract's `format: uuid` is
// not in schemas.gen.ts, and a state this build doesn't know must read as
// UNKNOWN ("being confirmed") instead of failing the whole answer.
const JobId = z.string().refine(isUuid, { message: 'Expected a UUID' });
const State = S.ExecutionState.catch('UNKNOWN');
const JobReadChecked = S.JobRead.extend({ job_id: JobId, state: State });
const JobAcceptedChecked = S.JobAccepted.extend({ job_id: JobId, state: State });

export const jobsApi = {
  /**
   * Only from an explicit "Generate image" action, for a version whose brief
   * passed. `signal` lets the page drop the answer once the user has left.
   */
  startImage: async (creativeId: string, creativeVersion: number, idempotencyKey: string, signal?: AbortSignal): Promise<JobAccepted> =>
    (
      await requestWithMeta('POST', '/creative-jobs', JobAcceptedChecked, {
        idempotencyKey,
        signal: withTimeout(JOB_START_TIMEOUT_MS, signal),
        body: { creative_id: creativeId, creative_version: creativeVersion, kind: 'image_generation' },
      })
    ).data,

  get: async (jobId: string, signal?: AbortSignal): Promise<Job> => {
    // Answered like the API would, without a request: a malformed id names no job.
    if (!isUuid(jobId)) throw new ApiError(404);
    return http.get(`/jobs/${encodeURIComponent(jobId)}`, JobReadChecked, { signal: withTimeout(JOB_READ_TIMEOUT_MS, signal) });
  },
};

/** The steps a job goes through, as the backend reports them. Progress counts known steps only: no time estimate. */
export const JOB_STEPS = ['Queued', 'Sending to the image service', 'Image service working', 'Saving the image', 'Image saved'] as const;

export interface JobProgress {
  /** Index into JOB_STEPS of the step in progress (or reached, when done). */
  step: number;
  /** What is happening now, in plain words. */
  label: string;
}

function stageProgress(stage: JobStage): JobProgress {
  switch (stage) {
    case 'submitting':
      return { step: 1, label: 'Sending the brief to the image service' };
    case 'retry_wait':
      return { step: 1, label: 'The image service was busy; trying again with the same request' };
    case 'reconcile':
      return { step: 2, label: 'Confirming with the image service' };
    case 'waiting_provider':
      return { step: 2, label: 'The image is being generated' };
    case 'output_ready':
    case 'fetching_output':
    case 'stored':
      return { step: 3, label: 'Saving the image' };
    default:
      return exhaustive(stage, { step: 1, label: 'Working on the image' });
  }
}

/** State plus backend stage → step. An unknown stage keeps the state's own step and never jumps ahead. */
export function jobProgress(job: Pick<Job, 'state' | 'stage'>): JobProgress {
  const running = (fallback: JobProgress): JobProgress => (isJobStage(job.stage) ? stageProgress(job.stage) : fallback);
  switch (job.state) {
    case 'QUEUED':
      return { step: 0, label: 'Waiting to start' };
    case 'RUNNING':
      return running({ step: 1, label: 'Sending the brief to the image service' });
    case 'WAITING_PROVIDER':
      return running({ step: 2, label: 'The image is being generated' });
    case 'SUCCEEDED':
      return { step: 4, label: 'The image is saved' };
    case 'UNKNOWN':
      return { step: 2, label: 'Confirming with the image service' };
    case 'NEEDS_REVIEW':
      return { step: 2, label: 'A person is reviewing this generation' };
    case 'CANCEL_REQUESTED':
      return { step: 0, label: 'Stopping' };
    case 'CANCELLED':
      return { step: 0, label: 'Cancelled' };
    case 'FAILED':
      return { step: 0, label: 'Not made' };
    default:
      return exhaustive(job.state, { step: 0, label: 'Being confirmed' });
  }
}

/** Plain-language reason for a failed job: known backend codes first, then the server's own message. */
export function failureText(code: string | null | undefined, message: string | null | undefined): string {
  switch (code) {
    case 'content_rejected':
      return 'The image service refused this brief under its content rules. Revise the brief, validate it again, then generate.';
    case 'provider_failed':
      return 'The image service could not make the image. You were not charged for it. Try again, or revise the brief.';
    case 'PROVIDER_INSUFFICIENT_BALANCE':
      return 'The image service account is out of credit. Ask an administrator to top it up.';
    case 'PROVIDER_REJECTED':
      return 'The image service did not accept the request. Ask an administrator to check the generation settings.';
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_CONFIG':
      return 'Image generation is not set up for this organisation. Ask an administrator.';
    case 'PROVIDER_OUTPUT_INVALID':
      return 'The image that came back could not be used. Try again.';
    default:
      return message ?? 'The image service reported a failure. Try again, or ask an administrator if it keeps happening.';
  }
}
