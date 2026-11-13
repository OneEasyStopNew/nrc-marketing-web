import { queryOptions, useQuery, type QueryKeyWithDataTag, type UnusedSkipTokenOptions, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { isApiError, type ApiError } from './errors';
import { http } from './http';
import * as S from './schemas.gen';

/**
 * The tenant's active policy: the rules validation checks content against
 * (GET /policies/active). Read-only here. Findings cite these rules by
 * `rule_id`, so the validation screens use this to show each rule's title and
 * wording, and the Rules section (NRC-20) shows the whole policy. Both read the
 * same cache entry.
 *
 * Wording (title, requirement, clause, excerpt) is shown exactly as supplied:
 * nothing here rewrites, trims or shortens it.
 */

export type PolicyBundle = S.PolicyBundleRead;
export type ActiveRule = S.PolicyRule;

/** Upper bound on rules in one bundle (PR #4 review): a larger answer is treated as malformed. */
export const MAX_POLICY_RULES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULE_ID = /^[A-Z][A-Z0-9-]{1,39}$/;
// Rules change rarely; validation screens and the viewer can share one answer for a few minutes.
const POLICY_STALE_MS = 5 * 60_000;

/**
 * The contract schema plus the checks it can't express (Dinesh's PR #4 review):
 * a UUID bundle id, the rule id pattern, at least one input per rule and at most
 * MAX_POLICY_RULES rules. `is_synthetic` is required by the contract itself, so
 * synthetic rules can never appear without the warning. Messages name fields,
 * never values.
 */
export const ActivePolicySchema = S.PolicyBundleRead.superRefine((p, ctx) => {
  if (!UUID.test(p.policy_bundle_id)) ctx.addIssue({ code: 'custom', path: ['policy_bundle_id'], message: 'must be a UUID' });
  if (p.rules.length > MAX_POLICY_RULES) ctx.addIssue({ code: 'custom', path: ['rules'], message: `must have at most ${MAX_POLICY_RULES} rules` });
  p.rules.forEach((r, i) => {
    if (!RULE_ID.test(r.rule_id)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'rule_id'], message: 'has an unexpected format' });
    if (r.applies_to.length === 0) ctx.addIssue({ code: 'custom', path: ['rules', i, 'applies_to'], message: 'must name at least one input' });
  });
});

export const policyApi = {
  active: (signal?: AbortSignal): Promise<PolicyBundle> => http.get('/policies/active', ActivePolicySchema, { signal }),
};

type ActivePolicyKey = readonly ['ws', string, 'policy', 'active'];

// Every read and invalidation of the active policy goes through this key. It starts with
// ['ws', tenant] so a tenant-wide refresh covers it too.
export const policyKeys: { active: (tenantId: string) => ActivePolicyKey } = {
  active: (tenantId) => ['ws', tenantId, 'policy', 'active'] as const,
};

export const activePolicyQuery = (
  tenantId: string,
): UnusedSkipTokenOptions<PolicyBundle, Error, PolicyBundle, ActivePolicyKey> & QueryKeyWithDataTag<ActivePolicyKey, PolicyBundle, Error> =>
  queryOptions({
    queryKey: policyKeys.active(tenantId),
    queryFn: ({ signal }) => policyApi.active(signal),
    staleTime: POLICY_STALE_MS,
    retry: false,
  });

/**
 * The active policy, when the tenant has one. Disabled while GET /context reports
 * no active policy, so callers must treat "no context policy" as "no policy", not
 * as loading (see policyLoadState in pages/rules/activePolicy.ts).
 */
export function useActivePolicy(): UseQueryResult<PolicyBundle> {
  const { context } = useSession();
  return useQuery({ ...activePolicyQuery(context.tenant.tenant_id), enabled: !!context.active_policy });
}

/**
 * The tenant has no active (approved) policy: GET /policies/active answers 404
 * NOT_FOUND (confirmed by Dinesh, 11 Nov). It is a setup gap, never "no violations".
 */
export const isNoActivePolicy = (e: unknown): e is ApiError => isApiError(e) && e.kind === 'not_found';

/** `rule_id` → rule, for the version a finding names; undefined when the policy moved on. */
export const ruleLookup = (policy: PolicyBundle | undefined) => (ruleId: string, ruleVersion: number): ActiveRule | undefined =>
  policy?.rules.find((r) => r.rule_id === ruleId && r.rule_version === ruleVersion);
