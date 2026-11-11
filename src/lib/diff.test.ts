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

  it('reports no change for equal texts', () => {
    expect(isUnchanged(diffWords('same words here', 'same words here'))).toBe(true);
    expect(isUnchanged(diffWords('same words', 'same word'))).toBe(false);
  });
});
