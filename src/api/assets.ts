import { useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { isApiError } from './errors';
import { http } from './http';
import * as S from './schemas.gen';

/**
 * Images (D3/D4) and the review-draft export (D5), per contracts/openapi.json.
 * `download_url` is short-lived: it is used to show the image and never
 * stored, logged or written into a downloaded file.
 */

export type Asset = S.AssetRead;
export type ExportManifest = S.ExportManifest;
export type MediaItem = S.MediaItem;
export type MediaPage = S.MediaPage;

const MEDIA_PAGE_SIZE = 50;

export const assetsApi = {
  get: (assetId: string, signal?: AbortSignal): Promise<Asset> => http.get(`/assets/${encodeURIComponent(assetId)}`, S.AssetRead, { signal }),
  /** Finished generated images in this tenant, newest first. Uploads are not supported yet. */
  media: (cursor: string | null, signal?: AbortSignal): Promise<MediaPage> => {
    const q = new URLSearchParams({ limit: String(MEDIA_PAGE_SIZE) });
    if (cursor) q.set('cursor', cursor);
    return http.get(`/media?${q.toString()}`, S.MediaPage, { signal });
  },
  exportDraft: (creativeId: string, signal?: AbortSignal): Promise<ExportManifest> =>
    http.get(`/creatives/${encodeURIComponent(creativeId)}/export`, S.ExportManifest, { signal }),
};

/** The asset and a fresh link to it. Refetched before the link expires. */
export function useAsset(assetId: string | null | undefined): UseQueryResult<Asset> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['asset', context.tenant.tenant_id, assetId],
    // enabled guarantees assetId is set when this runs.
    queryFn: ({ signal }) => assetsApi.get(assetId!, signal),
    enabled: !!assetId,
    staleTime: 4 * 60_000,
    refetchInterval: (q) => {
      const exp = q.state.data?.download_url_expires_at;
      if (!exp) return false;
      return Math.max(30_000, Date.parse(exp) - Date.now() - 60_000);
    },
  });
}

/**
 * The media library, a page at a time (GET /media). The links in it are
 * short-lived, so the loaded pages are fetched again shortly before the first
 * one expires.
 */
export function useMediaLibrary(): UseInfiniteQueryResult<InfiniteData<MediaPage, string | null>> {
  const { context } = useSession();
  return useInfiniteQuery({
    // Same key shape as the workspace lists, so useWorkspaceMutation(…, ['media-library']) refreshes it.
    queryKey: ['ws', context.tenant.tenant_id, 'media-library'],
    queryFn: ({ pageParam, signal }) => assetsApi.media(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 60_000,
    refetchInterval: (q) => {
      const ends = (q.state.data?.pages ?? []).flatMap((p) => p.items.map((m) => m.download_url_expires_at)).filter((e): e is string => !!e).map(Date.parse);
      if (!ends.length) return false;
      return Math.max(30_000, Math.min(...ends) - Date.now() - 60_000);
    },
  });
}

/**
 * The review package for the current version of a draft, or null while that
 * version has no image yet (409 EXPORT_NOT_READY). It is how the screens find
 * the image that belongs to the current version.
 */
export function useDraftExport(creativeId: string | undefined, version: number | undefined): UseQueryResult<ExportManifest | null> {
  const { context } = useSession();
  return useQuery({
    queryKey: ['draft-export', context.tenant.tenant_id, creativeId, version],
    queryFn: async ({ signal }) => {
      try {
        return await assetsApi.exportDraft(creativeId!, signal);
      } catch (e) {
        if (isApiError(e) && (e.code === 'EXPORT_NOT_READY' || e.kind === 'invalid' || e.kind === 'not_implemented')) return null;
        throw e;
      }
    },
    enabled: !!creativeId && version != null,
    staleTime: 0,
    retry: false,
  });
}

/** A stand-in picture from a demo or simulation backend, not a generated image. Always said on screen. */
export const isPlaceholderImage = (a: Pick<Asset, 'provider'>): boolean => a.provider === 'simulation' || a.provider === 'demo-stub';

/**
 * The manifest as saved to disk: the short-lived image link is removed, so a
 * downloaded file never carries a working signed URL.
 */
export function manifestForDownload(m: ExportManifest): Omit<ExportManifest, 'image'> & { image: Omit<Asset, 'download_url' | 'download_url_expires_at'> } {
  const { download_url: _url, download_url_expires_at: _exp, ...image } = m.image;
  return { ...m, image };
}

export const shortHash = (sha: string): string => sha.slice(0, 12);
