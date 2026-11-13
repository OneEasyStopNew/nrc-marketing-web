import { describe, expect, it } from 'vitest';
import { diffWords, isUnchanged } from './diff';

const rebuild = (parts: ReturnType<typeof diffWords>, side: 'before' | 'after') =>
  parts.filter((p) => p.kind === 'same' || p.kind === (side === 'before' ? 'removed' : 'added')).map((p) => p.text).join('');

describe('diffWords', () => {
  it('marks a replaced word', () => {
    expect(diffWords('a guaranteed cure', 'a possible cure')).toEqual([
      { kind: 'same', text: 'a ' },
      { kind: 'removed', text: 'guaranteed' },
      { kind: 'added', text: 'possible' },
      { kind: 'same', text: ' cure' },
    ]);
  });

  it('rebuilds both texts exactly, including line breaks and Unicode', () => {
    const before = 'Participación gratuita.\n\nCure 😀 now';
    const after = 'Participación voluntaria.\nResearch 😀 now, today';
    const parts = diffWords(before, after);
    expect(rebuild(parts, 'before')).toBe(before);
    expect(rebuild(parts, 'after')).toBe(after);
  });

  it('handles empty sides', () => {
    expect(diffWords('', 'new text')).toEqual([{ kind: 'added', text: 'new text' }]);
    expect(diffWords('old', '')).toEqual([{ kind: 'removed', text: 'old' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('stays fast on a 4,000-character brief with a small edit, and is exact', () => {
    const before = Array.from({ length: 700 }, (_, k) => `w${k}`).join(' ');
    const after = before.replace('w350', 'changed');
    const t0 = performance.now();
    const parts = diffWords(before, after);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(parts.filter((p) => p.kind !== 'same')).toEqual([{ kind: 'removed', text: 'w350' }, { kind: 'added', text: 'changed' }]);
    expect(rebuild(parts, 'before')).toBe(before);
    expect(rebuild(parts, 'after')).toBe(after);
  });

  it('falls back to lines, then blocks, when the changed part is too big, and still rebuilds both texts', () => {
    const many = (prefix: string) => Array.from({ length: 2_000 }, (_, k) => `${prefix}${k}`).join(' ');
    const before = `keep\n${many('a')}\nend`;
    const after = `keep\n${many('b')}\nend`;
    const t0 = performance.now();
    const parts = diffWords(before, after);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(rebuild(parts, 'before')).toBe(before);
    expect(rebuild(parts, 'after')).toBe(after);
  });

  it('counts past 65,535 words without wrapping', () => {
    const before = 'x '.repeat(70_000);
    const parts = diffWords(before, `${before}tail`);
    expect(parts).toEqual([{ kind: 'same', text: before }, { kind: 'added', text: 'tail' }]);
  });

  it('reports no change for equal texts', () => {
    expect(isUnchanged(diffWords('same words here', 'same words here'))).toBe(true);
    expect(isUnchanged(diffWords('same words', 'same word'))).toBe(false);
  });
});
