import { ApiError } from './errors';
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
export type JobKind = Schemas['JobKind'];

/** The only kind of job the web app starts. */
export const IMAGE_GENERATION: JobKind = 'image_generation';

/**
 * Where a job is inside its execution state, in pipeline order. Mirrors the
 * backend's JobStage enum (app/models/enums.py); the contract still types
 * `stage` as a plain string, so this moves to the generated client once the
 * backend contract merges.
 */
export const JOB_STAGES = ['submitting', 'retry_wait', 'reconcile', 'waiting_provider', 'output_ready', 'fetching_output', 'stored'] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const isJobStage = (s: string | null | undefined): s is JobStage => JOB_STAGES.some((known) => known === s);

/**
 * The job will not change any more; stop polling. Matches the backend's job
 * TERMINAL_STATES. NEEDS_REVIEW is not here, unlike for validation runs: an
 * operator can still settle a job in review to SUCCEEDED or FAILED.
 */
const JOB_TERMINAL: readonly ExecutionState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
export const isJobTerminal = (s: ExecutionState): boolean => JOB_TERMINAL.includes(s);

/** A new key per intended Generate command; the same key when that command is retried. */
export const newJobKey = () => `generate_${crypto.randomUUID().replace(/-/g, '')}`;

/**
 * How long one request waits for an answer. Past it the answer counts as lost:
 * http.ts reports a timeout as a network failure, so "Try again" resends the
 * same Idempotency-Key and cannot start a second job.
 */
export const JOB_START_TIMEOUT_MS = 15_000;
export const JOB_READ_TIMEOUT_MS = 15_000;

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Job ids go into a path; anything but a UUID could point elsewhere (`..` survives encoding). */
export const isUuid = (s: string): boolean => UUID.test(s);

/** A response body that does not have the shape the contract promises. */
export class InvalidResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} from NRC Marketing`);
    this.name = 'InvalidResponseError';
  }
}

// A Record, not a list, so the compiler fails here when the contract adds a state.
const EXECUTION_STATES: Record<ExecutionState, true> = {
  QUEUED: true, RUNNING: true, WAITING_PROVIDER: true, NEEDS_REVIEW: true, SUCCEEDED: true,
  FAILED: true, CANCEL_REQUESTED: true, CANCELLED: true, UNKNOWN: true,
};
// Own keys only (`in` would accept "constructor"); Object.hasOwn needs lib ES2022, the app builds against ES2021.
const isExecutionState = (v: unknown): v is ExecutionState =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXECUTION_STATES, v);

/** A state this build does not know is shown as UNKNOWN ("Being confirmed"), never a crash. */
const jobState = (v: unknown): ExecutionState => (isExecutionState(v) ? v : 'UNKNOWN');

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(o: Fields, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new InvalidResponseError(`${what}.${key}`);
  return v;
}

/** A missing nullable field reads as null; a value of the wrong type is a contract break. */
function textOrNull(o: Fields, key: string, what: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new InvalidResponseError(`${what}.${key}`);
  return v;
}

function jobId(o: Fields, what: string): string {
  const id = text(o, 'job_id', what);
  if (!isUuid(id)) throw new InvalidResponseError(`${what}.job_id`);
  return id;
}

/** The answer to POST /creative-jobs, checked before its job id goes into the address. */
export function parseJobAccepted(raw: unknown): JobAccepted {
  if (!isFields(raw)) throw new InvalidResponseError('job acceptance');
  return { job_id: jobId(raw, 'job acceptance'), state: jobState(raw.state) };
}

/** The answer to GET /jobs/{id}: the fields the UI reads, checked; an unknown state becomes UNKNOWN. */
export function parseJob(raw: unknown): Job {
  const what = 'job';
  if (!isFields(raw)) throw new InvalidResponseError(what);
  const version = raw.creative_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new InvalidResponseError(`${what}.creative_version`);
  if (raw.kind !== IMAGE_GENERATION) throw new InvalidResponseError(`${what}.kind`);
  return {
    job_id: jobId(raw, what),
    kind: IMAGE_GENERATION,
    creative_id: text(raw, 'creative_id', what),
    creative_version: version,
    state: jobState(raw.state),
    stage: textOrNull(raw, 'stage', what),
    provider_request_id: textOrNull(raw, 'provider_request_id', what),
    failure_code: textOrNull(raw, 'failure_code', what),
    failure_message: textOrNull(raw, 'failure_message', what),
    result_asset_id: textOrNull(raw, 'result_asset_id', what),
    created_at: text(raw, 'created_at', what),
    updated_at: text(raw, 'updated_at', what),
    completed_at: textOrNull(raw, 'completed_at', what),
  };
}

export const jobsApi = {
  /**
   * Only from an explicit "Generate" action, for a saved, validated version.
   * `signal` lets the page drop the answer once the user has left.
   */
  start: async (body: { creative_id: string; creative_version: number }, idempotencyKey: string, signal?: AbortSignal): Promise<JobAccepted> => {
    const res = await requestWithMeta<unknown>('POST', '/creative-jobs', {
      body: { ...body, kind: IMAGE_GENERATION },
      idempotencyKey,
      signal: withTimeout(JOB_START_TIMEOUT_MS, signal),
    });
    return parseJobAccepted(res.data);
  },

  get: async (jobId: string, signal?: AbortSignal): Promise<Job> => {
    // Answered like the API would, without a request: a malformed id names no job.
    if (!isUuid(jobId)) throw new ApiError(404);
    const raw = await http.get<unknown>(`/jobs/${encodeURIComponent(jobId)}`, undefined, { signal: withTimeout(JOB_READ_TIMEOUT_MS, signal) });
    return parseJob(raw);
  },
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

/** The step a known stage stands for while the job is running. */
function stageProgress(stage: JobStage): JobProgress {
  switch (stage) {
    case 'submitting': return { step: 1, label: 'Sending the brief to the image service' };
    case 'retry_wait': return { step: 1, label: 'The image service was busy; trying again with the same request' };
    case 'reconcile': return { step: 2, label: 'Confirming with the image service' };
    case 'waiting_provider': return { step: 2, label: 'The image service is making the image' };
    case 'output_ready':
    case 'fetching_output':
    case 'stored': return { step: 3, label: 'Checking and saving the image' };
    default: return unreachable(stage);
  }
}

/**
 * Maps state and backend stage to a step. An unrecognised stage keeps the
 * state's own step, never jumps ahead. Every state is handled explicitly.
 */
export function jobProgress(job: Pick<Job, 'state' | 'stage'>): JobProgress {
  const running = (fallback: JobProgress) => (isJobStage(job.stage) ? stageProgress(job.stage) : fallback);
  switch (job.state) {
    case 'QUEUED': return { step: 0, label: 'Waiting for a free worker' };
    case 'RUNNING': return running({ step: 1, label: 'Sending the brief to the image service' });
    case 'WAITING_PROVIDER': return running({ step: 2, label: 'The image service is making the image' });
    case 'SUCCEEDED': return { step: 4, label: 'The image is saved' };
    case 'UNKNOWN': return { step: 2, label: 'Confirming with the image service' };
    case 'NEEDS_REVIEW': return { step: 2, label: 'A person is reviewing this generation' };
    case 'CANCEL_REQUESTED': return { step: 0, label: 'Stopping' };
    case 'CANCELLED': return { step: 0, label: 'Cancelled' };
    case 'FAILED': return { step: 0, label: 'Not made' };
    default: return unreachable(job.state);
  }
}

/** Compile-time exhaustiveness check for a switch over a union. */
export function unreachable(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
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
