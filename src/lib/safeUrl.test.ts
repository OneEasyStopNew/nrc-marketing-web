import { describe, expect, it } from 'vitest';
import { isAppPath, safeExternalHref, safeImageSrc } from './safeUrl';

describe('safeExternalHref', () => {
  it('keeps http(s), mailto and tel links', () => {
    expect(safeExternalHref('https://example.test/study')).toBe('https://example.test/study');
    expect(safeExternalHref('http://example.test')).toBe('http://example.test/');
    expect(safeExternalHref('mailto:study@example.test')).toBe('mailto:study@example.test');
    expect(safeExternalHref('tel:+15550100')).toBe('tel:+15550100');
  });

  it('refuses script and data URLs, whatever their spelling', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
      expect(safeExternalHref(bad), bad).toBeNull();
    }
  });

  it('refuses relative and protocol-relative values', () => {
    expect(safeExternalHref('//evil.example')).toBeNull();
    expect(safeExternalHref('study/1')).toBeNull();
    expect(safeExternalHref('')).toBeNull();
  });
});

describe('isAppPath', () => {
  it('accepts in-app paths only', () => {
    expect(isAppPath('/marketing/create')).toBe(true);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('/\\evil.example')).toBe(false);
    expect(isAppPath('/marketing/..\\..\\evil.example')).toBe(false);
    expect(isAppPath('https://example.test')).toBe(false);
  });
});

describe('safeImageSrc', () => {
  const real = { allowDataImage: false, allowLocalHttp: false };
  const sim = { allowDataImage: true, allowLocalHttp: false };
  const dev = { allowDataImage: true, allowLocalHttp: true };

  it('keeps an https link exactly as sent, so a signed query string is not re-encoded', () => {
    const signed = 'https://bucket.example.test/a1.png?X-Amz-Signature=ab%2Fcd&X-Amz-Expires=600';
    expect(safeImageSrc(signed, real)).toBe(signed);
  });

  it('refuses every other scheme', () => {
    for (const bad of ['http://bucket.example.test/a1.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'blob:https://x.test/1', '//bucket.example.test/a1.png', '/a1.png', 'not a url']) {
      expect(safeImageSrc(bad, sim), bad).toBeNull();
    }
  });

  it('allows a data:image placeholder only where simulation is allowed', () => {
    const placeholder = 'data:image/svg+xml;base64,PHN2Zz4=';
    expect(safeImageSrc(placeholder, real)).toBeNull();
    expect(safeImageSrc(placeholder, sim)).toBe(placeholder);
  });

  it('allows an http link from the local S3 (localhost or 127.0.0.1) only in a dev build', () => {
    for (const local of ['http://127.0.0.1:8333/nrc-local-media/a1.png?X-Amz-Signature=ab', 'http://localhost:8333/nrc-local-media/a1.png']) {
      expect(safeImageSrc(local, dev), local).toBe(local);
      expect(safeImageSrc(local, real), local).toBeNull();
    }
  });

  it('still refuses http links to any other host in a dev build', () => {
    for (const bad of ['http://bucket.example.test/a1.png', 'http://127.0.0.1.example.test/a1.png', 'http://localhost.example.test/a1.png', 'http://10.0.0.5:8333/a1.png']) {
      expect(safeImageSrc(bad, dev), bad).toBeNull();
    }
  });
});
