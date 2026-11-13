/**
 * Word-level difference between two texts, for comparing brief versions.
 * Whitespace is kept as its own token so the result rebuilds both texts
 * exactly: joining `same` + `removed` gives `before`, `same` + `added` gives `after`.
 *
 * Cost: the shared start and end are cut off first (a typical edit leaves most
 * of a brief alone), and the longest-common-subsequence table is built only
 * for the part in between. If that part is still too big for the main thread,
 * it is compared line by line instead, and as a last resort shown as one
 * removed and one added block.
 */

export interface DiffPart { kind: 'same' | 'added' | 'removed'; text: string }

/** Above this many table cells (about 8 MB as Uint32) the word diff is not attempted. */
const MAX_CELLS = 2_000_000;

const words = (s: string): string[] => s.split(/(\s+)/).filter((t) => t !== '');
const lines = (s: string): string[] => s.split(/(\n)/).filter((t) => t !== '');

/** Appends a part, merging it into the previous one when the kind is the same. */
function pushPart(out: DiffPart[], kind: DiffPart['kind'], text: string): void {
  const last = out.at(-1);
  if (last?.kind === kind) last.text += text;
  else out.push({ kind, text });
}

/** LCS diff of two token lists, or null when the table would be too large. */
function lcsDiff(a: readonly string[], b: readonly string[], out: DiffPart[]): boolean {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return false;
  // Uint32: a Uint16 count would wrap silently past 65,535 tokens.
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pushPart(out, 'same', a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) pushPart(out, 'removed', a[i++]);
    else pushPart(out, 'added', b[j++]);
  }
  while (i < n) pushPart(out, 'removed', a[i++]);
  while (j < m) pushPart(out, 'added', b[j++]);
  return true;
}

export function diffWords(before: string, after: string): DiffPart[] {
  const a = words(before);
  const b = words(after);

  // Shared start and end need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

  const out: DiffPart[] = [];
  if (start > 0) pushPart(out, 'same', a.slice(0, start).join(''));

  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  if (!lcsDiff(midA, midB, out)) {
    const textA = midA.join('');
    const textB = midB.join('');
    if (!lcsDiff(lines(textA), lines(textB), out)) {
      if (textA) pushPart(out, 'removed', textA);
      if (textB) pushPart(out, 'added', textB);
    }
  }

  if (end > 0) pushPart(out, 'same', a.slice(a.length - end).join(''));
  return out;
}

/** True when nothing changed. */
export function isUnchanged(parts: readonly DiffPart[]): boolean {
  return parts.every((p) => p.kind === 'same');
}
