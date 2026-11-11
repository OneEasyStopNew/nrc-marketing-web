import { http, requestWithMeta } from './http';
import type { components } from './schema';
import type { ExecutionState } from './validations';

/**
 * Image generation jobs (NRC-6 / NRC-10), per contracts/openapi.json.
 * POST /creative-jobs starts a job for one saved version and answers 202 at
 * once; GET /jobs/{id} reads the stored state and never starts another
 * generation, so polling it is always safe. The provider is called only by the
 * backend worker: no provider key or provider URL ever reaches the browser.
 */

type Schemas = components['schemas'];
export type Job = Schemas['JobRead'];
export type JobAccepted = Schemas['JobAccepted'];

/** The job will not change any more; stop polling. */
const JOB_TERMINAL: readonly ExecutionState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
export const isJobTerminal = (s: ExecutionState) => JOB_TERMINAL.includes(s);

/**
 * UNKNOWN: the provider may have accepted the job but did not confirm it. The
 * backend reconciles it with the same provider key; the user must not start a
 * new paid attempt meanwhile, so it is neither "running" nor "finished".
 */
export const isJobOutcomeUnknown = (s: ExecutionState) => s === 'UNKNOWN' || s === 'NEEDS_REVIEW';

/** A new key per intended Generate command; the same key when that command is retried. */
export const newJobKey = () => `generate_${crypto.randomUUID().replace(/-/g, '')}`;

export const jobsApi = {
  /** Only from an explicit "Generate" action, for a saved, validated version. */
  start: async (body: { creative_id: string; creative_version: number }, idempotencyKey: string) =>
    (await requestWithMeta<JobAccepted>('POST', '/creative-jobs', { body: { ...body, kind: 'image_generation' }, idempotencyKey })).data,

  get: (jobId: string, signal?: AbortSignal) =>
    http.get<Job>(`/jobs/${encodeURIComponent(jobId)}`, undefined, { signal }),
};

/**
 * The steps a job goes through, in order, as the backend reports them
 * (state plus `stage`). Progress counts known steps only; there is no time
 * estimate because the provider gives none.
 */
export const JOB_STEPS = ['Queued', 'Sending to the image service', 'Image service working', 'Saving the image', 'Image saved'] as const;

export interface JobProgress {
  /** Index into JOB_STEPS of the step in progress (or reached, when done). */
  step: number;
  /** What is happening now, in plain words. */
  label: string;
}

/** Maps state and backend stage to a step. An unrecognised stage keeps the state's step, never jumps ahead. */
export function jobProgress(job: Pick<Job, 'state' | 'stage'>): JobProgress {
  const stage = job.stage ?? '';
  switch (job.state) {
    case 'QUEUED':
      return { step: 0, label: 'Waiting for a free worker' };
    case 'RUNNING':
      if (stage === 'retry_wait') return { step: 1, label: 'The image service was busy; trying again with the same request' };
      if (stage === 'output_ready' || stage === 'fetching_output' || stage === 'stored') return { step: 3, label: 'Checking and saving the image' };
      return { step: 1, label: 'Sending the brief to the image service' };
    case 'WAITING_PROVIDER':
      return { step: 2, label: 'The image service is making the image' };
    case 'SUCCEEDED':
      return { step: 4, label: 'The image is saved' };
    case 'UNKNOWN':
    case 'NEEDS_REVIEW':
      return { step: 2, label: 'Confirming with the image service' };
    default:
      return { step: 0, label: 'Stopped' };
  }
}

/** Plain-language reason for a failed job, from the backend's failure_code. */
export function failureText(code: string | null | undefined): string {
  switch (code) {
    case 'content_rejected': return 'The image service refused this brief under its content rules. Revise the brief, validate it again, then generate.';
    case 'provider_failed': return 'The image service could not make the image. You were not charged for it. Try again, or revise the brief.';
    case 'PROVIDER_INSUFFICIENT_BALANCE': return 'The image service account is out of credit. Ask an administrator to top it up.';
    case 'PROVIDER_REJECTED': return 'The image service did not accept the request. Ask an administrator to check the generation settings.';
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_CONFIG': return 'Image generation is not set up for this organisation. Ask an administrator.';
    case 'PROVIDER_OUTPUT_INVALID': return 'The image that came back could not be used. Try again.';
    default: return 'The image could not be made. Try again, or ask an administrator if it keeps happening.';
  }
}
