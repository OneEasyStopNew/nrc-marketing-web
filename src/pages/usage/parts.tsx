import type { ReactElement } from 'react';
import { fmtUsd, type Attempt, type AttemptOutcome, type AttemptStatus } from '@/api/usage';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

const STATUS: Record<AttemptStatus, [string, BadgeVariant]> = {
  RESERVED: ['Reserved, not billed yet', 'brand'],
  CONFIRMED: ['Confirmed', 'done'],
  REFUNDED: ['Refunded', 'neutral'],
  FAILED: ['Failed', 'blocked'],
  UNKNOWN: ['Billing unknown', 'waiting'],
};

/** Billing state of one attempt, in words. */
export function AttemptStatusBadge({ value }: { value: AttemptStatus }): ReactElement {
  const [label, variant] = STATUS[value];
  return <Badge variant={variant}>{label}</Badge>;
}

export const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  USED: 'Used in the post',
  REJECTED_BY_VALIDATION: 'Rejected by validation',
  REPLACED: 'Replaced by a later attempt',
  DISCARDED: 'Discarded by the user',
  NO_OUTPUT: 'No output',
};

/** "Image · 2048 px" or "Video · 1080p · 8 s · with audio". */
export const settingsOf = (a: Pick<Attempt, 'kind' | 'settings'>): string => [
  a.kind === 'video' ? 'Video' : 'Image',
  a.settings.resolution,
  a.settings.count > 1 ? `${a.settings.count} images` : null,
  a.settings.duration_s != null ? `${a.settings.duration_s} s` : null,
  a.kind === 'video' ? (a.settings.audio ? 'with audio' : 'no audio') : null,
].filter(Boolean).join(' · ');

/** What the provider billed for one attempt, never a guess presented as a bill. */
export function billedText(a: Pick<Attempt, 'status' | 'confirmed' | 'refunded'>): string {
  if (a.status === 'RESERVED') return 'Not billed yet';
  if (a.status === 'UNKNOWN' || a.confirmed == null) return 'Not confirmed';
  return fmtUsd(a.confirmed);
}

/** Where a post's page is: a checked client post (validation only) or an AI draft. */
export const postHref = (a: Pick<Attempt, 'creative_id' | 'workflow'>): string =>
  a.workflow === 'VALIDATION_ONLY' ? `/marketing/create/check/${encodeURIComponent(a.creative_id)}` : `/marketing/create/${encodeURIComponent(a.creative_id)}`;

/* ---------- CSV statement ---------- */

/** One CSV cell: quoted, with formula-leading text neutralised so a spreadsheet never runs it. */
export function csvCell(value: string | number | null): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The statement for the attempts shown: every amount kept in its own labelled column. */
export function attemptsCsv(rows: Attempt[]): string {
  const head = ['Date (UTC)', 'Attempt', 'Post', 'Version', 'Workflow', 'Model', 'Settings', 'Billing status', 'Estimated USD', 'Confirmed USD', 'Refunded USD', 'Reconciled (UTC)', 'Outcome'];
  const lines = rows.map((a) => [
    a.created_at, a.attempt_id, a.creative_id, a.creative_version, a.workflow === 'VALIDATION_ONLY' ? 'Validation only (AI fix)' : 'Create with AI',
    a.model_label, settingsOf(a), STATUS[a.status][0], a.estimated, a.confirmed ?? '', a.refunded ?? '', a.reconciled_at ?? '', OUTCOME_LABEL[a.outcome],
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}
