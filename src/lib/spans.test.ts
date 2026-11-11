import { describe, expect, it } from 'vitest';
import { segmentByCodePoints, sliceByCodePoints } from './spans';

describe('segmentByCodePoints', () => {
  it('marks a span in plain text', () => {
    const s = segmentByCodePoints('Get a free gift', [{ key: 'a', span: { start: 6, end: 10 } }]);
    expect(s).toEqual([
      { text: 'Get a ', keys: [] },
      { text: 'free', keys: ['a'] },
      { text: ' gift', keys: [] },
    ]);
  });

  it('counts emoji and other astral characters as one code point', () => {
    // "😀" is two UTF-16 units but one code point.
    const text = '😀 cure now';
    expect(sliceByCodePoints(text, { start: 2, end: 6 })).toBe('cure');
    const s = segmentByCodePoints(text, [{ key: 1, span: { start: 2, end: 6 } }]);
    expect(s.find((p) => p.keys.length)?.text).toBe('cure');
  });

  it('keeps accented Spanish text intact', () => {
    const text = 'Participación gratuita';
    expect(sliceByCodePoints(text, { start: 14, end: 22 })).toBe('gratuita');
  });

  it('splits overlapping spans so each piece lists every finding on it', () => {
    const s = segmentByCodePoints('abcdef', [
      { key: 'x', span: { start: 1, end: 4 } },
      { key: 'y', span: { start: 3, end: 5 } },
    ]);
    expect(s.map((p) => [p.text, p.keys])).toEqual([
      ['a', []], ['bc', ['x']], ['d', ['x', 'y']], ['e', ['y']], ['f', []],
    ]);
  });

  it('clips spans past the end and ignores empty ones', () => {
    const s = segmentByCodePoints('abc', [
      { key: 'x', span: { start: 2, end: 99 } },
      { key: 'y', span: { start: 1, end: 1 } },
    ]);
    expect(s).toEqual([{ text: 'ab', keys: [] }, { text: 'c', keys: ['x'] }]);
  });

  it('returns the whole text when there are no spans', () => {
    expect(segmentByCodePoints('hello', [])).toEqual([{ text: 'hello', keys: [] }]);
    expect(segmentByCodePoints('', [])).toEqual([]);
  });
});
