import {
  useInfiniteQuery, useMutation, useQuery, useQueryClient,
  type InfiniteData, type UseInfiniteQueryResult, type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth, useSession } from '@/auth/AuthProvider';
import {
  policyAdminApi,
  POLICY_PAGE_MAX,
  type BundleState,
  type PolicyAuditEntry,
  type PolicyBundleDetail,
  type PolicyBundlePage,
  type PolicyClause,
  type PolicySource,
  type PolicyEdge,
  type PolicyIssue,
  type PolicyNode,
  type PolicyRuleRecord,
} from '@/api/policyAdmin';

/**
 * Data for the rulebook screens (NRC-20). Every key starts with
 * ['ws', tenant, 'policy-admin'] so switching organisation never shows another
 * tenant's rulebooks, and one invalidation refreshes them all after a change.
 */
const useTenant = (): string => useSession().context.tenant.tenant_id;
export const rulebookKeys = {
  all: (t: string) => ['ws', t, 'policy-admin'] as const,
  list: (t: string, state: BundleState | null) => ['ws', t, 'policy-admin', 'list', state ?? 'any'] as const,
  part: (t: string, id: string, part: string) => ['ws', t, 'policy-admin', 'bundle', id, part] as const,
};

const PAGE = POLICY_PAGE_MAX;

/** Rulebook versions, newest first, page by page (next_cursor is the last version shown). */
export function useRulebooks(state: BundleState | null): UseInfiniteQueryResult<InfiniteData<PolicyBundlePage, number | undefined>> {
  const t = useTenant();
  return useInfiniteQuery({
    queryKey: rulebookKeys.list(t, state),
    queryFn: ({ pageParam, signal }) => policyAdminApi.bundles({ state: state ?? undefined, before_version: pageParam, limit: PAGE }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useRulebook(id: string): UseQueryResult<PolicyBundleDetail> {
  const t = useTenant();
  return useQuery({ queryKey: rulebookKeys.part(t, id, 'detail'), queryFn: ({ signal }) => policyAdminApi.bundle(id, signal) });
}

/** Rules with their wordings. Proposed (unreviewed) items come only with policy:manage. */
export function useRulebookRules(id: string): UseQueryResult<PolicyRuleRecord[]> {
  const t = useTenant();
  const proposals = useAuth().can('policy:manage');
  return useQuery({
    queryKey: [...rulebookKeys.part(t, id, 'rules'), proposals],
    queryFn: async ({ signal }) => (await policyAdminApi.ruleRecords(id, proposals, signal)).items,
  });
}

export function useRulebookNodes(id: string): UseQueryResult<PolicyNode[]> {
  const t = useTenant();
  return useQuery({ queryKey: rulebookKeys.part(t, id, 'nodes'), queryFn: async ({ signal }) => (await policyAdminApi.nodes(id, signal)).items });
}

export function useRulebookEdges(id: string): UseQueryResult<PolicyEdge[]> {
  const t = useTenant();
  return useQuery({ queryKey: rulebookKeys.part(t, id, 'edges'), queryFn: async ({ signal }) => (await policyAdminApi.edges(id, signal)).items });
}

export function useRulebookIssues(id: string): UseQueryResult<PolicyIssue[]> {
  const t = useTenant();
  return useQuery({ queryKey: rulebookKeys.part(t, id, 'checks'), queryFn: async ({ signal }) => (await policyAdminApi.checks(id, signal)).issues });
}

export function useRulebookHistory(id: string): UseQueryResult<PolicyAuditEntry[]> {
  const t = useTenant();
  return useQuery({ queryKey: rulebookKeys.part(t, id, 'audit'), queryFn: async ({ signal }) => (await policyAdminApi.audit(id, { limit: POLICY_PAGE_MAX }, signal)).items });
}

/* ---------- Policy source files ---------- */

export function usePolicySources(): UseQueryResult<PolicySource[]> {
  const t = useTenant();
  return useQuery({ queryKey: [...rulebookKeys.all(t), 'sources'], queryFn: async ({ signal }) => (await policyAdminApi.sources({ limit: POLICY_PAGE_MAX }, signal)).items });
}

/** One source; looked at again every few seconds while its clauses are being read. */
export function usePolicySource(id: string): UseQueryResult<PolicySource> {
  const t = useTenant();
  return useQuery({
    queryKey: [...rulebookKeys.all(t), 'source', id],
    queryFn: ({ signal }) => policyAdminApi.source(id, signal),
    refetchInterval: (q) => (q.state.data && ['PENDING', 'EXTRACTING'].includes(q.state.data.extraction_state) ? 3000 : false),
  });
}

export function usePolicyClauses(id: string, enabled: boolean): UseQueryResult<PolicyClause[]> {
  const t = useTenant();
  return useQuery({
    queryKey: [...rulebookKeys.all(t), 'source', id, 'clauses'],
    queryFn: async ({ signal }) => (await policyAdminApi.clauses(id, signal)).items,
    enabled,
  });
}

/**
 * A change to a rulebook (status command, review, edit). On success everything
 * under the tenant is refreshed: the rulebooks, and the active policy the
 * validation screens read, because an activation or retirement changes it.
 */
export function useRulebookChange<A extends unknown[], R>(fn: (...args: A) => Promise<R>): UseMutationResult<R, Error, A> {
  const t = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', t] }),
  });
}

/** Rulebooks are open to policy administrators, owners and activators; never to creators (the API's PolicyReader). */
export function useCanReadRulebooks(): boolean {
  const { can } = useAuth();
  return can('policy:manage') || can('policy:approve') || can('policy:activate');
}
