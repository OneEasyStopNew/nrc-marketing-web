import { useEffect, useRef, useState } from 'react';
import { skipToken, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { useSession } from '@/auth/AuthProvider';
import { useAsset, useDraftExport, type Asset } from '@/api/assets';
import { creativesApi, currentValidation, latestValidation, type Creative, type GenerationEligibility, type ValidationKind, type ValidationRunSummary } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { isJobDone, isJobUnsettled, isUuid, jobKeys, jobsApi, newJobKey, type Job } from '@/api/jobs';
import { isInProgress } from '@/api/validations';
import { useToast } from '@/components/ui/Toast';
import { knownRuns } from '@/pages/validation/knownRuns';
import { useValidationRun } from '@/pages/validation/useValidation';
import { commandAfterProblem, commandFor, jobPollDelay, jobPollingExpired, startProblem, UNEXPECTED_PROBLEM, type PendingCommand } from './generationRules';

/** Eligibility query keys: both the query and the refusal that re-reads it use these. */
const eligibilityKeys = {
  creative: (tenantId: string, creativeId: string | undefined) => ['eligibility', tenantId, creativeId] as const,
  version: (tenantId: string, creativeId: string | undefined, version: number | undefined) =>
    [...eligibilityKeys.creative(tenantId, creativeId), version] as const,
};

/* ---------- The three checks of a draft version ---------- */

export interface CheckView {
  kind: ValidationKind;
  label: string;
  variant: 'neutral' | 'done' | 'blocked' | 'waiting' | 'brand';
  text: string;
  note?: string;
  /** The run to open for the evidence, when one is known. */
  runId?: string;
  /** The draft version that run checked. */
  runVersion?: number;
  inProgress: boolean;
}

const LABEL: Record<ValidationKind, string> = { brief: 'Brief', text: 'Caption', image: 'Image' };

function view(kind: ValidationKind, current: ValidationRunSummary | undefined, older: ValidationRunSummary | undefined, editing: boolean, eligibility?: GenerationEligibility): CheckView {
  const base = { kind, label: LABEL[kind] };
  if (editing && (current || older)) {
    return { ...base, variant: 'waiting', text: 'Out of date', note: kind === 'brief' ? 'The brief changed after the last validation.' : 'The draft changed after the last check.', inProgress: false };
  }
  if (!current) {
    if (older) return { ...base, variant: 'waiting', text: 'Out of date', note: `Last ${kind === 'brief' ? 'validated' : 'checked'} version ${older.creative_version}.`, runId: older.validation_run_id, inProgress: false };
    // No run known in this browser: for the brief, the server still says how its last check went.
    if (kind === 'brief' && !editing && eligibility) {
      if (eligibility.reason === 'ELIGIBLE') return { ...base, variant: 'done', text: 'Passed the assessed checks', note: `For version ${eligibility.creative_version}.`, runId: eligibility.validation_run_id ?? undefined, inProgress: false };
      if (eligibility.reason === 'VALIDATION_FAILED') return { ...base, variant: 'blocked', text: 'Failed', note: `For version ${eligibility.creative_version}.`, inProgress: false };
      if (eligibility.reason === 'NEEDS_REVIEW') return { ...base, variant: 'waiting', text: 'Needs review', note: `For version ${eligibility.creative_version}.`, inProgress: false };
    }
    return { ...base, variant: 'neutral', text: kind === 'brief' ? 'Not validated' : 'Not checked', inProgress: false };
  }
  const at = { runId: current.validation_run_id, note: `For version ${current.creative_version}.` };
  if (isInProgress(current.state)) return { ...base, variant: 'brand', text: 'Checking', runId: current.validation_run_id, inProgress: true };
  if (current.state === 'SUCCEEDED' || current.state === 'NEEDS_REVIEW') {
    if (current.outcome === 'PASS') return { ...base, ...at, variant: 'done', text: 'Passed the assessed checks', inProgress: false };
    if (current.outcome === 'FAIL') return { ...base, ...at, variant: 'blocked', text: 'Failed', inProgress: false };
    if (current.outcome === 'NEEDS_REVIEW') return { ...base, ...at, variant: 'waiting', text: 'Needs review', inProgress: false };
  }
  return { ...base, variant: 'blocked', text: 'Could not finish', note: 'Run the check again.', runId: current.validation_run_id, inProgress: false };
}

/**
 * What is known about the brief, caption and image checks of the current
 * version. The draft's own `validation_runs` win when the API lists them;
 * otherwise the runs started in this tab are read back from the API.
 */
/** The checks of the current version and whether the image may be generated. */
export interface DraftChecks {
  checks: CheckView[];
  eligibility: UseQueryResult<GenerationEligibility>;
}

export function useDraftChecks(creative: Creative | undefined, editing: boolean, assetId: string | null): DraftChecks {
  const { context } = useSession();
  const tenantId = context.tenant.tenant_id;
  const refs = creative ? knownRuns(tenantId, creative.id) : [];
  const refFor = (kind: ValidationKind) => (creative && !currentValidation(creative, kind)
    ? refs.find((r) => r.kind === kind && r.version === creative.version && (kind !== 'image' || r.asset_id === assetId))
    : undefined);
  const olderRef = (kind: ValidationKind) => (creative ? refs.find((r) => r.kind === kind && r.version < creative.version) : undefined);

  const brief = useValidationRun(refFor('brief')?.id);
  const text = useValidationRun(refFor('text')?.id);
  const image = useValidationRun(refFor('image')?.id);

  const eligibility = useQuery({
    queryKey: eligibilityKeys.version(tenantId, creative?.id, creative?.version),
    // skipToken instead of `creative!` (JS-13): no draft yet means nothing to ask.
    queryFn: creative ? ({ signal }) => creativesApi.generationEligibility(creative.id, signal) : skipToken,
    enabled: !editing,
    staleTime: 0,
    retry: false,
  });
  // A brief check that just finished changes whether the image may be generated.
  const briefState = brief.data?.state;
  useEffect(() => {
    if (briefState && !isInProgress(briefState)) void eligibility.refetch();
  }, [briefState]); // eslint-disable-line react-hooks/exhaustive-deps

  const checks: CheckView[] = creative
    ? (['brief', 'text', 'image'] as const).map((kind) => {
        const fromApi = currentValidation(creative, kind);
        const fetched = { brief, text, image }[kind].data;
        const older = fromApi ? undefined : latestValidation(creative, kind) ?? (() => {
          const o = olderRef(kind);
          return o ? { validation_run_id: o.id, input_kind: kind, creative_version: o.version, state: 'SUCCEEDED' as const, outcome: null, is_current: false, evaluated_at: null } : undefined;
        })();
        return { ...view(kind, fromApi ?? fetched, older, editing, eligibility.data), runVersion: (fromApi ?? fetched ?? older)?.creative_version };
      })
    : [];

  return { checks, eligibility };
}

/* ---------- The image of a draft version, and generating it ---------- */

const jobKey = (tenantId: string, creativeId: string) => `nrc.job.${tenantId}.${creativeId}`;
// The stored id goes into a path, so it must be a UUID like the API issues (JS-58).
const JobRefSchema = z.object({ job_id: z.string().refine(isUuid), version: z.number().int() });
type JobRef = z.infer<typeof JobRefSchema>;

/** The job this tab started for a draft, if a valid one is stored (JS-14, JS-59). */
const readJob = (k: string): JobRef | null => {
  try {
    const parsed = JobRefSchema.safeParse(JSON.parse(sessionStorage.getItem(k) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The image of the current version and the Generate action. */
export interface Generation {
  /** The job for the current version, if this tab started one. */
  job: Job | undefined;
  /** The job is still working (queued, running, waiting on the provider, stopping). */
  active: boolean;
  /** The job waits on reconciliation or a person (UNKNOWN, NEEDS_REVIEW): Generate stays off. */
  unsettled: boolean;
  /** Automatic checking stopped for an unfinished job that is past the polling window. */
  pollingStopped: boolean;
  /** Reads the job once, on demand. Never starts a job. */
  checkAgain: () => void;
  /** A read of the job is in flight. */
  checking: boolean;
  starting: boolean;
  start: () => Promise<void>;
  assetId: string | null;
  asset: UseQueryResult<Asset>;
  /** True until it is known whether the current version has an image. */
  imagePending: boolean;
}

/**
 * The image that belongs to the current version, and the Generate action.
 *
 * - The image comes from the draft itself when the API names it there, else
 *   from the job this tab started, else from the review package of the
 *   current version.
 * - The job id is kept for this tab, so a reload follows the same job instead
 *   of starting (and paying for) another one. Polling never starts a job.
 */
export function useGeneration(creative: Creative | undefined): Generation {
  const { context } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tenantId = context.tenant.tenant_id;
  const storeKey = creative ? jobKey(tenantId, creative.id) : '';
  const [ref, setRef] = useState<JobRef | null>(() => (storeKey ? readJob(storeKey) : null));
  const [starting, setStarting] = useState(false);
  /** Same key while the same request is retried; a new one for a new generation. */
  const pending = useRef<PendingCommand | null>(null);
  // Set synchronously, so a second click in the same frame is ignored before React re-renders.
  const inFlight = useRef(false);
  // Aborted when the page goes away, so a late answer changes nothing.
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const jobId = ref?.job_id;
  const jobQ = useQuery({
    queryKey: jobKeys.detail(tenantId, jobId),
    // skipToken: no stored job means nothing to read, and no `ref!` to trust (JS-13).
    queryFn: jobId ? ({ signal }) => jobsApi.get(jobId, signal) : skipToken,
    refetchInterval: (q) => {
      const j = q.state.data;
      if (!j || q.state.error) return false;
      return jobPollDelay(j, q.state.dataUpdateCount, q.state.dataUpdatedAt);
    },
    staleTime: 0,
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
  });
  // A job from an earlier visit that the API no longer knows (it restarted): forget it.
  const jobGone = isApiError(jobQ.error) && jobQ.error.kind === 'not_found';
  const job: Job | undefined = jobGone ? undefined : jobQ.data;
  const forCurrent = !!job && !!creative && job.creative_version === creative.version;
  const active = forCurrent && !isJobDone(job.state) && !isJobUnsettled(job.state);
  const unsettled = forCurrent && isJobUnsettled(job.state);
  const pollingStopped = forCurrent && jobPollingExpired(job, jobQ.dataUpdatedAt);

  const pkg = useDraftExport(creative && !creative.asset_id ? creative.id : undefined, creative?.version);
  const assetId = creative?.asset_id
    ?? (forCurrent && job.state === 'SUCCEEDED' ? job.result_asset_id : null)
    ?? pkg.data?.image.asset_id
    ?? null;
  const asset = useAsset(assetId);

  const succeeded = forCurrent && job.state === 'SUCCEEDED';
  const creativeId = creative?.id;
  useEffect(() => {
    if (!succeeded) return;
    void qc.invalidateQueries({ queryKey: ['draft-export', tenantId, creativeId] });
  }, [succeeded, qc, tenantId, creativeId]);

  /**
   * Starts a job for the current version. One Idempotency-Key per intended
   * command: after a lost answer, a timeout or a temporary failure the next
   * Generate resends the same key, so the backend answers with the job it may
   * already have made instead of starting (and charging for) a second one.
   */
  const start = async () => {
    if (!creative || inFlight.current || active || unsettled) return;
    inFlight.current = true;
    const ctrl = new AbortController();
    request.current = ctrl;
    const command = commandFor(pending.current, `${creative.id}:${creative.version}`, newJobKey);
    pending.current = command;
    setStarting(true);
    try {
      const accepted = await jobsApi.startImage(creative.id, creative.version, command.key, ctrl.signal);
      if (ctrl.signal.aborted) return;
      pending.current = null;
      const next = { job_id: accepted.job_id, version: creative.version };
      try {
        sessionStorage.setItem(storeKey, JSON.stringify(next));
      } catch {
        // Storage blocked: the job still runs; only a reload loses track of it.
      }
      setRef(next);
    } catch (e: unknown) {
      if (ctrl.signal.aborted) return; // The user left; nothing to show.
      const p = isApiError(e) ? startProblem(e) : UNEXPECTED_PROBLEM;
      pending.current = commandAfterProblem(command, p);
      toast(p.title, p.sameCommand ? 'waiting' : 'blocked', p.detail);
      if (p.recheckEligibility) void qc.invalidateQueries({ queryKey: eligibilityKeys.creative(tenantId, creative.id) });
    } finally {
      inFlight.current = false;
      if (!ctrl.signal.aborted) setStarting(false);
    }
  };

  return {
    /** The job for the current version, if this tab started one. */
    job: forCurrent ? job : undefined,
    active,
    unsettled,
    pollingStopped,
    checkAgain: () => void jobQ.refetch(),
    checking: jobQ.isFetching,
    starting,
    start,
    assetId,
    asset,
    /** True until it is known whether the current version has an image. */
    imagePending: !!creative && !creative.asset_id && !assetId && pkg.isPending,
  };
}
