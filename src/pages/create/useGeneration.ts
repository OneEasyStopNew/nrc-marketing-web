import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import type { Creative } from '@/api/creatives';
import { isApiError, type ApiError } from '@/api/errors';
import { isJobOutcomeUnknown, isJobTerminal, jobsApi, newJobKey } from '@/api/jobs';
import { pollDelay } from '@/pages/validation/useValidation';

/** Slow, steady polling while the backend reconciles an UNKNOWN job. */
const UNKNOWN_POLL_MS = 15_000;

/**
 * The job id lives in the address path (/marketing/create/{id}/generation/{jobId}),
 * so a reload or a shared link finds the same job again. A path, not a query
 * string: sign-in keeps only the path when it sends the user back.
 */
export const jobPath = (creativeId: string, jobId: string) =>
  `/marketing/create/${encodeURIComponent(creativeId)}/generation/${encodeURIComponent(jobId)}`;

/**
 * One job, polled with backoff and jitter until it finishes. Polling pauses
 * while the tab is hidden and stops on a terminal state or a non-retryable
 * error. Reading a job never starts another generation.
 */
export function useJob(jobId: string | null) {
  const { context } = useSession();
  return useQuery({
    queryKey: ['job', context.tenant.tenant_id, jobId],
    queryFn: ({ signal }) => jobsApi.get(jobId!, signal),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const job = q.state.data;
      if (!job || q.state.error || isJobTerminal(job.state)) return false;
      if (isJobOutcomeUnknown(job.state)) return UNKNOWN_POLL_MS;
      return pollDelay(q.state.dataUpdateCount);
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
  const pending = useRef<{ body: string; key: string } | null>(null);
  // Set synchronously, so a second click in the same frame is ignored before React re-renders.
  const inFlight = useRef(false);

  const start = async (creative: Creative) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const body = { creative_id: creative.id, creative_version: creative.version };
    const sig = JSON.stringify(body);
    if (pending.current?.body !== sig) pending.current = { body: sig, key: newJobKey() };
    setStarting(true);
    setProblem(null);
    try {
      const accepted = await jobsApi.start(body, pending.current.key);
      pending.current = null;
      navigate(jobPath(creative.id, accepted.job_id), { replace: true });
    } catch (e) {
      if (!isApiError(e)) throw e;
      const p = startProblem(e);
      if (!p.sameCommand) pending.current = null;
      setProblem(p);
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  return { start, starting, problem, jobId: jobId ?? null };
}

/** Maps the backend's refusal to what the user can do about it. */
export function startProblem(e: ApiError): StartProblem {
  const reason = (e.details as { reason?: string } | undefined)?.reason;
  const base = { requestId: e.requestId };
  switch (e.code) {
    case 'VALIDATION_NOT_PASSED':
      return { ...base, sameCommand: false, title: 'This version has not passed validation', detail: 'Validate this version. Generation starts only after the assessed checks pass.' };
    case 'VERSION_CONFLICT':
      return { ...base, sameCommand: false, title: 'The draft changed', detail: 'A newer version exists. Reload the draft, validate the latest version, then generate.' };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { ...base, sameCommand: false, title: 'This request was already used for something else', detail: 'Press Generate again to send a new request.' };
    case 'CONFLICT':
      return { ...base, sameCommand: true, title: 'This generation is still being set up', detail: 'Wait a moment, then try again. No second image is started.' };
    case 'STUDY_CLOSED':
      return { ...base, sameCommand: false, title: 'The study is closed', detail: 'Posts can only be generated for a recruiting study.' };
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

function notEligible(reason: string | undefined): { title: string; detail: string } {
  switch (reason) {
    case 'STUDY_CLOSED': return { title: 'The study is no longer recruiting', detail: 'Posts can only be generated for a recruiting study.' };
    case 'STALE_VERSION': return { title: 'The draft changed', detail: 'A newer version exists. Reload the draft, validate the latest version, then generate.' };
    case 'NOT_VALIDATED': return { title: 'This version has not passed validation', detail: 'Validate this version. Generation starts only after the assessed checks pass.' };
    case 'NO_ACTIVE_POLICY': return { title: 'No active rulebook for this study', detail: 'Generation needs an active policy to check against. Ask a policy administrator.' };
    case 'LANGUAGE_NOT_ALLOWED': return { title: 'This language is not approved for the study', detail: 'Create the draft in a language the study allows.' };
    case 'FORMAT_NOT_ALLOWED': return { title: 'This post format cannot be generated', detail: 'Create the draft with a supported format.' };
    default: return { title: 'This draft cannot be generated', detail: 'Check the study and the draft settings, then try again.' };
  }
}
