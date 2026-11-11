/**
 * Word-level difference between two texts, for comparing brief versions.
 * Whitespace is kept as its own token so the result rebuilds both texts
 * exactly: joining `same` + `removed` gives `before`, `same` + `added` gives `after`.
 */

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

const tokens = (s: string) => s.split(/(\s+)/).filter((t) => t !== '');

export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  // Longest common subsequence table, filled from the end.
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('removed', a[i++]);
    else push('added', b[j++]);
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}

/** True when nothing changed. */
export const isUnchanged = (parts: DiffPart[]) => parts.every((p) => p.kind === 'same');
