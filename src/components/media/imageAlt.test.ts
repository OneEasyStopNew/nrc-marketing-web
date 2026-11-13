import { describe, expect, it } from 'vitest';
import { imageAltForBrief } from './imageAlt';

describe('imageAltForBrief', () => {
  it('describes the image by the brief it was generated from', () => {
    expect(imageAltForBrief('A nurse explains a study to a patient')).toBe(
      'Generated image for the brief: A nurse explains a study to a patient',
    );
  });

  it('keeps the first 25 words of a long brief', () => {
    const brief = Array.from({ length: 40 }, (_, i) => `w${i + 1}`).join(' ');
    const alt = imageAltForBrief(brief);
    expect(alt).toMatch(/w25…$/);
    expect(alt).not.toContain('w26');
  });

  it('falls back to a plain description when there is no brief', () => {
    expect(imageAltForBrief('')).toBe('Generated image (no brief recorded)');
    expect(imageAltForBrief(null)).toBe('Generated image (no brief recorded)');
  });
});
