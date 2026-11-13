import type { ApiError } from '@/api/errors';
import { isJobDone, isJobUnsettled, jobProgress, type Job } from '@/api/jobs';
import { pollDelay } from '@/pages/validation/useValidation';

/**
 * The rules behind the Generate action (NRC-21), kept free of React so they can
 * be tested directly: which refusal means what, when a retry must resend the
 * same Idempotency-Key, and how often a job is read.
 */

/** Slow, steady polling while a job waits on reconciliation or a person. */
export const SLOW_POLL_MS = 15_000;
/** Fastest polling while a job runs; the backoff in pollDelay starts below it. */
export const RUNNING_POLL_MAX_MS = 2_500;
/** Automatic polling stops once a job is this old; "Check again" still reads it on demand. */
export const JOB_POLL_MAX_AGE_MS = 30 * 60_000;

/**
 * True when an unfinished job is past the automatic polling window, judged at
 * `at` (epoch ms of the last read). A created_at that cannot be read counts as
 * past the window, so polling stays bounded.
 */
export function jobPollingExpired(job: Pick<Job, 'state' | 'created_at'>, at: number): boolean {
  if (isJobDone(job.state)) return false;
  const created = Date.parse(job.created_at);
  return Number.isNaN(created) || at - created >= JOB_POLL_MAX_AGE_MS;
}

/** Delay before the next automatic read of a job, or false to stop. */
export function jobPollDelay(job: Pick<Job, 'state' | 'created_at'>, attempt: number, at: number): number | false {
  if (isJobDone(job.state) || jobPollingExpired(job, at)) return false;
  if (isJobUnsettled(job.state)) return SLOW_POLL_MS;
  return Math.min(pollDelay(attempt), RUNNING_POLL_MAX_MS);
}

/**
 * What the generation step's status region says (JS-82): where the job is. Start
 * problems are toasts, which Astryx announces through its own live region.
 */
export function generationAnnouncement({
  job,
  starting,
  pollingStopped,
}: {
  job: Pick<Job, 'state' | 'stage'> | undefined;
  starting: boolean;
  pollingStopped: boolean;
}): string {
  if (starting) return 'Starting the image generation';
  if (!job) return '';
  if (pollingStopped) return 'Automatic checking has stopped';
  return `Image generation: ${jobProgress(job).label}`;
}

/** Why Generate could not start, and whether pressing it again resends the same command. */
export interface StartProblem {
  title: string;
  detail: string;
  /** True: the next Generate resends the same Idempotency-Key, so it cannot create a second job. */
  sameCommand: boolean;
  /** The refusal is about this version's eligibility: read eligibility again. */
  recheckEligibility?: boolean;
}

/** The Generate command waiting for an answer: which version it is for, and its Idempotency-Key. */
export interface PendingCommand {
  sig: string;
  key: string;
}

/** The command to send: the pending one when it is for the same version (a retry), else a new key. */
export const commandFor = (pending: PendingCommand | null, sig: string, makeKey: () => string): PendingCommand =>
  pending?.sig === sig ? pending : { sig, key: makeKey() };

/** After a failed start: keep the key only when the next Generate must resend the same command. */
export const commandAfterProblem = (pending: PendingCommand, problem: StartProblem): PendingCommand | null =>
  problem.sameCommand ? pending : null;

/** A failure that is not an API answer. The key is kept: the job may exist, and trying again cannot start a second one. */
export const UNEXPECTED_PROBLEM: StartProblem = {
  sameCommand: true,
  title: 'Generation could not start',
  detail: 'Something went wrong in this page. Generate again: it resends the same request, so only one image is made.',
};

/** details.reason when the error body carries one as text; server data, so nothing is assumed. */
function reasonOf(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const reason: unknown = Object.getOwnPropertyDescriptor(details, 'reason')?.value;
  return typeof reason === 'string' ? reason : undefined;
}

/** Maps a refused or failed start (the codes POST /creative-jobs returns) to what the user can do about it. */
export function startProblem(e: ApiError): StartProblem {
  switch (e.code) {
    // The creatives API answers GENERATION_NOT_ELIGIBLE, the generation service
    // VALIDATION_NOT_PASSED; both mean "this version may not be generated", and the server's message says why.
    case 'GENERATION_NOT_ELIGIBLE':
    case 'VALIDATION_NOT_PASSED':
      return { sameCommand: false, recheckEligibility: true, title: 'This version cannot be generated yet', detail: e.message };
    case 'VERSION_CONFLICT':
      return {
        sameCommand: false,
        recheckEligibility: true,
        title: 'The draft changed',
        detail: 'A newer version exists. Reload the draft, validate the latest version, then generate.',
      };
    case 'IDEMPOTENCY_KEY_REUSED':
      return {
        sameCommand: false,
        title: 'This request was already used for something else',
        detail: 'Press Generate again to send a new request.',
      };
    // 409 CONFLICT: the same command is still being set up on the server.
    case 'CONFLICT':
      return {
        sameCommand: true,
        title: 'This generation is still being set up',
        detail: 'Wait a moment, then press Generate again. No second image is started.',
      };
    case 'GENERATION_LIMIT_REACHED':
      return reasonOf(e.details) === 'ACTIVE_JOB_LIMIT'
        ? {
            sameCommand: true,
            title: 'Too many images are being made right now',
            detail: 'Your organisation has the most generations running at once. Try again when one finishes.',
          }
        : {
            sameCommand: false,
            title: "Your organisation has used today's image allowance",
            detail: 'Generation is available again tomorrow, or ask an administrator about the limit.',
          };
    default:
      break; // Not a refusal code named here: the error's kind decides below.
  }
  switch (e.kind) {
    case 'forbidden':
      return { sameCommand: false, title: 'Your role cannot generate images here', detail: 'Ask an administrator for generation access.' };
    case 'not_implemented':
      return {
        sameCommand: false,
        title: 'Image generation is not available yet',
        detail: 'The generation service is not connected in this build.',
      };
    case 'network':
      return {
        sameCommand: true,
        title: 'No answer from NRC Marketing',
        detail: 'The request may have reached the server. Generate again: it resends the same request, so only one image is made.',
      };
    // The 202 arrived but could not be read: the job may exist, so the key is kept.
    case 'contract':
      return {
        sameCommand: true,
        title: 'Generation may have started',
        detail: 'The answer could not be read. Generate again: it resends the same request, so only one image is made.',
      };
    default:
      return e.retryable
        ? {
            sameCommand: true,
            title: 'Generation could not start',
            detail: 'Try again in a moment. It resends the same request, so only one image is made.',
          }
        : { sameCommand: false, title: 'Generation could not start', detail: e.message };
  }
}
