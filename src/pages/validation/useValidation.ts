import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import type { Creative } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { isTerminal, newValidationKey, validationsApi, type ValidationContext, type ValidationInputKind, type ValidationRun } from '@/api/validations';
import { useToast } from '@/components/ui/Toast';
import { rememberRun } from './knownRuns';
import { startFailure } from './startFailure';

const FIRST_POLL_MS = 1000;
const MAX_POLL_MS = 10_000;

/**
 * Next poll delay: grows by half each time, capped, with ±20% jitter so many
 * open tabs do not poll in step. Polling pauses while the tab is hidden
 * (TanStack Query's default) and stops at a terminal state or an error.
 */
export const pollDelay = (attempt: number, random = Math.random): number =>
  Math.round(Math.min(FIRST_POLL_MS * 1.5 ** attempt, MAX_POLL_MS) * (0.8 + 0.4 * random()));

/** One validation run, polled until it finishes. The run id lives in the URL, so a reload picks it up again. */
export function useValidationRun(runId: string | null | undefined): UseQueryResult<ValidationRun> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['validation', context.tenant.tenant_id, runId],
    // enabled guarantees runId is set when this runs.
    queryFn: ({ signal }) => validationsApi.get(runId!, signal),
    enabled: !!runId,
    refetchInterval: (q) => {
      const run = q.state.data;
      if (!run || q.state.error || isTerminal(run.state)) return false;
      return pollDelay(q.state.dataUpdateCount);
    },
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
    staleTime: 0,
  });
}

/**
 * The policy context a finished brief or caption run was checked against
 * (NRC-5); null when the run stored none. Read once: a stored context never
 * changes, and an image run has none to read.
 */
export function useValidationContext(runId: string | null | undefined, enabled: boolean): UseQueryResult<ValidationContext | null> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['validation-context', context.tenant.tenant_id, runId],
    // enabled guarantees runId is set when this runs.
    queryFn: ({ signal }) => validationsApi.context(runId!, signal),
    enabled: !!runId && enabled,
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
    staleTime: Infinity,
  });
}

/** Starting a validation run, and which kind is starting right now. */
export interface StartValidation {
  start: (creative: Creative, inputKind?: ValidationInputKind, assetId?: string | null) => Promise<void>;
  starting: boolean;
  startingKind: ValidationInputKind | null;
}

/** Starts a run for a saved version and opens its results. */
export function useStartValidation(): StartValidation {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { context } = useSession();
  const [startingKind, setStartingKind] = useState<ValidationInputKind | null>(null);
  /** Same key when the same request is retried; a new one for anything else. */
  const pending = useRef<{ body: string; key: string } | null>(null);

  /** `assetId` is needed for an image run: it names the exact image to check. */
  const start = async (creative: Creative, inputKind: ValidationInputKind = 'brief', assetId?: string | null) => {
    const body = {
      creative_id: creative.id, creative_version: creative.version, input_kind: inputKind,
      ...(inputKind === 'image' && assetId ? { asset_id: assetId } : {}),
    };
    const sig = JSON.stringify(body);
    if (pending.current?.body !== sig) pending.current = { body: sig, key: newValidationKey() };
    setStartingKind(inputKind);
    try {
      const accepted = await validationsApi.start(body, pending.current.key);
      pending.current = null;
      rememberRun(context.tenant.tenant_id, creative.id, {
        id: accepted.validation_run_id, kind: inputKind, version: creative.version, asset_id: assetId ?? null,
      });
      navigate(`/marketing/validation/${encodeURIComponent(creative.id)}/${encodeURIComponent(accepted.validation_run_id)}`);
    } catch (e) {
      if (!isApiError(e)) throw e;
      const failure = startFailure(e);
      toast(failure.title, failure.tone, failure.detail);
      if (!e.retryable) pending.current = null;
    } finally {
      setStartingKind(null);
    }
  };

  return { start, starting: startingKind !== null, startingKind };
}
