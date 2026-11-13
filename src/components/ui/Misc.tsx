import { Children, type ReactNode, type ReactElement } from 'react';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { Avatar as AxAvatar } from '@astryxdesign/core/Avatar';
import { Badge as AxBadge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { BreadcrumbItem, Breadcrumbs as AxBreadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState as AxEmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List as AxList, ListItem as AxListItem } from '@astryxdesign/core/List';
import { Pagination } from '@astryxdesign/core/Pagination';
import { ProgressBar as AxProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton as AxSkeleton } from '@astryxdesign/core/Skeleton';
import { Spinner as AxSpinner } from '@astryxdesign/core/Spinner';
import { Tab as AxTab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon, type IconName } from './Icon';
import { InfoTip } from './InfoTip';

/**
 * Shared page pieces. Each one is a thin composition of Astryx components,
 * laid out the way the Astryx page templates do it; there is no custom CSS.
 */

/* ---------- Tabs, segmented control ---------- */

export interface Tab<T extends string> {
  id: T;
  label: string;
  count?: number;
  attention?: boolean;
  icon?: IconName;
  regulatory?: boolean;
  disabledReason?: string;
}

/** Tabs that switch content on the page. A count shows as a Badge after the label. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Tab<T>[]; value: T; onChange: (v: T) => void; pill?: boolean; className?: string }): ReactElement {
  return (
    <TabList value={value} onChange={(v) => onChange(v as T)} role="tablist" hasDivider>
      {tabs.map((t) => (
        <AxTab key={t.id} value={t.id} label={t.label}
          icon={t.icon ? <Icon name={t.icon} /> : undefined}
          endContent={t.count !== undefined ? <AxBadge variant={t.attention ? 'blue' : 'neutral'} label={t.count} /> : undefined} />
      ))}
    </TabList>
  );
}

/** Segmented control for a view switch. */
export function Seg<T extends string>({ options, value, onChange, label = 'View' }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string; label?: string }): ReactElement {
  return (
    <SegmentedControl label={label} value={value} onChange={(v) => onChange(v as T)}>
      {options.map((o) => <SegmentedControlItem key={o.id} value={o.id} label={o.label} />)}
    </SegmentedControl>
  );
}

/* ---------- Breadcrumbs, pager ---------- */

export function Breadcrumbs({ items, badge }: { items: { label: ReactNode; to?: string; mono?: boolean }[]; badge?: ReactNode; className?: string }): ReactElement {
  return (
    <HStack gap={2} vAlign="center">
      <AxBreadcrumbs variant="supporting">
        {items.map((it, i) => (
          <BreadcrumbItem key={i} href={i < items.length - 1 ? it.to : undefined} isCurrent={i === items.length - 1}>{it.label}</BreadcrumbItem>
        ))}
      </AxBreadcrumbs>
      {badge}
    </HStack>
  );
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void; className?: string }): ReactElement | null {
  if (pages <= 1) return null;
  return <Pagination page={page} totalPages={pages} onChange={onChange} />;
}

/* ---------- Empty state, loading ---------- */

/** Says what happened and what to do next; one action. */
export function EmptyState({ icon = 'info', title, description, action, kind = 'first' }: {
  icon?: IconName; title: string; description?: ReactNode; action?: ReactNode; kind?: 'first' | 'none' | 'locked'; className?: string;
}): ReactElement {
  const text = typeof description === 'string';
  const rich = !!description && !text;
  return (
    <AxEmptyState
      title={title}
      description={text ? description : undefined}
      icon={<Icon name={kind === 'locked' ? 'lock' : icon} size={24} color="secondary" />}
      actions={rich || action ? (
        <VStack gap={3} hAlign="center">
          {rich && <Text type="body" color="secondary" justify="center">{description}</Text>}
          {action}
        </VStack>
      ) : undefined}
    />
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg'; className?: string }): ReactElement {
  return <span data-loading=""><AxSpinner size={size} /></span>;
}

/** Whole-page load. Always says what is loading. */
export function PageLoader({ label = 'Loading' }: { label?: string }): ReactElement {
  return <span data-loading=""><Center minHeight={256}><AxSpinner size="lg" label={label} /></Center></span>;
}

export function Skeleton({ style }: { className?: string; style?: React.CSSProperties }): ReactElement {
  return <span aria-hidden data-loading=""><AxSkeleton height={style?.height ?? 14} width={style?.width ?? '100%'} /></span>;
}

/** Skeleton rows standing in for a list while it loads. */
export function SkeletonRows({ rows = 3 }: { rows?: number; className?: string }): ReactElement {
  return (
    <div aria-hidden data-loading="">
      <VStack gap={3}>
        {Array.from({ length: rows }).map((_, i) => <AxSkeleton key={i} index={i} height={14} width={`${[60, 100, 80, 90, 70][i % 5]}%`} />)}
      </VStack>
    </div>
  );
}

/* ---------- Alert ---------- */

export type Tone = 'info' | 'done' | 'waiting' | 'blocked' | 'regulatory';
const TONE_STATUS: Record<Tone, 'info' | 'success' | 'warning' | 'error'> = {
  info: 'info', done: 'success', waiting: 'warning', blocked: 'error', regulatory: 'info',
};

/**
 * An inline message that stays until the condition clears (Astryx Banner).
 * Blocked messages are announced (role="alert").
 */
export function Alert({ tone = 'info', icon, title, children, action }: { tone?: Tone; icon?: IconName; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }): ReactElement {
  return (
    <div role={tone === 'blocked' ? 'alert' : undefined}>
      <Banner
        status={TONE_STATUS[tone]}
        title={title ?? children}
        description={title ? children : undefined}
        icon={icon ? <Icon name={icon} /> : undefined}
        endContent={action}
        collapsible={false}
      />
    </div>
  );
}

/* ---------- Progress ---------- */

export function ProgressBar({ value, max = 100, tone, label, valueLabel, ariaLabel }: {
  value: number; max?: number; tone?: 'brand' | 'done' | 'waiting' | 'blocked' | 'regulatory' | 'neutral'; label?: ReactNode; valueLabel?: ReactNode; lg?: boolean; className?: string;
  ariaLabel?: string;
}): ReactElement {
  const variant = ({ brand: 'accent', regulatory: 'accent', done: 'success', waiting: 'warning', blocked: 'error', neutral: 'neutral' } as const)[tone ?? 'brand'];
  return (
    <VStack gap={2}>
      {(label || valueLabel) && (
        <HStack hAlign="between" vAlign="center" gap={3}>
          <Text type="supporting">{label}</Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>{valueLabel}</Text>
        </HStack>
      )}
      <AxProgressBar label={ariaLabel ?? (typeof label === 'string' ? label : 'Progress')} isLabelHidden value={value} max={max} variant={variant} />
    </VStack>
  );
}

/* ---------- Avatar ---------- */

export function Avatar({ initials, name, size = 'md', title }: {
  id?: string; initials: string; name?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; square?: boolean; status?: 'online' | 'away'; tone?: 1 | 2 | 3 | 4 | 'muted'; className?: string; title?: string;
}): ReactElement {
  return <AxAvatar name={name ?? title ?? initials} size={size} tooltip={title ?? false} />;
}

/* ---------- List ---------- */

/** A list of rows with dividers (Astryx List). Rows that navigate end in a chevron. */
export function List({ children }: { children: ReactNode; className?: string; label?: string }): ReactElement {
  return <AxList hasDividers>{children}</AxList>;
}

/** A list row. Use `href` for navigation (a real link: new tab, copy link) and `onClick` only for actions. */
export function ListItem({ lead, title, sub, right, onClick, href, chevron, selected }: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; href?: string; chevron?: boolean; className?: string; selected?: boolean;
}): ReactElement {
  return (
    <AxListItem
      label={title}
      description={sub}
      startContent={lead}
      endContent={right || chevron ? <HStack gap={2} vAlign="center">{right}{chevron && <Icon name="chev-right" color="secondary" />}</HStack> : undefined}
      onClick={onClick}
      href={href}
      isSelected={selected}
    />
  );
}

/* ---------- Page header ---------- */

/** Breadcrumbs above the page title, one sentence under it, actions at the end. */
export function PageHeader({ crumbs, title, description, actions, badge, info }: {
  crumbs?: { label: ReactNode; to?: string; mono?: boolean }[]; title: ReactNode; description?: ReactNode; actions?: ReactNode; badge?: ReactNode; className?: string;
  info?: string;
}): ReactElement {
  return (
    <VStack gap={2}>
      {crumbs && <Breadcrumbs items={crumbs} />}
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <VStack gap={1}>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Heading level={1}>{title}</Heading>
              {info && <InfoTip text={info} label={typeof title === 'string' ? `About ${title}` : undefined} />}
              {badge}
            </HStack>
            {description && <Text type="body" color="secondary">{description}</Text>}
          </VStack>
        </StackItem>
        {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
      </HStack>
    </VStack>
  );
}

/* ---------- Two-column page body ---------- */

/**
 * Main column (two thirds) and a side column (one third) on wide screens,
 * stacked on narrow ones. The first child is the main column, the second the
 * side column; anything after (dialogs) renders as is.
 */
export function TwoColumn({ children }: { children: ReactNode }): ReactElement {
  const narrow = useMediaQuery('(max-width: 1100px)');
  const [main, side, ...rest] = Children.toArray(children);
  return (
    <>
      {narrow
        ? <VStack gap={6}>{main}{side}</VStack>
        : (
          <HStack gap={6} vAlign="start">
            <StackItem size="fill">{main}</StackItem>
            <VStack width={400}>{side}</VStack>
          </HStack>
        )}
      {rest}
    </>
  );
}
