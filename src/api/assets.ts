import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { http } from './http';
import type { components } from './schema';

/**
 * Images (D3/D4) and the review-draft export (D5), per contracts/openapi.json.
 * `download_url` is short-lived: it is used to show the image and never
 * stored, logged or written into a downloaded file.
 */

export type Asset = components['schemas']['AssetRead'];
export type ExportManifest = components['schemas']['ExportManifest'];

export const assetsApi = {
  get: (assetId: string, signal?: AbortSignal) => http.get<Asset>(`/assets/${encodeURIComponent(assetId)}`, undefined, { signal }),
  exportDraft: (creativeId: string, signal?: AbortSignal) =>
    http.get<ExportManifest>(`/creatives/${encodeURIComponent(creativeId)}/export`, undefined, { signal }),
};

/** The asset and a fresh link to it. Refetched before the link expires. */
export function useAsset(assetId: string | null | undefined) {
  const { context } = useSession();
  return useQuery({
    queryKey: ['asset', context.tenant.tenant_id, assetId],
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
 * The manifest as saved to disk: the short-lived image link is removed, so a
 * downloaded file never carries a working signed URL.
 */
export function manifestForDownload(m: ExportManifest) {
  const { download_url: _url, download_url_expires_at: _exp, ...image } = m.image;
  return { ...m, image };
}

export const shortHash = (sha: string) => sha.slice(0, 12);
