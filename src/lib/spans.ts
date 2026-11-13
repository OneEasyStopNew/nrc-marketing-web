/**
 * Text highlights from backend offsets. The API counts zero-based Unicode
 * code points with an exclusive end; JavaScript strings index UTF-16 units,
 * so an emoji or another astral character would shift a naive slice.
 */

export interface Span {
  start: number;
  end: number;
}

export interface Segment<K> {
  text: string;
  /** Keys of every span covering this piece (overlaps allowed). Empty = plain text. */
  keys: K[];
}

/**
 * Splits `text` into pieces at every span boundary. Spans outside the text are
 * clipped; empty or inverted spans are ignored.
 */
export function segmentByCodePoints<K>(text: string, spans: { key: K; span: Span }[]): Segment<K>[] {
  const chars = [...text];
  const n = chars.length;
  const valid = spans
    .map(({ key, span }) => ({ key, start: Math.max(0, Math.min(n, span.start)), end: Math.max(0, Math.min(n, span.end)) }))
    .filter((s) => s.end > s.start);
  const cuts = [...new Set([0, n, ...valid.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const out: Segment<K>[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    if (b <= a) continue;
    out.push({ text: chars.slice(a, b).join(''), keys: valid.filter((s) => s.start <= a && s.end >= b).map((s) => s.key) });
  }
  return out;
}

/** The text a span covers, by code points. */
export const sliceByCodePoints = (text: string, span: Span): string => [...text].slice(span.start, span.end).join('');
