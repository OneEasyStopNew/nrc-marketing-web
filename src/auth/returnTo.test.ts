import { describe, expect, it } from 'vitest';
import { HOME_PATH, safeReturnTo } from './returnTo';

describe('safeReturnTo', () => {
  it('keeps application paths', () => {
    expect(safeReturnTo('/marketing')).toBe('/marketing');
    expect(safeReturnTo('/marketing/create')).toBe('/marketing/create');
    expect(safeReturnTo('/marketing/validation/run-1/')).toBe('/marketing/validation/run-1');
  });

  it('drops the query string and hash', () => {
    expect(safeReturnTo('/marketing/create?prompt=secret#access_token=x')).toBe('/marketing/create');
  });

  it.each([
    ['absolute URL', 'https://evil.example/marketing'],
    ['protocol-relative', '//evil.example/marketing'],
    ['backslash trick', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'marketing'],
    ['path outside the app', '/admin'],
    ['prefix look-alike', '/marketingevil'],
    ['auth callback', '/auth/callback'],
    ['traversal out of the app', '/marketing/../admin'],
    ['empty', ''],
    ['not a string', { path: '/marketing' }],
    ['undefined', undefined],
  ])('rejects %s', (_, raw) => {
    expect(safeReturnTo(raw)).toBe(HOME_PATH);
  });
});
