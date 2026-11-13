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
  const real = { allowDataImage: false };
  const sim = { allowDataImage: true };

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
});
