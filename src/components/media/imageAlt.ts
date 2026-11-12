import { truncateWords } from '@/lib/utils';

// Long enough to say what the picture shows, short enough for a screen reader to read in one go.
const ALT_BRIEF_WORDS = 25;

/**
 * Alt text for a generated image: what it shows, taken from the brief it was made from.
 * AssetRead has no alt_text yet (NRC-18 follow-up); once it does, prefer that.
 */
export function imageAltForBrief(brief: string | null | undefined): string {
  const words = truncateWords(brief ?? '', ALT_BRIEF_WORDS);
  return words ? `Generated image for the brief: ${words}` : 'Generated image (no brief recorded)';
}
