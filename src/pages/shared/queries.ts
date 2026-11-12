import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { workspaceApi, type ActivityItem, type ApprovalRequest, type DraftSummary, type MediaAsset, type Member, type PolicyRule, type Publication, type SocialAccount } from '@/api/workspace';

/**
 * Data for the workspace sections and dashboards. Every key starts with the
 * tenant id, so switching organisation never shows another tenant's rows.
 */
const useTenant = (): string => useSession().context.tenant.tenant_id;

export const useDrafts = (enabled = true): UseQueryResult<DraftSummary[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'drafts'], queryFn: ({ signal }) => workspaceApi.drafts(signal), enabled });
};
export const useActivity = (enabled = true): UseQueryResult<ActivityItem[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'activity'], queryFn: ({ signal }) => workspaceApi.activity(signal), enabled });
};
export const useMedia = (enabled = true): UseQueryResult<MediaAsset[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'media'], queryFn: ({ signal }) => workspaceApi.media(signal), enabled });
};
export const useRules = (enabled = true): UseQueryResult<PolicyRule[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'rules'], queryFn: ({ signal }) => workspaceApi.rules(signal), enabled });
};
export const useApprovals = (enabled = true): UseQueryResult<ApprovalRequest[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'approvals'], queryFn: ({ signal }) => workspaceApi.approvals(signal), enabled });
};
export const useAccounts = (enabled = true): UseQueryResult<SocialAccount[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'accounts'], queryFn: ({ signal }) => workspaceApi.accounts(signal), enabled });
};
export const usePublications = (enabled = true): UseQueryResult<Publication[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'publications'], queryFn: ({ signal }) => workspaceApi.publications(signal), enabled });
};
export const useMembers = (enabled = true): UseQueryResult<Member[]> => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'members'], queryFn: ({ signal }) => workspaceApi.members(signal), enabled });
};

/** A write that refreshes the listed collections (and the activity feed) when it succeeds. */
export function useWorkspaceMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>, refresh: string[]): UseMutationResult<R, Error, A> {
  const t = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => {
      for (const k of [...refresh, 'activity']) void qc.invalidateQueries({ queryKey: ['ws', t, k] });
    },
  });
}
