import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import type { Creative } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { isTerminal, newValidationKey, validationsApi, type ValidationInputKind } from '@/api/validations';
import { useToast } from '@/components/ui/Toast';

const FIRST_POLL_MS = 1000;
const MAX_POLL_MS = 10_000;

/**
 * Next poll delay: grows by half each time, capped, with ±20% jitter so many
 * open tabs do not poll in step. Polling pauses while the tab is hidden
 * (TanStack Query's default) and stops at a terminal state or an error.
 */
export const pollDelay = (attempt: number, random = Math.random) =>
  Math.round(Math.min(FIRST_POLL_MS * 1.5 ** attempt, MAX_POLL_MS) * (0.8 + 0.4 * random()));

/** One validation run, polled until it finishes. The run id lives in the URL, so a reload picks it up again. */
export function useValidationRun(runId: string) {
  const { context } = useSession();
  return useQuery({
    queryKey: ['validation', context.tenant.tenant_id, runId],
    queryFn: ({ signal }) => validationsApi.get(runId, signal),
    refetchInterval: (q) => {
      const run = q.state.data;
      if (!run || q.state.error || isTerminal(run.state)) return false;
      return pollDelay(q.state.dataUpdateCount);
    },
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
    staleTime: 0,
  });
}

/** Starts a run for a saved version and opens its results. */
export function useStartValidation() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  /** Same key when the same request is retried; a new one for anything else. */
  const pending = useRef<{ body: string; key: string } | null>(null);

  const start = async (creative: Creative, inputKind: ValidationInputKind = 'brief') => {
    const body = { creative_id: creative.id, creative_version: creative.version, input_kind: inputKind };
    const sig = JSON.stringify(body);
    if (pending.current?.body !== sig) pending.current = { body: sig, key: newValidationKey() };
    setStarting(true);
    try {
      const accepted = await validationsApi.start(body, pending.current.key);
      pending.current = null;
      navigate(`/marketing/validation/${encodeURIComponent(creative.id)}/${encodeURIComponent(accepted.validation_run_id)}`);
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.kind === 'not_implemented') toast('Validation is not available yet', 'waiting', 'The checking service is not connected in this build.');
      else if (e.code === 'VERSION_CONFLICT') toast('The draft changed', 'waiting', 'Reload the draft and validate the latest version.');
      else if (e.kind === 'forbidden') toast('Your role cannot run validation here', 'blocked');
      else toast('Validation could not start', 'blocked', e.retryable ? 'Try again in a moment.' : e.message);
      if (!e.retryable) pending.current = null;
    } finally {
      setStarting(false);
    }
  };

  return { start, starting };
}
