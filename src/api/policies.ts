import { queryOptions, type QueryKeyWithDataTag, type UnusedSkipTokenOptions } from '@tanstack/react-query';
import { http } from './http';
import { ApiError, isApiError } from './errors';

/**
 * The tenant's active policy (NRC-20 viewer), read-only.
 *
 * Follows GET /policies/active as published on the "NRC Demo API's" page
 * (11 Nov 2026). The contract now exists as `PolicyBundleRead` on the backend
 * branch feature/NRC-7-policy-and-generation-eligibility (commit 298a067). It
 * is not in contracts/openapi.json / schema.d.ts yet: regenerate schema.d.ts
 * once that branch merges, then drop these hand-written types and keep only
 * the call and the parser.
 *
 * Wording (title, requirement, clause, excerpt) is shown exactly as supplied:
 * nothing here rewrites, trims or shortens it.
 */

/** The gates this build knows. A newer backend may send others; see `ActivePolicyRule.gate`. */
export type PolicyGate = 'completeness' | 'study_facts' | 'policy' | 'media';
export type PolicySeverity = 'critical' | 'major' | 'minor';
/** The inputs this build knows. A newer backend may send others; see `ActivePolicyRule.applies_to`. */
export type PolicyInput = 'brief' | 'text' | 'image';

export interface PolicySource {
  /** Source document, e.g. "fda:information-sheet:recruiting-study-subjects" or "study-snapshot". */
  source_id: string;
  /** Section or clause within the source. */
  clause: string;
  /** Quoted source text, when supplied. */
  excerpt: string | null;
}

export interface ActivePolicyRule {
  rule_id: string;
  rule_version: number;
  title: string;
  requirement: string;
  /** Usually a `PolicyGate`; a value from a newer backend is shown as sent. */
  gate: string;
  severity: PolicySeverity;
  /** A failed mandatory rule fails validation; a failed optional rule needs a human decision. */
  mandatory: boolean;
  /** Usually `PolicyInput` values; a value from a newer backend is shown as sent. */
  applies_to: string[];
  source: PolicySource;
}

export interface ActivePolicy {
  policy_bundle_id: string;
  version: number;
  name: string;
  source_ref: string;
  /** Synthetic demo rules, not the approved IPB rules. */
  is_synthetic: boolean;
  approved_by: string;
  approved_at: string;
  rules: ActivePolicyRule[];
}

/** Upper bound on rules in one bundle (mirrors PolicyBundleRead); a larger body is refused, not rendered. */
export const MAX_POLICY_RULES = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULE_ID = /^[A-Z][A-Z0-9-]{1,39}$/;
// ISO-8601 date-time that states its offset: a time without one cannot be placed on the timeline.
const DATETIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SEVERITIES: readonly PolicySeverity[] = ['critical', 'major', 'minor'];

// Never put server values in this message: it is shown to the user and can end up in logs.
function invalid(): never {
  throw new ApiError(500, {
    code: 'INVALID_RESPONSE',
    message: 'The active policy came back in an unexpected shape.',
    retryable: false,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isSeverity = (v: unknown): v is PolicySeverity => SEVERITIES.some((s) => s === v);

function str(v: unknown): string {
  return typeof v === 'string' ? v : invalid();
}

function nonEmptyStr(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : invalid();
}

function bool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : invalid();
}

function positiveInt(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : invalid();
}

function matching(v: unknown, pattern: RegExp): string {
  return typeof v === 'string' && pattern.test(v) ? v : invalid();
}

function datetimeWithOffset(v: unknown): string {
  const s = matching(v, DATETIME_WITH_OFFSET);
  return Number.isNaN(Date.parse(s)) ? invalid() : s;
}

function parseSource(v: unknown): PolicySource {
  if (!isRecord(v)) return invalid();
  const { excerpt } = v;
  return {
    source_id: str(v.source_id),
    clause: str(v.clause),
    excerpt: excerpt === null ? null : str(excerpt),
  };
}

function parseRule(v: unknown): ActivePolicyRule {
  if (!isRecord(v)) return invalid();
  const { severity, applies_to } = v;
  if (!isSeverity(severity)) return invalid();
  if (!Array.isArray(applies_to) || applies_to.length === 0) return invalid();
  return {
    rule_id: matching(v.rule_id, RULE_ID),
    rule_version: positiveInt(v.rule_version),
    title: nonEmptyStr(v.title),
    requirement: nonEmptyStr(v.requirement),
    gate: nonEmptyStr(v.gate),
    severity,
    mandatory: bool(v.mandatory),
    applies_to: applies_to.map(str),
    source: parseSource(v.source),
  };
}

/**
 * Checks the body of GET /policies/active and returns a new object with the
 * known fields only. `is_synthetic` is the one flag behind the "Synthetic demo
 * rules" warning, so a missing or mistyped value must fail loudly rather than
 * show placeholder rules as the approved policy.
 */
export function parseActivePolicy(body: unknown): ActivePolicy {
  if (!isRecord(body)) return invalid();
  const { rules } = body;
  if (!Array.isArray(rules) || rules.length > MAX_POLICY_RULES) return invalid();
  return {
    policy_bundle_id: matching(body.policy_bundle_id, UUID),
    version: positiveInt(body.version),
    name: str(body.name),
    source_ref: str(body.source_ref),
    is_synthetic: bool(body.is_synthetic),
    approved_by: str(body.approved_by),
    approved_at: datetimeWithOffset(body.approved_at),
    rules: rules.map(parseRule),
  };
}

export const policiesApi: { active: (signal?: AbortSignal) => Promise<ActivePolicy> } = {
  // http.get<unknown>: the type argument is not a check, parseActivePolicy is.
  active: async (signal) => parseActivePolicy(await http.get<unknown>('/policies/active', undefined, { signal })),
};

type ActivePolicyKey = readonly ['ws', string, 'policy', 'active'];

// Every read and every invalidation of the active policy goes through this key (tenant id included).
export const policyKeys: { active: (tenantId: string) => ActivePolicyKey } = {
  active: (tenantId) => ['ws', tenantId, 'policy', 'active'] as const,
};

export const activePolicyQuery = (
  tenantId: string,
): UnusedSkipTokenOptions<ActivePolicy, Error, ActivePolicy, ActivePolicyKey> &
  QueryKeyWithDataTag<ActivePolicyKey, ActivePolicy, Error> =>
  queryOptions({
    queryKey: policyKeys.active(tenantId),
    queryFn: ({ signal }) => policiesApi.active(signal),
  });

/**
 * The tenant has no active (approved) policy. The demo page does not document
 * this error yet; a 404 from this route is the only reading of "nothing
 * active" (GET /context reports the same case as active_policy: null).
 * It is a setup gap, never "no violations".
 */
export const isNoActivePolicy = (e: unknown): e is ApiError => isApiError(e) && e.kind === 'not_found';
