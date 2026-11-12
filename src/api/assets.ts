import { queryOptions, useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { SIMULATION_BUILD } from '@/config/env';
import { isApiError } from './errors';
import { http } from './http';
import type { components } from './schema';

/**
 * Images (D3/D4) and the review-draft export (D5), per contracts/openapi.json.
 * `download_url` is short-lived: it is used to show the image and never
 * stored, logged or written into a downloaded file.
 */

export type Asset = components['schemas']['AssetRead'];
export type ExportManifest = components['schemas']['ExportManifest'];

/** A response body that does not have the shape the contract promises. */
export class InvalidResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} from NRC Marketing`);
    this.name = 'InvalidResponseError';
  }
}

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

const WHAT = 'image details';
const SHA256_HEX = /^[0-9a-f]{64}$/;
// RFC 3339 with an explicit offset, so the time is never read in the browser's own zone.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// Own keys only: `in` would accept inherited names such as "constructor".
const ORIGINS: Record<Asset['origin'], true> = { generated: true, uploaded: true };
const isOrigin = (v: unknown): v is Asset['origin'] => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ORIGINS, v);

function bad(key: string): never {
  throw new InvalidResponseError(`${WHAT}.${key}`);
}

function text(o: Fields, key: string): string {
  const v = o[key];
  return typeof v === 'string' && v !== '' ? v : bad(key);
}

/** A missing nullable field reads as null; a value of the wrong type is a contract break. */
function textOrNull(o: Fields, key: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : bad(key);
}

function wholeNumber(o: Fields, key: string, min: number): number {
  const v = o[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= min ? v : bad(key);
}

function dateTime(v: string | null, key: string): string | null {
  if (v === null) return null;
  return DATE_TIME.test(v) && !Number.isNaN(Date.parse(v)) ? v : bad(key);
}

/** The link becomes an <img src>: https only; the simulation's data:image placeholders only where simulation is allowed. */
function imageLink(v: string | null, allowDataImage: boolean): string | null {
  if (v === null) return null;
  if (v.startsWith('https://')) return v;
  if (allowDataImage && v.startsWith('data:image/')) return v;
  return bad('download_url');
}

/** Checks every field the preview draws or computes with, so one bad field shows an error instead of crashing the page. */
export function parseAssetRead(raw: unknown, { allowDataImage }: { allowDataImage: boolean }): Asset {
  if (!isFields(raw)) throw new InvalidResponseError(WHAT);
  const origin = raw.origin;
  if (!isOrigin(origin)) return bad('origin');
  const checksum = text(raw, 'checksum_sha256');
  if (!SHA256_HEX.test(checksum)) return bad('checksum_sha256');
  return {
    // Seeded simulation ids are not UUIDs yet, so ids are checked as non-empty text here (NRC-18 follow-up).
    asset_id: text(raw, 'asset_id'),
    creative_id: text(raw, 'creative_id'),
    origin,
    mime_type: text(raw, 'mime_type'),
    width_px: wholeNumber(raw, 'width_px', 1),
    height_px: wholeNumber(raw, 'height_px', 1),
    size_bytes: wholeNumber(raw, 'size_bytes', 0),
    checksum_sha256: checksum,
    provider: textOrNull(raw, 'provider'),
    model: textOrNull(raw, 'model'),
    created_at: dateTime(text(raw, 'created_at'), 'created_at') ?? bad('created_at'),
    download_url: imageLink(textOrNull(raw, 'download_url'), allowDataImage),
    download_url_expires_at: dateTime(textOrNull(raw, 'download_url_expires_at'), 'download_url_expires_at'),
  };
}

export const assetsApi = {
  get: async (assetId: string, signal?: AbortSignal): Promise<Asset> =>
    parseAssetRead(await http.get<unknown>(`/assets/${encodeURIComponent(assetId)}`, undefined, { signal }), { allowDataImage: SIMULATION_BUILD }),
  exportDraft: (creativeId: string, signal?: AbortSignal): Promise<ExportManifest> =>
    http.get<ExportManifest>(`/creatives/${encodeURIComponent(creativeId)}/export`, undefined, { signal }),
};

/** One place for asset query keys, so the hook and every invalidation agree. Tenant-scoped. */
export const assetKeys = {
  detail: (tenantId: string, assetId: string): readonly ['asset', string, string] => ['asset', tenantId, assetId],
};

const LINK_STALE_MS = 4 * 60_000;
// Refresh a minute before the signed link expires, but never more often than every 30 s.
const LINK_REFRESH_LEAD_MS = 60_000;
const LINK_REFRESH_MIN_MS = 30_000;

type AssetKey = ReturnType<typeof assetKeys.detail>;

export const assetQuery = (tenantId: string, assetId: string): UseQueryOptions<Asset, Error, Asset, AssetKey> => queryOptions({
  queryKey: assetKeys.detail(tenantId, assetId),
  queryFn: ({ signal }) => assetsApi.get(assetId, signal),
  staleTime: LINK_STALE_MS,
  refetchInterval: (q) => {
    const exp = q.state.data?.download_url_expires_at;
    if (!exp) return false;
    return Math.max(LINK_REFRESH_MIN_MS, Date.parse(exp) - Date.now() - LINK_REFRESH_LEAD_MS);
  },
});

/** The asset and a fresh link to it. Refetched before the link expires. */
export function useAsset(assetId: string | null | undefined): UseQueryResult<Asset> {
  const { context } = useSession();
  return useQuery({ ...assetQuery(context.tenant.tenant_id, assetId ?? ''), enabled: !!assetId });
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

const SIMULATION_PROVIDERS = new Set(['simulation', 'simulator']);

/** Made by the simulation provider: a labelled placeholder, not a real generated image. */
export const isSimulatedAsset = (a: Pick<Asset, 'provider'>): boolean => SIMULATION_PROVIDERS.has(a.provider?.toLowerCase() ?? '');

/** The API says the image does not exist or is not this user's to see: never show it, even from cache. */
// Not a type guard: `false` would wrongly tell callers a 503 ApiError is not an ApiError.
export const assetDenied = (e: unknown): boolean => isApiError(e) && (e.kind === 'not_found' || e.kind === 'forbidden');
