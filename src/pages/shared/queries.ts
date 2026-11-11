import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { workspaceApi } from '@/api/workspace';
import { policiesApi } from '@/api/policies';

/**
 * Data for the workspace sections and dashboards. Every key starts with the
 * tenant id, so switching organisation never shows another tenant's rows.
 */
const useTenant = () => useSession().context.tenant.tenant_id;

export const useDrafts = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'drafts'], queryFn: ({ signal }) => workspaceApi.drafts(signal), enabled });
};
export const useActivity = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'activity'], queryFn: ({ signal }) => workspaceApi.activity(signal), enabled });
};
export const useMedia = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'media'], queryFn: ({ signal }) => workspaceApi.media(signal), enabled });
};
export const useRules = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'rules'], queryFn: ({ signal }) => workspaceApi.rules(signal), enabled });
};
/** The tenant's active policy (NRC-20, read-only). */
export const useActivePolicy = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'policy-active'], queryFn: ({ signal }) => policiesApi.active(signal), enabled });
};
export const useApprovals = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'approvals'], queryFn: ({ signal }) => workspaceApi.approvals(signal), enabled });
};
export const useAccounts = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'accounts'], queryFn: ({ signal }) => workspaceApi.accounts(signal), enabled });
};
export const usePublications = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'publications'], queryFn: ({ signal }) => workspaceApi.publications(signal), enabled });
};
export const useMembers = (enabled = true) => {
  const t = useTenant();
  return useQuery({ queryKey: ['ws', t, 'members'], queryFn: ({ signal }) => workspaceApi.members(signal), enabled });
};

/** A write that refreshes the listed collections (and the activity feed) when it succeeds. */
export function useWorkspaceMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>, refresh: string[]) {
  const t = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => {
      for (const k of [...refresh, 'activity']) void qc.invalidateQueries({ queryKey: ['ws', t, k] });
    },
  });
}
