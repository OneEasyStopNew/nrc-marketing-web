import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import type { Creative } from '@/api/creatives';
import { isApiError, type ApiError } from '@/api/errors';
import { isJobTerminal, jobsApi, newJobKey, unreachable, type Job } from '@/api/jobs';
import { pollDelay } from '@/pages/validation/useValidation';
import type { GenerationSummary } from './parts';

/** Slow, steady polling while a job waits on reconciliation or a person. */
const SLOW_POLL_MS = 15_000;
/** Automatic polling stops once a job is this old; "Check again" still reads it on demand. */
export const JOB_POLL_MAX_AGE_MS = 30 * 60_000;

/**
 * The job id lives in the address path (/marketing/create/{id}/generation/{jobId}),
 * so a reload or a shared link finds the same job again. A path, not a query
 * string: sign-in keeps only the path when it sends the user back.
 */
export const jobPath = (creativeId: string, jobId: string) =>
  `/marketing/create/${encodeURIComponent(creativeId)}/generation/${encodeURIComponent(jobId)}`;

/**
 * True when an unfinished job is past the automatic polling window, judged at
 * `at` (epoch ms of the last read, so the poller and the page agree). A
 * created_at that cannot be read counts as past the window: polling stays bounded.
 */
export function jobPollingExpired(job: Pick<Job, 'state' | 'created_at'>, at: number): boolean {
  if (isJobTerminal(job.state)) return false;
  const created = Date.parse(job.created_at);
  return Number.isNaN(created) || at - created >= JOB_POLL_MAX_AGE_MS;
}

/** Delay before the next automatic read of a job, or false to stop polling. */
export function jobPollDelay(job: Pick<Job, 'state' | 'created_at'>, attempt: number, at: number): number | false {
  if (jobPollingExpired(job, at)) return false;
  switch (job.state) {
    case 'SUCCEEDED':
    case 'FAILED':
    case 'CANCELLED': return false;
    case 'UNKNOWN':
    case 'NEEDS_REVIEW': return SLOW_POLL_MS;
    case 'QUEUED':
    case 'RUNNING':
    case 'WAITING_PROVIDER':
    case 'CANCEL_REQUESTED': return pollDelay(attempt);
    default: return unreachable(job.state);
  }
}

/**
 * One job, polled with backoff and jitter until it finishes or the polling
 * window ends. Polling pauses while the tab is hidden and stops on a terminal
 * state or a non-retryable error. Reading a job never starts another generation.
 */
export function useJob(jobId: string | null) {
  const { context } = useSession();
  return useQuery({
    queryKey: ['job', context.tenant.tenant_id, jobId],
    queryFn: ({ signal }) => jobsApi.get(jobId!, signal),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const job = q.state.data;
      if (!job || q.state.error) return false;
      return jobPollDelay(job, q.state.dataUpdateCount, q.state.dataUpdatedAt);
    },
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
    staleTime: 0,
  });
}

/** Why Generate could not start, with whether pressing it again resends the same command. */
export interface StartProblem {
  title: string;
  detail: string;
  /** True: "Try again" resends the same Idempotency-Key, so it cannot create a second job. */
  sameCommand: boolean;
  requestId?: string;
}

/** The Generate command waiting for an answer: its request body and Idempotency-Key. */
export interface PendingCommand {
  body: string;
  key: string;
}

/** The command to send: the pending one when the body is unchanged (a retry), else a new key. */
export function commandFor(pending: PendingCommand | null, body: string, makeKey: () => string = newJobKey): PendingCommand {
  return pending?.body === body ? pending : { body, key: makeKey() };
}

/** After a failed start: keep the key only when "Try again" must resend the same command. */
export const commandAfterProblem = (pending: PendingCommand, problem: StartProblem): PendingCommand | null =>
  (problem.sameCommand ? pending : null);

/**
 * Starts a job for one saved version and puts its id in the address.
 *
 * Duplicate protection: one key per intended command. A retry after a lost or
 * failed response reuses the key, so the backend answers with the job it may
 * already have created instead of starting a second one. The key changes only
 * when the version changes or the backend refused the command for good.
 */
export function useStartGeneration() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const pending = useRef<PendingCommand | null>(null);
  // Set synchronously, so a second click in the same frame is ignored before React re-renders.
  const inFlight = useRef(false);

  const start = async (creative: Creative) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const body = { creative_id: creative.id, creative_version: creative.version };
    const command = commandFor(pending.current, JSON.stringify(body));
    pending.current = command;
    setStarting(true);
    setProblem(null);
    try {
      const accepted = await jobsApi.start(body, command.key);
      pending.current = null;
      navigate(jobPath(creative.id, accepted.job_id), { replace: true });
    } catch (e: unknown) {
      const p = isApiError(e) ? startProblem(e) : UNEXPECTED_PROBLEM;
      pending.current = commandAfterProblem(command, p);
      setProblem(p);
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  return { start, starting, problem, jobId: jobId ?? null };
}

/** A failure that is not an API answer. The same key is kept, so trying again cannot start a second job. */
const UNEXPECTED_PROBLEM: StartProblem = {
  sameCommand: true,
  title: 'Generation could not start',
  detail: 'Something went wrong in this page. Try again: it resends the same request, so only one image is made.',
};

interface Copy { title: string; detail: string }

/** Copy for refusals the backend can send either as an error code or as an eligibility reason. */
const REFUSAL = {
  notValidated: { title: 'This version has not passed validation', detail: 'Validate this version. Generation starts only after the assessed checks pass.' },
  staleVersion: { title: 'The draft changed', detail: 'A newer version exists. Reload the draft, validate the latest version, then generate.' },
  studyClosed: { title: 'The study is no longer recruiting', detail: 'Posts can only be generated for a recruiting study.' },
} as const satisfies Record<string, Copy>;

/** details.reason of GENERATION_NOT_ELIGIBLE, as the backend names it. */
type EligibilityReason = 'STUDY_CLOSED' | 'STALE_VERSION' | 'NOT_VALIDATED' | 'NO_ACTIVE_POLICY' | 'LANGUAGE_NOT_ALLOWED' | 'FORMAT_NOT_ALLOWED';

const NOT_ELIGIBLE: Record<EligibilityReason, Copy> = {
  STUDY_CLOSED: REFUSAL.studyClosed,
  STALE_VERSION: REFUSAL.staleVersion,
  NOT_VALIDATED: REFUSAL.notValidated,
  NO_ACTIVE_POLICY: { title: 'No active rulebook for this study', detail: 'Generation needs an active policy to check against. Ask a policy administrator.' },
  LANGUAGE_NOT_ALLOWED: { title: 'This language is not approved for the study', detail: 'Create the draft in a language the study allows.' },
  FORMAT_NOT_ALLOWED: { title: 'This post format cannot be generated', detail: 'Create the draft with a supported format.' },
};
const NOT_ELIGIBLE_OTHER: Copy = { title: 'This draft cannot be generated', detail: 'Check the study and the draft settings, then try again.' };

const notEligible = (reason: string | undefined): Copy =>
  (reason && reason in NOT_ELIGIBLE ? NOT_ELIGIBLE[reason as EligibilityReason] : NOT_ELIGIBLE_OTHER);

/** Maps the backend's refusal to what the user can do about it. */
export function startProblem(e: ApiError): StartProblem {
  const reason = (e.details as { reason?: string } | undefined)?.reason;
  const base = { requestId: e.requestId };
  switch (e.code) {
    case 'VALIDATION_NOT_PASSED':
      return { ...base, sameCommand: false, ...REFUSAL.notValidated };
    case 'VERSION_CONFLICT':
      return { ...base, sameCommand: false, ...REFUSAL.staleVersion };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { ...base, sameCommand: false, title: 'This request was already used for something else', detail: 'Press Generate again to send a new request.' };
    // The backend answers 409 CONFLICT while the same command is still in flight.
    case 'CONFLICT':
      return { ...base, sameCommand: true, title: 'This generation is still being set up', detail: 'Wait a moment, then try again. No second image is started.' };
    case 'STUDY_CLOSED':
      return { ...base, sameCommand: false, ...REFUSAL.studyClosed };
    case 'GENERATION_NOT_ELIGIBLE':
      return { ...base, sameCommand: false, ...notEligible(reason) };
    case 'GENERATION_LIMIT_REACHED':
      return reason === 'ACTIVE_JOB_LIMIT'
        ? { ...base, sameCommand: true, title: 'Too many images are being made right now', detail: 'Your organisation has the most generations running at once. Try again when one finishes.' }
        : { ...base, sameCommand: false, title: 'Your organisation has used today\'s image allowance', detail: 'Generation is available again tomorrow, or ask an administrator about the limit.' };
  }
  switch (e.kind) {
    case 'forbidden':
      return { ...base, sameCommand: false, title: 'Your role cannot generate images here', detail: 'Ask an administrator for generation access.' };
    case 'not_implemented':
      return { ...base, sameCommand: false, title: 'Generation is not available yet', detail: 'Image generation is not connected in this build.' };
    case 'network':
      return { ...base, sameCommand: true, title: 'No answer from NRC Marketing', detail: 'The request may have reached the server. Try again: it resends the same request, so only one image is made.' };
    default:
      return e.retryable
        ? { ...base, sameCommand: true, title: 'Generation could not start', detail: 'Try again in a moment. It resends the same request, so only one image is made.' }
        : { ...base, sameCommand: false, title: 'Generation could not start', detail: e.message };
  }
}

/** Generation row of the readiness card, from the job this page follows. Generate is offered only once that job has finished. */
export function generationSummary(
  job: Pick<Job, 'state' | 'creative_version'> | undefined,
  start: { allowed: boolean; onClick: () => void; busy: boolean },
): GenerationSummary {
  const go = start.allowed ? { onClick: start.onClick, busy: start.busy } : undefined;
  if (!job) return { variant: 'neutral', text: 'No image yet', start: go };
  const v = `For version ${job.creative_version}.`;
  switch (job.state) {
    case 'SUCCEEDED': return { variant: 'done', text: 'Image saved', note: `${v} Final validation still needed.`, start: go };
    case 'FAILED': return { variant: 'blocked', text: 'Not made', note: v, start: go };
    case 'CANCELLED': return { variant: 'neutral', text: 'Cancelled', note: v, start: go };
    case 'CANCEL_REQUESTED': return { variant: 'waiting', text: 'Stopping', note: `${v} Generating again is off until it has stopped.` };
    case 'UNKNOWN': return { variant: 'waiting', text: 'Being confirmed', note: 'Generating again is off until this is settled.' };
    case 'NEEDS_REVIEW': return { variant: 'waiting', text: 'Needs review', note: `${v} A person is reviewing it. Generating again is off until they finish.` };
    case 'QUEUED':
    case 'RUNNING':
    case 'WAITING_PROVIDER': return { variant: 'brand', text: 'In progress', note: `An image is being made for version ${job.creative_version}.` };
    default: return unreachable(job.state);
  }
}
