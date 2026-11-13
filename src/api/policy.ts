import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { http } from './http';
import * as S from './schemas.gen';

/**
 * The tenant's active policy: the rules validation checks content against
 * (GET /policies/active). Read-only here. Findings cite these rules by
 * `rule_id`, so the screens use this to show each rule's title and wording.
 */

export type PolicyBundle = S.PolicyBundleRead;
export type ActiveRule = S.PolicyRule;

export const policyApi = {
  active: (signal?: AbortSignal): Promise<PolicyBundle> => http.get('/policies/active', S.PolicyBundleRead, { signal }),
};

/** The active policy, when the tenant has one. Rules change rarely, so it is kept for a few minutes. */
export function useActivePolicy(): UseQueryResult<PolicyBundle> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['policy-active', context.tenant.tenant_id],
    queryFn: ({ signal }) => policyApi.active(signal),
    enabled: !!context.active_policy,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** `rule_id` → rule, for the version a finding names; undefined when the policy moved on. */
export const ruleLookup = (policy: PolicyBundle | undefined) => (ruleId: string, ruleVersion: number): ActiveRule | undefined =>
  policy?.rules.find((r) => r.rule_id === ruleId && r.rule_version === ruleVersion);
