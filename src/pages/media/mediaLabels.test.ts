import { describe, expect, it } from 'vitest';
import type { MediaItem } from '@/api/assets';
import { mediaDraftHref, mediaName, mediaSource } from './mediaLabels';

/** A media item as GET /media sends it; uploads may belong to no draft. */
const item = (patch: Partial<MediaItem> = {}): MediaItem => ({
  asset_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  creative_id: 'cccccccc-2222-4222-8222-222222222222',
  creative_version: 3,
  origin: 'generated',
  mime_type: 'image/png',
  width_px: 1080,
  height_px: 1080,
  size_bytes: 204800,
  created_at: '2026-11-20T10:00:00Z',
  created_by: 'user-1',
  created_by_name: 'Sim Creator',
  download_url: null,
  download_url_expires_at: null,
  ...patch,
});

describe('mediaName', () => {
  it('names a generated image after its draft and version', () => {
    expect(mediaName(item())).toBe('Draft cccccccc · version 3');
  });

  it('uses the file name of an upload that belongs to no draft', () => {
    expect(mediaName(item({ origin: 'uploaded', creative_id: null, creative_version: null, name: 'clinic-front.jpg' }))).toBe('clinic-front.jpg');
  });

  it('falls back to the file id when there is neither a draft nor a name', () => {
    expect(mediaName(item({ origin: 'uploaded', creative_id: null, creative_version: null, name: null }))).toBe('File aaaaaaaa');
  });

  it('never prints "version null" for a draft whose version was not sent', () => {
    expect(mediaName(item({ creative_version: null }))).toBe('Draft cccccccc');
  });
});

describe('mediaDraftHref', () => {
  it('links to the draft the image was made for', () => {
    expect(mediaDraftHref(item())).toBe('/marketing/create/cccccccc-2222-4222-8222-222222222222');
  });

  it('has no link for a file that belongs to no draft', () => {
    expect(mediaDraftHref(item({ creative_id: null, creative_version: null }))).toBeNull();
  });

  it('encodes the id so it cannot change the path', () => {
    expect(mediaDraftHref(item({ creative_id: '../admin' }))).toBe('/marketing/create/..%2Fadmin');
  });
});

describe('mediaSource', () => {
  it('describes the draft and version an image came from', () => {
    expect(mediaSource(item())).toBe('Draft cccccccc, version 3');
  });

  it('says so when a file is not attached to a draft', () => {
    expect(mediaSource(item({ creative_id: null, creative_version: null }))).toBe('Not attached to a draft');
  });
});
