import { z } from 'zod';
import { ApiError } from './errors';
import { http, requestWithMeta } from './http';
import * as S from './schemas.gen';
import { ChannelOption } from './session';

/**
 * Validation runs (NRC-7 text, NRC-8 image), per contracts/openapi.json.
 * POST /validations starts a run; GET /validations/{id} is polled until the
 * run reaches a terminal execution state. Execution state (queued, running,
 * failed) is separate from the policy outcome (PASS, FAIL, NEEDS_REVIEW).
 */

/**
 * A finding may carry the exact words to put in place of the flagged span
 * (replacement_text, proposed for the correction service, NRC-11).
 * suggested_correction stays advice; only replacement_text is ever applied.
 */
const FindingWithFix = S.Finding.extend({ replacement_text: z.string().nullable().optional() });
const RunWithFixes = S.ValidationRunRead.extend({ findings: z.array(FindingWithFix) });

export type ValidationRun = z.infer<typeof RunWithFixes>;
export type ValidationAccepted = S.ValidationAccepted;
/** ValidationContextRead, with the channels drafts may already use (see session.ts). */
const ContextSchema = S.ValidationContextRead.extend({ channel: ChannelOption });
export type ValidationContext = z.infer<typeof ContextSchema>;
export type ContextRule = S.ContextRuleRead;
export type ContextEvidence = S.ContextEvidenceRead;
export type MissingContext = S.MissingContextRead;
export type ValidationInputKind = S.ValidationInputKind;
/** Closed: a state the contract does not list fails as CONTRACT_MISMATCH instead of being taken as finished. */
export type ExecutionState = S.ExecutionState;
export type Finding = z.infer<typeof FindingWithFix>;
export type Gate = S.Gate;
export type Outcome = S.Outcome;
export type RuleResult = S.RuleResult;
export type Severity = S.Severity;

/** The run will not change any more; stop polling. */
export const TERMINAL_STATES: readonly ExecutionState[] = ['SUCCEEDED', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED'];
export const isTerminal = (s: ExecutionState): boolean => TERMINAL_STATES.includes(s);
export const isInProgress = (s: ExecutionState): boolean => s === 'QUEUED' || s === 'RUNNING' || s === 'WAITING_PROVIDER';

/** Every gate the contract defines, in display order. A gate missing from a run is "not assessed", never green. */
export const GATES: readonly Gate[] = ['completeness', 'study_facts', 'policy', 'media'];

/** A new key per intended run; the same key when retrying the same request. */
export const newValidationKey = (): string => `validate_${crypto.randomUUID().replace(/-/g, '')}`;

/** How long one read of a run may take before it is abandoned (the poll then retries). */
export const VALIDATION_READ_TIMEOUT_MS = 15_000;

// The seeded simulation run id is not a UUID yet, so ids are checked as safe non-empty text (NRC-18 does the same).
const isSafeId = (id: string): boolean => id.trim() !== '' && !id.includes('/') && !id.includes('\\') && !id.includes('..');

export const validationsApi = {
  /** Only from an explicit "Validate" action, for a saved version. */
  start: async (body: { creative_id: string; creative_version: number; input_kind: ValidationInputKind; asset_id?: string }, idempotencyKey: string): Promise<ValidationAccepted> =>
    (await requestWithMeta('POST', '/validations', S.ValidationAccepted, { body, idempotencyKey })).data,

  get: async (runId: string, signal?: AbortSignal): Promise<ValidationRun> => {
    if (!isSafeId(runId)) throw new ApiError(404);
    const timeout = AbortSignal.timeout(VALIDATION_READ_TIMEOUT_MS);
    return http.get(`/validations/${encodeURIComponent(runId)}`, RunWithFixes, {
      signal: AbortSignal.any(signal ? [signal, timeout] : [timeout]),
    });
  },

  /**
   * The policy context a brief or caption run was checked against (NRC-5):
   * the rules selected for it, their source text, and what retrieval could
   * not settle. Null when the run stored none (404 CONTEXT_NOT_AVAILABLE:
   * older runs, image runs, or context that could not be gathered).
   */
  context: async (runId: string, signal?: AbortSignal): Promise<ValidationContext | null> => {
    if (!isSafeId(runId)) throw new ApiError(404);
    const timeout = AbortSignal.timeout(VALIDATION_READ_TIMEOUT_MS);
    try {
      return await http.get(`/validations/${encodeURIComponent(runId)}/context`, ContextSchema, {
        signal: AbortSignal.any(signal ? [signal, timeout] : [timeout]),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONTEXT_NOT_AVAILABLE') return null;
      throw e;
    }
  },
};

/**
 * Required checks that could not be assessed. Any one of these blocks the
 * brief from moving on, whatever the overall outcome says.
 */
export const unassessedMandatory = (run: ValidationRun): RuleResult[] =>
  run.rule_results.filter((r) => r.mandatory && r.result === 'UNABLE_TO_ASSESS');

/**
 * True only when the backend says PASS, every gate it reported passed, and no
 * required check was left unassessed. An empty findings list alone never
 * counts as passing.
 */
export const passedAssessedChecks = (run: ValidationRun): boolean =>
  run.state === 'SUCCEEDED'
  && run.outcome === 'PASS'
  && run.gates.length > 0
  && run.gates.every((g) => g.outcome === 'PASS')
  && unassessedMandatory(run).length === 0;
