import { http, requestWithMeta } from './http';
import type { components } from './schema';

/**
 * Validation runs (NRC-7 text, NRC-8 image), per contracts/openapi.json.
 * POST /validations starts a run; GET /validations/{id} is polled until the
 * run reaches a terminal execution state. Execution state (queued, running,
 * failed) is separate from the policy outcome (PASS, FAIL, NEEDS_REVIEW).
 */

type Schemas = components['schemas'];
export type ValidationRun = Schemas['ValidationRunRead'];
export type ValidationAccepted = Schemas['ValidationAccepted'];
export type ValidationInputKind = Schemas['ValidationInputKind'];
export type ExecutionState = Schemas['ExecutionState'];
export type Finding = Schemas['Finding'];
export type Gate = Schemas['Gate'];
export type Outcome = Schemas['Outcome'];
export type RuleResult = Schemas['RuleResult'];
export type Severity = Schemas['Severity'];

/** The run will not change any more; stop polling. */
export const TERMINAL_STATES: readonly ExecutionState[] = ['SUCCEEDED', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED'];
export const isTerminal = (s: ExecutionState) => TERMINAL_STATES.includes(s);
export const isInProgress = (s: ExecutionState) => s === 'QUEUED' || s === 'RUNNING' || s === 'WAITING_PROVIDER';

/** Every gate the contract defines, in display order. A gate missing from a run is "not assessed", never green. */
export const GATES: readonly Gate[] = ['completeness', 'study_facts', 'policy', 'media'];

/** A new key per intended run; the same key when retrying the same request. */
export const newValidationKey = () => `validate_${crypto.randomUUID().replace(/-/g, '')}`;

export const validationsApi = {
  /** Only from an explicit "Validate" action, for a saved version. */
  start: async (body: { creative_id: string; creative_version: number; input_kind: ValidationInputKind; asset_id?: string }, idempotencyKey: string) =>
    (await requestWithMeta<ValidationAccepted>('POST', '/validations', { body, idempotencyKey })).data,

  get: (runId: string, signal?: AbortSignal) =>
    http.get<ValidationRun>(`/validations/${encodeURIComponent(runId)}`, undefined, { signal }),
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
export const passedAssessedChecks = (run: ValidationRun) =>
  run.state === 'SUCCEEDED'
  && run.outcome === 'PASS'
  && run.gates.length > 0
  && run.gates.every((g) => g.outcome === 'PASS')
  && unassessedMandatory(run).length === 0;
