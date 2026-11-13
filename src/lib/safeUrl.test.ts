import { describe, expect, it } from 'vitest';
import { isAppPath, safeExternalHref } from './safeUrl';

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
