import { useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { clientPostsApi, newClientKey, type AiFix, type ClientCheck, type ClientPostVersion, type VersionedPost } from '@/api/clientPosts';
import { isApiError } from '@/api/errors';
import { isTerminal } from '@/api/validations';
import { useToast } from '@/components/ui/Toast';
import { useInDevelopment } from '@/pages/shared/ui';
import { pollDelay } from '@/pages/validation/useValidation';

/**
 * Whether "Check an existing post" is offered. Real builds wait for the
 * backend (config/inDevelopment.ts, validationOnly); the simulation shows it.
 */
export function useValidationOnlyAvailable(): boolean {
  return !useInDevelopment('validationOnly');
}

/** Whether the paid AI fix of a flagged image is offered (IN_DEVELOPMENT.clientAiFix). */
export function useAiFixAvailable(): boolean {
  return !useInDevelopment('clientAiFix');
}

/** One AI fix, polled with backoff until it finishes. */
export function useAiFix(postId: string, fixId: string | null): UseQueryResult<AiFix> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['client-ai-fix', context.tenant.tenant_id, postId, fixId],
    queryFn: ({ signal }) => clientPostsApi.getAiFix(postId, fixId ?? '', signal),
    enabled: !!fixId,
    refetchInterval: (q) => {
      const f = q.state.data;
      if (!f || q.state.error || isTerminal(f.state)) return false;
      return pollDelay(q.state.dataUpdateCount);
    },
    staleTime: 0,
  });
}

export const postKey =(tenantId: string, postId: string) => ['client-post', tenantId, postId] as const;
const checkKey = (tenantId: string, postId: string) => ['client-post-check', tenantId, postId] as const;

/** The post with its ETag. Read fresh each time: preview links are short-lived. */
export function useClientPost(postId: string): UseQueryResult<VersionedPost> {
  const { context } = useSession();
  return useQuery({
    queryKey: postKey(context.tenant.tenant_id, postId),
    queryFn: ({ signal }) => clientPostsApi.get(postId, signal),
    staleTime: 0,
  });
}

/**
 * The post's latest check, polled with backoff until it finishes. "Never
 * checked" (404) is a normal state here, answered as null.
 */
export function useLatestCheck(postId: string): UseQueryResult<ClientCheck | null> {
  const { context } = useSession();
  return useQuery({
    queryKey: checkKey(context.tenant.tenant_id, postId),
    queryFn: async ({ signal }) => {
      try {
        return await clientPostsApi.latestCheck(postId, signal);
      } catch (e) {
        if (isApiError(e) && e.kind === 'not_found') return null;
        throw e;
      }
    },
    refetchInterval: (q) => {
      const c = q.state.data;
      if (!c || q.state.error || isTerminal(c.state)) return false;
      return pollDelay(q.state.dataUpdateCount);
    },
    retry: (count, e) => !(isApiError(e) && !e.retryable) && count < 2,
    staleTime: 0,
  });
}

/**
 * Every saved version with its latest check. Read again when the post gets a
 * new version or its latest check moves on (`checkStamp`).
 */
export function useClientVersions(postId: string, version: number, checkStamp: string): UseQueryResult<ClientPostVersion[]> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['client-post-versions', context.tenant.tenant_id, postId, version, checkStamp],
    queryFn: ({ signal }) => clientPostsApi.versions(postId, signal),
    placeholderData: keepPreviousData,
  });
}

/**
 * Starts a check of one saved version. A retry of the same request reuses its
 * key, so a double click or a lost answer starts one check. Never generates.
 */
export function useStartCheck(postId: string): { start: (version: number) => Promise<boolean>; starting: boolean } {
  const { context } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  const pending = useRef<{ version: number; key: string } | null>(null);

  const start = async (version: number) => {
    if (pending.current?.version !== version) pending.current = { version, key: newClientKey('check') };
    setStarting(true);
    try {
      await clientPostsApi.startCheck(postId, version, pending.current.key);
      pending.current = null;
      await qc.invalidateQueries({ queryKey: checkKey(context.tenant.tenant_id, postId) });
      return true;
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.code === 'VERSION_CONFLICT') toast('The post changed', 'waiting', 'Reload it and check the latest version.');
      else if (e.kind === 'forbidden') toast('Your role cannot run checks here', 'blocked');
      else toast('The check could not start', 'blocked', e.retryable ? 'Try again in a moment.' : e.message);
      if (!e.retryable) pending.current = null;
      return false;
    } finally {
      setStarting(false);
    }
  };
  return { start, starting };
}
