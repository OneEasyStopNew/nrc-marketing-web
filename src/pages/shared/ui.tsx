import type { ReactNode, ReactElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { EmptyState as AxEmptyState } from '@astryxdesign/core/EmptyState';
import { isApiError } from '@/api/errors';
import type { AccountState, DraftSummary, MediaStatus, PublicationState, ReviewState, RuleStatus } from '@/api/workspace';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { IconName } from '@/components/ui/Icon';
import { Alert, EmptyState, SkeletonRows } from '@/components/ui/Misc';
import { InDevelopmentAnimation } from '@/components/ui/InDevelopmentAnimation';
import { Modal } from '@/components/ui/Overlay';
import { SIMULATION_BUILD } from '@/config/env';
import { useAuth } from '@/auth/AuthProvider';
import { UI_LOCALE } from '@/lib/utils';

/* ---------- Status badges: one word each, never colour alone ---------- */

const badge = (map: Record<string, [BadgeVariant, string]>) => ({ value }: { value: string }) => {
  const [variant, text] = map[value] ?? ['neutral', value];
  return <Badge variant={variant}>{text}</Badge>;
};

export const ValidationBadge = badge({
  NOT_RUN: ['neutral', 'Not validated'], RUNNING: ['brand', 'Checking'], PASS: ['done', 'Passed checks'],
  FAIL: ['blocked', 'Failed'], NEEDS_REVIEW: ['waiting', 'Needs review'], STALE: ['waiting', 'Out of date'],
} satisfies Record<DraftSummary['validation'], [BadgeVariant, string]>);

export const ReviewBadge = badge({
  NOT_SUBMITTED: ['neutral', 'Not submitted'], PENDING: ['waiting', 'Waiting for review'], APPROVED: ['done', 'Approved'],
  CHANGES_REQUESTED: ['blocked', 'Changes requested'], REJECTED: ['blocked', 'Rejected'], STALE: ['waiting', 'Out of date'],
} satisfies Record<ReviewState, [BadgeVariant, string]>);

export const PublicationBadge = badge({
  SCHEDULED: ['brand', 'Scheduled'], QUEUED: ['brand', 'Queued'], PROCESSING: ['brand', 'Sending'], PUBLISHED: ['done', 'Published'],
  PARTIAL: ['waiting', 'Partly published'], FAILED: ['blocked', 'Failed'], BLOCKED: ['blocked', 'Blocked'], CANCELLED: ['neutral', 'Cancelled'],
  UNKNOWN: ['waiting', 'Not confirmed'],
} satisfies Record<PublicationState, [BadgeVariant, string]>);

export const MediaBadge = badge({
  AVAILABLE: ['done', 'Available'], PENDING_CHECK: ['brand', 'Being checked'], BLOCKED: ['blocked', 'Blocked'], EXPIRED: ['neutral', 'Licence expired'],
} satisfies Record<MediaStatus, [BadgeVariant, string]>);

export const AccountBadge = badge({
  CONNECTED: ['done', 'Connected'], TEST_ONLY: ['brand', 'Test only'], PENDING_APP_REVIEW: ['waiting', 'App review pending'],
  PERMISSION_MISSING: ['blocked', 'Permission missing'], EXPIRED: ['blocked', 'Expired'], REVOKED: ['blocked', 'Revoked'],
} satisfies Record<AccountState, [BadgeVariant, string]>);

export const RuleStatusBadge = badge({
  ACTIVE: ['done', 'Active'], DRAFT: ['waiting', 'Draft'], RETIRED: ['neutral', 'Retired'],
} satisfies Record<RuleStatus, [BadgeVariant, string]>);

export const SeverityBadge = badge({ critical: ['blocked', 'Critical'], major: ['blocked', 'Major'], minor: ['waiting', 'Minor'] });

export const GATE_LABEL: Record<string, string> = { completeness: 'Completeness', study_facts: 'Study facts', policy: 'Policy rules', media: 'Image and media' };
export const ROLE_LABEL: Record<string, string> = { creator: 'Creator', reviewer: 'Reviewer', policy_admin: 'Policy administrator', publisher: 'Publisher', admin: 'Administrator' };

/* ---------- Metric tile ---------- */

/** A headline number with what it counts (the Astryx scorecard tile). */
export function StatCard({ label, value, note, action }: {
  label: string; value: ReactNode; note?: string; icon?: IconName; tone?: 'brand' | 'done' | 'waiting' | 'blocked' | 'regulatory'; action?: ReactNode;
}): ReactElement {
  return (
    <AxCard padding={5}>
      <VStack gap={1}>
        <Text type="label" color="secondary">{label}</Text>
        <Heading level={2} accessibilityLevel={3}>{value}</Heading>
        {note && <Text type="supporting" color="secondary">{note}</Text>}
        {action}
      </VStack>
    </AxCard>
  );
}

/* ---------- Loading, empty and error in one place ---------- */

/**
 * Loading skeleton, "not available yet" (endpoint not built: 404, 405 or 501), a
 * permission answer, or a retryable error; otherwise the content.
 */
export function QueryState<T>({ query, children, what, empty }: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  /** What is being loaded, in words ("the media library"). */
  what: string;
  /** Shown when the data is an empty list. */
  empty?: ReactNode;
}): ReactElement {
  if (query.isPending) return <><SkeletonRows rows={4} /><VisuallyHidden><span role="status">Loading {what}</span></VisuallyHidden></>;
  if (query.isError) {
    const e = query.error;
    // These are lists: a 404 means the API has no such endpoint yet, the same as 405 or 501.
    if (isApiError(e) && (e.kind === 'not_implemented' || e.kind === 'not_found')) {
      return <EmptyState icon="clock" title="Not available yet" description={`The backend does not provide ${what} yet. It appears here once it is connected.`} />;
    }
    if (isApiError(e) && e.kind === 'forbidden') {
      return <EmptyState kind="locked" title="No permission" description={`Your role cannot see ${what} in this organisation.`} />;
    }
    return (
      <Alert tone="blocked" title={`Could not load ${what}`}
        action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void query.refetch()}>Try again</Button>}>
        {isApiError(e) ? e.message : 'Try again in a moment.'}
      </Alert>
    );
  }
  if (Array.isArray(query.data) && query.data.length === 0 && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/** Section heading inside a page, with a hint and optional actions at the end. */
export function SectionTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }): ReactElement {
  return (
    <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
      <VStack gap={1}>
        <Heading level={2}>{title}</Heading>
        {description && <Text type="supporting" color="secondary">{description}</Text>}
      </VStack>
      {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
    </HStack>
  );
}

/**
 * True only in a simulation build running in simulation mode. Wording about
 * dummy data or "nothing was sent" is shown only then, so a real build never
 * says something that is not true for it.
 */
export function useIsSimulation(): boolean {
  const { mode } = useAuth();
  return SIMULATION_BUILD && mode === 'simulation';
}

/** Simulation data must never pass for live evidence. Renders nothing in a real build. */
export function SimulationNote({ children }: { children: ReactNode }): ReactElement | null {
  return useIsSimulation() ? <Text type="supporting" color="secondary">{children}</Text> : null;
}

/**
 * The one screen for a feature that is not in the current delivery plan (no
 * Jira ticket, or outside the demo): an Astryx EmptyState with the
 * in-development animation, shown where the feature would be. The feature's
 * own code stays in place for when it is planned.
 */
export function InDevelopment({ feature, description }: { feature: string; description?: string }): ReactElement {
  return (
    <VStack padding={6} hAlign="center">
      <AxEmptyState
        icon={<InDevelopmentAnimation />}
        title={`In development: ${feature}`}
        description={description ?? 'This feature is being built and will be available soon.'}
        headingLevel={2}
      />
    </VStack>
  );
}

/** The same, in a dialog: for a button whose action is still being developed. */
export function InDevelopmentDialog({ feature, description, onClose }: { feature: string; description?: string; onClose: () => void }): ReactElement {
  return (
    <Modal open onClose={onClose} title={feature} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <InDevelopment feature={feature} description={description} />
    </Modal>
  );
}

// Formatters are created once and reused (JS-56). Units and numbers follow the viewer's locale.
const SIZE = {
  byte: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'byte', unitDisplay: 'short' }),
  kilobyte: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'kilobyte', unitDisplay: 'short', maximumFractionDigits: 0 }),
  megabyte: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 }),
};
const RELATIVE = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: 'auto' });

/** File size in decimal units: "512 byte", "48 kB", "3.2 MB". */
export function fmtBytes(n: number): string {
  if (n >= 1e6) return SIZE.megabyte.format(n / 1e6);
  if (n >= 1e3) return SIZE.kilobyte.format(n / 1e3);
  return SIZE.byte.format(n);
}

/**
 * "3 hours ago", "in 2 days": for lists. Exact time goes in a tooltip or detail
 * view. `now` is required and comes from useNow(), never Date.now() in render.
 */
export function relTime(iso: string, now: number): string {
  const d = (Date.parse(iso) - now) / 1000;
  const rtf = RELATIVE;
  const abs = Math.abs(d);
  if (abs < 60) return rtf.format(Math.round(d), 'second');
  if (abs < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  return rtf.format(Math.round(d / 86400), 'day');
}
