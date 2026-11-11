import { http } from './http';
import { isApiError } from './errors';

/**
 * The tenant's active policy (NRC-20 viewer), read-only.
 *
 * Follows Dinesh's GET /policies/active as published on the "NRC Demo API's"
 * page (11 Nov 2026), field for field. It is not in contracts/openapi.json /
 * schema.d.ts yet; when his contract merges, these types move to the
 * generated client (components['schemas'][...]) and this file keeps only the call.
 *
 * Wording (title, requirement, clause, excerpt) is shown exactly as supplied:
 * nothing here rewrites, trims or shortens it.
 */

export type PolicyGate = 'completeness' | 'study_facts' | 'policy' | 'media';
export type PolicySeverity = 'critical' | 'major' | 'minor';
/** Which inputs a rule checks. */
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
  gate: PolicyGate;
  severity: PolicySeverity;
  /** A failed mandatory rule fails validation; a failed optional rule needs a human decision. */
  mandatory: boolean;
  applies_to: PolicyInput[];
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

export const policiesApi = {
  active: (signal?: AbortSignal) => http.get<ActivePolicy>('/policies/active', undefined, { signal }),
};

/**
 * The tenant has no active (approved) policy. The demo page does not document
 * this error yet; a 404 from this route is the only reading of "nothing
 * active" (GET /context reports the same case as active_policy: null).
 * It is a setup gap, never "no violations".
 */
export const isNoActivePolicy = (e: unknown) => isApiError(e) && e.kind === 'not_found';
