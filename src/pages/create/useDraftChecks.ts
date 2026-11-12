import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { useSession } from '@/auth/AuthProvider';
import { useAsset, useDraftExport, type Asset } from '@/api/assets';
import { creativesApi, currentValidation, latestValidation, type Creative, type GenerationEligibility, type ValidationKind, type ValidationRunSummary } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { isJobDone, jobsApi, newJobKey, type Job } from '@/api/jobs';
import { isInProgress } from '@/api/validations';
import { useToast } from '@/components/ui/Toast';
import { knownRuns } from '@/pages/validation/knownRuns';
import { pollDelay, useValidationRun } from '@/pages/validation/useValidation';

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
    queryKey: ['eligibility', tenantId, creative?.id, creative?.version],
    queryFn: ({ signal }) => creativesApi.generationEligibility(creative!.id, signal),
    enabled: !!creative && !editing,
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
const JobRefSchema = z.object({ job_id: z.string(), version: z.number().int() });
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
  active: boolean;
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
  const pending = useRef<{ sig: string; key: string } | null>(null);

  const jobQ = useQuery({
    queryKey: ['job', tenantId, ref?.job_id],
    queryFn: ({ signal }) => jobsApi.get(ref!.job_id, signal),
    enabled: !!ref,
    refetchInterval: (q) => {
      const j = q.state.data;
      if (!j || q.state.error || isJobDone(j.state)) return false;
      return Math.min(pollDelay(q.state.dataUpdateCount), 2500);
    },
    staleTime: 0,
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
  });
  // A job from an earlier visit that the API no longer knows (it restarted): forget it.
  const jobGone = isApiError(jobQ.error) && jobQ.error.kind === 'not_found';
  const job: Job | undefined = jobGone ? undefined : jobQ.data;
  const forCurrent = !!job && !!creative && job.creative_version === creative.version;
  const active = forCurrent && !isJobDone(job.state);

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

  const start = async () => {
    if (!creative || starting || active) return;
    const sig = `${creative.id}:${creative.version}`;
    if (pending.current?.sig !== sig) pending.current = { sig, key: newJobKey() };
    setStarting(true);
    try {
      const accepted = await jobsApi.startImage(creative.id, creative.version, pending.current.key);
      pending.current = null;
      const next = { job_id: accepted.job_id, version: creative.version };
      try { sessionStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* storage blocked: the job still runs */ }
      setRef(next);
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.kind === 'not_implemented') toast('Image generation is not available yet', 'waiting', 'The generation service is not connected in this build.');
      // Both codes mean "this version may not be generated": the creatives API
      // answers GENERATION_NOT_ELIGIBLE, the generation service VALIDATION_NOT_PASSED
      // (not settled between the two backend branches yet).
      else if (e.code === 'GENERATION_NOT_ELIGIBLE' || e.code === 'VALIDATION_NOT_PASSED') {
        toast('This version cannot be generated yet', 'waiting', e.message);
        void qc.invalidateQueries({ queryKey: ['eligibility', tenantId, creative.id] });
      } else if (e.kind === 'forbidden') toast('Your role cannot generate images here', 'blocked');
      else toast('Generation could not start', 'blocked', e.retryable ? 'Nothing was started. Try again in a moment.' : e.message);
      if (!e.retryable) pending.current = null;
    } finally {
      setStarting(false);
    }
  };

  return {
    /** The job for the current version, if this tab started one. */
    job: forCurrent ? job : undefined,
    active,
    starting,
    start,
    assetId,
    asset,
    /** True until it is known whether the current version has an image. */
    imagePending: !!creative && !creative.asset_id && !assetId && pkg.isPending,
  };
}
