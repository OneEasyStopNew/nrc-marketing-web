import { ApiError } from './errors';
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
type RuleResultValue = Schemas['RuleResultValue'];
type GateResult = Schemas['GateResult'];
type SourceReference = Schemas['SourceReference'];
type TextSpan = Schemas['TextSpan'];
type ImageRegion = Schemas['ImageRegion'];
type CoverageGap = Schemas['CoverageGap'];

/** The run will not change any more; stop polling. */
export const TERMINAL_STATES: readonly ExecutionState[] = ['SUCCEEDED', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED'];
export const isTerminal = (s: ExecutionState): boolean => TERMINAL_STATES.includes(s);
export const isInProgress = (s: ExecutionState): boolean => s === 'QUEUED' || s === 'RUNNING' || s === 'WAITING_PROVIDER';

/** Every gate the contract defines, in display order. A gate missing from a run is "not assessed", never green. */
export const GATES: readonly Gate[] = ['completeness', 'study_facts', 'policy', 'media'];

/** A new key per intended run; the same key when retrying the same request. */
export const newValidationKey = () => `validate_${crypto.randomUUID().replace(/-/g, '')}`;

/** How long one read of a run may take before it is abandoned (the poll then retries). */
export const VALIDATION_READ_TIMEOUT_MS = 15_000;

// Seeded simulation ids are not UUIDs yet, so ids are checked as safe non-empty text (NRC-18 does the same).
const isSafeId = (id: string): boolean => id.trim() !== '' && !id.includes('/') && !id.includes('\\') && !id.includes('..');

export const validationsApi = {
  /** Only from an explicit "Validate" action, for a saved version. */
  start: async (body: { creative_id: string; creative_version: number; input_kind: ValidationInputKind; asset_id?: string }, idempotencyKey: string): Promise<ValidationAccepted> =>
    (await requestWithMeta<ValidationAccepted>('POST', '/validations', { body, idempotencyKey })).data,

  get: async (runId: string, signal?: AbortSignal): Promise<ValidationRun> => {
    if (!isSafeId(runId)) throw new ApiError(404);
    const timeout = AbortSignal.timeout(VALIDATION_READ_TIMEOUT_MS);
    const raw = await http.get<unknown>(`/validations/${encodeURIComponent(runId)}`, undefined, {
      signal: AbortSignal.any(signal ? [signal, timeout] : [timeout]),
    });
    return parseValidationRun(raw);
  },
};

// ---- Response parsing -------------------------------------------------------
// The body is server data: every field the UI reads is checked before it is used.
// A value outside the contract's lists (state, outcome, severity, gate, result,
// input_kind) rejects the whole response instead of being mapped to UNKNOWN:
// an unrecognised outcome must never be shown, or counted, as a pass.

const INPUT_KINDS = ['brief', 'text', 'image'] as const satisfies readonly ValidationInputKind[];
const EXECUTION_STATES = [
  'QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'NEEDS_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'UNKNOWN',
] as const satisfies readonly ExecutionState[];
const OUTCOMES = ['PASS', 'FAIL', 'NEEDS_REVIEW'] as const satisfies readonly Outcome[];
const SEVERITIES = ['critical', 'major', 'minor'] as const satisfies readonly Severity[];
const RULE_RESULTS = ['PASS', 'FAIL', 'NOT_APPLICABLE', 'UNABLE_TO_ASSESS'] as const satisfies readonly RuleResultValue[];

const isInputKind = (v: unknown): v is ValidationInputKind => INPUT_KINDS.some((k) => k === v);
const isExecutionState = (v: unknown): v is ExecutionState => EXECUTION_STATES.some((k) => k === v);
const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some((k) => k === v);
const isSeverity = (v: unknown): v is Severity => SEVERITIES.some((k) => k === v);
const isRuleResultValue = (v: unknown): v is RuleResultValue => RULE_RESULTS.some((k) => k === v);
const isGate = (v: unknown): v is Gate => GATES.some((k) => k === v);

/** The message never includes the response body: it can hold study or prompt text. */
const UNREADABLE_MESSAGE = 'The validation result could not be read';

class UnreadableRun extends Error {}
const bad = (): never => { throw new UnreadableRun(); };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : bad());
const str = (v: unknown): string => (typeof v === 'string' ? v : bad());
const nonEmptyStr = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : bad());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad());
const positiveInt = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : bad());
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad());
const nonNegative = (v: unknown): number => { const n = finite(v); return n >= 0 ? n : bad(); };
const nullable = <T>(v: unknown, parse: (x: unknown) => T): T | null => (v === null ? null : parse(v));
/** Optional field: absent stays absent, null stays null. */
const optional = <T>(v: unknown, parse: (x: unknown) => T): T | null | undefined => (v === undefined ? undefined : nullable(v, parse));
const list = <T>(v: unknown, parse: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map((item) => parse(item)) : bad());
const oneOf = <T>(v: unknown, guard: (x: unknown) => x is T): T => (guard(v) ? v : bad());

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const datetime = (v: unknown): string => (typeof v === 'string' && ISO_DATETIME.test(v) && !Number.isNaN(Date.parse(v)) ? v : bad());

const parseGate = (v: unknown): GateResult => {
  const r = record(v);
  return { gate: oneOf(r.gate, isGate), outcome: oneOf(r.outcome, isOutcome) };
};

const parseRuleResult = (v: unknown): RuleResult => {
  const r = record(v);
  return {
    rule_id: nonEmptyStr(r.rule_id),
    rule_version: positiveInt(r.rule_version),
    mandatory: bool(r.mandatory),
    result: oneOf(r.result, isRuleResultValue),
    reason: optional(r.reason, str),
  };
};

const parseSource = (v: unknown): SourceReference => {
  const r = record(v);
  return { source_id: str(r.source_id), clause: str(r.clause), excerpt: optional(r.excerpt, str) };
};

const parseTextSpan = (v: unknown): TextSpan => {
  const r = record(v);
  return { start: nonNegative(r.start), end: nonNegative(r.end) };
};

const parseImageRegion = (v: unknown): ImageRegion => {
  const r = record(v);
  return { x: finite(r.x), y: finite(r.y), width: finite(r.width), height: finite(r.height) };
};

const parseFinding = (v: unknown): Finding => {
  const r = record(v);
  return {
    rule_id: nonEmptyStr(r.rule_id),
    rule_version: positiveInt(r.rule_version),
    severity: oneOf(r.severity, isSeverity),
    explanation: str(r.explanation),
    source: parseSource(r.source),
    text_span: optional(r.text_span, parseTextSpan),
    image_region: optional(r.image_region, parseImageRegion),
    offending_excerpt: optional(r.offending_excerpt, str),
    suggested_correction: optional(r.suggested_correction, str),
    needs_human_decision: bool(r.needs_human_decision),
  };
};

const parseCoverageGap = (v: unknown): CoverageGap => {
  const r = record(v);
  return { rule_id: optional(r.rule_id, str), reason: str(r.reason) };
};

/**
 * Checks a GET /validations/{id} body against ValidationRunRead and returns it
 * typed. Throws an ApiError (kind "server", code INVALID_RESPONSE) when any
 * field is missing, mistyped or outside the contract's lists.
 */
export function parseValidationRun(raw: unknown): ValidationRun {
  try {
    const r = record(raw);
    return {
      validation_run_id: nonEmptyStr(r.validation_run_id),
      input_kind: oneOf(r.input_kind, isInputKind),
      creative_version: positiveInt(r.creative_version),
      state: oneOf(r.state, isExecutionState),
      outcome: nullable(r.outcome, (x) => oneOf(x, isOutcome)),
      is_current: bool(r.is_current),
      evaluated_at: nullable(r.evaluated_at, datetime),
      job_id: nonEmptyStr(r.job_id),
      input_hash: str(r.input_hash),
      asset_id: nullable(r.asset_id, str),
      study_snapshot_version: positiveInt(r.study_snapshot_version),
      policy_bundle_version: nullable(r.policy_bundle_version, str),
      gates: list(r.gates, parseGate),
      rule_results: list(r.rule_results, parseRuleResult),
      findings: list(r.findings, parseFinding),
      coverage_gaps: list(r.coverage_gaps, parseCoverageGap),
    };
  } catch (e) {
    if (e instanceof UnreadableRun) throw new ApiError(500, { code: 'INVALID_RESPONSE', message: UNREADABLE_MESSAGE });
    throw e;
  }
}

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
