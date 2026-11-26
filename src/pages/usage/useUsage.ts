import { keepPreviousData, useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type UseQueryResult, type InfiniteData } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { usageApi, type AttemptFilter, type AttemptPage, type Balance, type PriceList } from '@/api/usage';

/** Every key starts with the tenant id, so another organisation's usage is never shown. */
const useTenant = (): string => useSession().context.tenant.tenant_id;

export function useBalance(enabled = true): UseQueryResult<Balance> {
  const t = useTenant();
  return useQuery({ queryKey: ['usage', t, 'balance'], queryFn: ({ signal }) => usageApi.balance(signal), enabled, staleTime: 30_000 });
}

export function usePrices(enabled = true): UseQueryResult<PriceList> {
  const t = useTenant();
  return useQuery({ queryKey: ['usage', t, 'prices'], queryFn: ({ signal }) => usageApi.prices(signal), enabled, staleTime: 5 * 60_000 });
}

/** Attempts for a filter, a page at a time; totals cover the whole filtered range. */
export function useAttempts(filter: Omit<AttemptFilter, 'cursor'>, enabled = true): UseInfiniteQueryResult<InfiniteData<AttemptPage>> {
  const t = useTenant();
  return useInfiniteQuery({
    queryKey: ['usage', t, 'attempts', filter],
    queryFn: ({ pageParam, signal }) => usageApi.attempts({ ...filter, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData,
    enabled,
  });
}
