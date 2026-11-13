import { queryOptions, useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { useSession } from '@/auth/AuthProvider';
import { SIMULATION_BUILD } from '@/config/env';
import { safeImageSrc } from '@/lib/safeUrl';
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
const SHA256_HEX = /^[0-9a-f]{64}$/;

interface ImageChecks {
  /** The simulation's data:image placeholders are drawable only in a simulation build. */
  allowDataImage: boolean;
}

// What the contract cannot say but the screens rely on: the link becomes an <img src>, the size a frame ratio.
const imageLink = (checks: ImageChecks): z.ZodNullable<z.ZodString> =>
  z.string().refine((v) => safeImageSrc(v, checks) !== null, 'unexpected image link scheme').nullable();
const pixels = z.number().int().positive();

/** S.AssetRead plus the checks the preview needs: an https link, a positive size and a full SHA-256. */
export const assetReadSchema = (checks: ImageChecks): z.ZodType<Asset> =>
  S.AssetRead.extend({
    width_px: pixels,
    height_px: pixels,
    size_bytes: z.number().int().nonnegative(),
    checksum_sha256: z.string().regex(SHA256_HEX),
    download_url: imageLink(checks),
  });

/** S.MediaItem with the same link and size checks: the library draws these links too. */
export const mediaItemSchema = (checks: ImageChecks): z.ZodType<MediaItem> =>
  S.MediaItem.extend({ width_px: pixels, height_px: pixels, download_url: imageLink(checks) });

const BUILD_CHECKS: ImageChecks = { allowDataImage: SIMULATION_BUILD };
const AssetReadChecked = assetReadSchema(BUILD_CHECKS);
const MediaPageChecked = S.MediaPage.extend({ items: z.array(mediaItemSchema(BUILD_CHECKS)) });

export const assetsApi = {
  get: (assetId: string, signal?: AbortSignal): Promise<Asset> =>
    http.get(`/assets/${encodeURIComponent(assetId)}`, AssetReadChecked, { signal }),
  /** Finished generated images in this tenant, newest first. Uploads are not supported yet. */
  media: (cursor: string | null, signal?: AbortSignal): Promise<MediaPage> => {
    const q = new URLSearchParams({ limit: String(MEDIA_PAGE_SIZE) });
    if (cursor) q.set('cursor', cursor);
    return http.get(`/media?${q.toString()}`, MediaPageChecked, { signal });
  },
  exportDraft: (creativeId: string, signal?: AbortSignal): Promise<ExportManifest> =>
    http.get(`/creatives/${encodeURIComponent(creativeId)}/export`, S.ExportManifest, { signal }),
};

type AssetKey = readonly ['asset', string, string];
type DraftExportsKey = readonly ['draft-export', string, string | undefined];
type DraftExportKey = readonly ['draft-export', string, string | undefined, number | undefined];
type MediaLibraryKey = readonly ['ws', string, 'media-library'];

/** One place for asset query keys, so hooks and every invalidation agree. Tenant-scoped. */
export const assetKeys = {
  detail: (tenantId: string, assetId: string): AssetKey => ['asset', tenantId, assetId],
  /** Every version's review package for one draft: the prefix to invalidate. */
  draftExports: (tenantId: string, creativeId: string | undefined): DraftExportsKey => ['draft-export', tenantId, creativeId],
  draftExport: (tenantId: string, creativeId: string | undefined, version: number | undefined): DraftExportKey =>
    ['draft-export', tenantId, creativeId, version],
  // Same shape as the workspace lists, so useWorkspaceMutation(…, ['media-library']) refreshes it.
  mediaLibrary: (tenantId: string): MediaLibraryKey => ['ws', tenantId, 'media-library'],
};

const LINK_STALE_MS = 4 * 60_000;
// Refresh a minute before a signed link expires, but never more often than every 30 s.
const LINK_REFRESH_LEAD_MS = 60_000;
const LINK_REFRESH_MIN_MS = 30_000;
const MEDIA_STALE_MS = 60_000;

/** When to fetch again so the soonest-expiring link is replaced before it stops working. */
function refreshBefore(expiries: (string | null | undefined)[]): number | false {
  const ends = expiries.filter((e): e is string => !!e).map(Date.parse).filter((t) => !Number.isNaN(t));
  if (!ends.length) return false;
  return Math.max(LINK_REFRESH_MIN_MS, Math.min(...ends) - Date.now() - LINK_REFRESH_LEAD_MS);
}

export const assetQuery = (tenantId: string, assetId: string): UseQueryOptions<Asset, Error, Asset, AssetKey> => queryOptions({
  queryKey: assetKeys.detail(tenantId, assetId),
  queryFn: ({ signal }) => assetsApi.get(assetId, signal),
  staleTime: LINK_STALE_MS,
  refetchInterval: (q) => refreshBefore([q.state.data?.download_url_expires_at]),
});

/** The asset and a fresh link to it. Refetched before the link expires. */
export function useAsset(assetId: string | null | undefined): UseQueryResult<Asset> {
  const { context } = useSession();
  return useQuery({ ...assetQuery(context.tenant.tenant_id, assetId ?? ''), enabled: !!assetId });
}

/**
 * The media library, a page at a time (GET /media). The links in it are
 * short-lived, so the loaded pages are fetched again shortly before the first
 * one expires.
 */
export function useMediaLibrary(): UseInfiniteQueryResult<InfiniteData<MediaPage, string | null>> {
  const { context } = useSession();
  return useInfiniteQuery({
    queryKey: assetKeys.mediaLibrary(context.tenant.tenant_id),
    queryFn: ({ pageParam, signal }) => assetsApi.media(pageParam, signal),
    // Widens the literal null to the cursor type for TanStack's generics; not server data.
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: MEDIA_STALE_MS,
    refetchInterval: (q) => refreshBefore((q.state.data?.pages ?? []).flatMap((p) => p.items.map((m) => m.download_url_expires_at))),
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
    queryKey: assetKeys.draftExport(context.tenant.tenant_id, creativeId, version),
    queryFn: async ({ signal }) => {
      if (!creativeId) return null; // not reached: enabled needs it
      try {
        return await assetsApi.exportDraft(creativeId, signal);
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

/** The API says the image does not exist or is not this user's to see: never show it, even from cache. */
// Not a type guard: `false` would wrongly tell callers a 503 ApiError is not an ApiError.
export const assetDenied = (e: unknown): boolean => isApiError(e) && (e.kind === 'not_found' || e.kind === 'forbidden');

/**
 * The manifest as saved to disk: the short-lived image link is removed, so a
 * downloaded file never carries a working signed URL.
 */
export function manifestForDownload(m: ExportManifest): Omit<ExportManifest, 'image'> & { image: Omit<Asset, 'download_url' | 'download_url_expires_at'> } {
  const { download_url: _url, download_url_expires_at: _exp, ...image } = m.image;
  return { ...m, image };
}

export const shortHash = (sha: string): string => sha.slice(0, 12);
