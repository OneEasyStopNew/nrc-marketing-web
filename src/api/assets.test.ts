import { describe, expect, it } from 'vitest';
import { manifestForDownload, shortHash, type ExportManifest } from './assets';

const manifest: ExportManifest = {
  status: 'DRAFT', creative_id: 'c1', creative_version: 3, caption: 'Caption', study_snapshot_version: 2,
  policy_bundle_version: 1, latest_validation: null, exported_at: '2026-11-10T00:00:00Z',
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
