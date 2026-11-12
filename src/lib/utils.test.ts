import { describe, expect, it } from 'vitest';
import { truncateWords } from './utils';

describe('truncateWords', () => {
  it('keeps short text as it is, with whitespace tidied', () => {
    expect(truncateWords('  A sunny  clinic\nwaiting room ', 25)).toBe('A sunny clinic waiting room');
  });

  it('cuts after the word limit and marks the cut', () => {
    expect(truncateWords('one two three four five', 3)).toBe('one two three…');
  });

  it('returns an empty string for blank text', () => {
    expect(truncateWords('   ', 5)).toBe('');
  });
});
