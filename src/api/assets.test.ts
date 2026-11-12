import { describe, expect, it } from 'vitest';
import { assetDenied, assetKeys, InvalidResponseError, isSimulatedAsset, manifestForDownload, parseAssetRead, shortHash, type ExportManifest } from './assets';
import { ApiError } from './errors';

const manifest: ExportManifest = {
  status: 'DRAFT', creative_id: 'c1', creative_version: 3, caption: 'Caption', study_snapshot_version: 2,
  policy_bundle_version: 'p1', latest_validation: null, exported_at: '2026-11-10T00:00:00Z',
  image: {
    asset_id: 'a1', creative_id: 'c1', origin: 'generated', mime_type: 'image/png', width_px: 1080, height_px: 1080,
    size_bytes: 10, checksum_sha256: 'abcdef0123456789', provider: 'p', model: 'm', created_at: '2026-11-10T00:00:00Z',
    download_url: 'https://signed.example.test/a1?sig=secret', download_url_expires_at: '2026-11-10T00:10:00Z',
  },
};

describe('manifestForDownload', () => {
  it('removes the short-lived signed link and keeps everything else', () => {
    const out = manifestForDownload(manifest);
    expect(JSON.stringify(out)).not.toContain('signed.example.test');
    expect(out.image).not.toHaveProperty('download_url');
    expect(out.image).not.toHaveProperty('download_url_expires_at');
    expect(out.image.checksum_sha256).toBe('abcdef0123456789');
    expect(out.status).toBe('DRAFT');
    expect(out.creative_version).toBe(3);
  });

  it('shortens the checksum for display', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef012345');
  });
});

describe('isSimulatedAsset', () => {
  it('labels both simulation provider names, in any case', () => {
    expect(isSimulatedAsset({ provider: 'simulation' })).toBe(true);
    expect(isSimulatedAsset({ provider: 'Simulator' })).toBe(true);
    expect(isSimulatedAsset({ provider: 'higgsfield' })).toBe(false);
    expect(isSimulatedAsset({ provider: null })).toBe(false);
  });
});

describe('assetDenied', () => {
  it('is true for not found and forbidden only', () => {
    expect(assetDenied(new ApiError(404))).toBe(true);
    expect(assetDenied(new ApiError(403))).toBe(true);
    expect(assetDenied(new ApiError(503))).toBe(false);
    expect(assetDenied(new Error('x'))).toBe(false);
  });
});

describe('parseAssetRead', () => {
  const valid = {
    asset_id: 'a1', creative_id: 'c1', origin: 'generated', mime_type: 'image/png', width_px: 1080, height_px: 1350,
    size_bytes: 10, checksum_sha256: 'ab'.repeat(32), provider: 'higgsfield', model: 'm', created_at: '2026-11-10T00:00:00Z',
    download_url: 'https://signed.example.test/a1?sig=x', download_url_expires_at: '2026-11-10T00:10:00+05:30',
  };
  const parse = (patch: Record<string, unknown>, allowDataImage = false) => () => parseAssetRead({ ...valid, ...patch }, { allowDataImage });

  it('accepts a body that matches the contract', () => {
    expect(parseAssetRead(valid, { allowDataImage: false })).toEqual(valid);
    expect(parse({ provider: null, model: null, download_url: null, download_url_expires_at: null })()).toMatchObject({ download_url: null });
  });

  it.each([
    ['a null checksum', { checksum_sha256: null }],
    ['a short checksum', { checksum_sha256: 'abc' }],
    ['a zero height', { height_px: 0 }],
    ['a fractional width', { width_px: 10.5 }],
    ['an invalid created_at', { created_at: 'yesterday' }],
    ['a created_at without offset', { created_at: '2026-11-10T00:00:00' }],
    ['an unknown origin', { origin: 'scraped' }],
    ['a missing asset id', { asset_id: '' }],
    ['a negative size', { size_bytes: -1 }],
    ['an http link', { download_url: 'http://signed.example.test/a1' }],
    ['a javascript link', { download_url: 'javascript:alert(1)' }],
    ['a non-image data link', { download_url: 'data:text/html;base64,PHNjcmlwdD4=' }],
  ])('rejects %s', (_name, patch) => {
    expect(parse(patch)).toThrow(InvalidResponseError);
  });

  it('accepts a data:image link only where simulation is allowed', () => {
    expect(parse({ download_url: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow(InvalidResponseError);
    expect(parse({ download_url: 'data:image/svg+xml;base64,PHN2Zz4=' }, true)()).toMatchObject({ download_url: 'data:image/svg+xml;base64,PHN2Zz4=' });
  });

  it('rejects a body that is not an object', () => {
    expect(() => parseAssetRead(null, { allowDataImage: false })).toThrow(InvalidResponseError);
    expect(() => parseAssetRead([valid], { allowDataImage: false })).toThrow(InvalidResponseError);
  });
});

describe('assetKeys', () => {
  it('scopes an asset to its organisation', () => {
    expect(assetKeys.detail('t1', 'a1')).toEqual(['asset', 't1', 'a1']);
  });
});
