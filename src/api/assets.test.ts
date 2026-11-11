import { describe, expect, it } from 'vitest';
import { assetDenied, isSimulatedAsset, manifestForDownload, shortHash, type ExportManifest } from './assets';
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
