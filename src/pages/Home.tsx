import type { ReactNode } from 'react';
import { PlatformLogo } from '@/components/ui/PlatformLogo';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useAuth, useSession } from '@/auth/AuthProvider';
import type { ActivityItem, ApprovalRequest, DraftSummary, Publication, SocialAccount } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { ROLE_LABELS } from '@/components/layout/AppLayout';
import {
  useAccounts, useActivity, useApprovals, useDrafts, useMembers, usePublications, useRules,
} from './shared/queries';
import {
  AccountBadge, PublicationBadge, QueryState, ReviewBadge, SectionTitle, StatCard, ValidationBadge,
} from './shared/ui';

/**
 * Home: a dashboard per role the user holds in this organisation, composed
 * like the Astryx dashboard templates: a section heading, a row of scorecard
 * tiles, then cards holding a table or a list. Counts come from the same
 * lists the sections show; nothing is invented.
 */
export default function Home() {
  const { can } = useAuth();
  const { me, context } = useSession();
  const roles = context.roles;
  const has = (r: (typeof roles)[number]) => roles.includes(r) || roles.includes('admin');
  const first = me.display_name.split(' ')[0];

  return (
    <VStack gap={10}>
      <PageHeader title={`Welcome, ${first}`}
        description={`${roles.map((r) => ROLE_LABELS[r]).join(', ') || 'No role'} in ${context.tenant.name}.`} />

      {roles.length === 0 && (
        <EmptyState kind="locked" title="Nothing to open yet"
          description={`${me.display_name}, your role here does not include any Marketing section. Ask an administrator for the role you need.`} />
      )}

      {roles.includes('admin') && can('membership:manage') && <AdminOverview />}
      {has('creator') && can('creative:write') && <CreatorDashboard />}
      {has('reviewer') && can('approval:decide') && <ReviewerDashboard />}
      {has('policy_admin') && can('policy:manage') && <PolicyDashboard />}
      {has('publisher') && can('publication:manage') && <PublisherDashboard />}
      {can('creative:read') && <RecentActivity />}
    </VStack>
  );
}

/** A card with a heading row and its content, as in the Astryx dashboard templates. */
function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card padding={6}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={3}>{title}</Heading>
          {hint && <Text type="supporting" color="secondary">{hint}</Text>}
        </VStack>
        {children}
      </VStack>
    </Card>
  );
}

const Tiles = ({ children }: { children: ReactNode }) => <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={3}>{children}</Grid>;

/* ---------- Creator ---------- */

function CreatorDashboard() {
  const drafts = useDrafts();
  const { me } = useSession();
  return (
    <VStack gap={6}>
      <SectionTitle title="Your drafts" description="Briefs you are writing, and where each one stands."
        actions={<Button variant="primary" icon="plus" href="/marketing/create">Create post</Button>} />
      <QueryState query={drafts} what="your drafts">
        {(all) => {
          const mine = all.filter((d) => d.created_by === me.user_id);
          const count = (p: (d: DraftSummary) => boolean) => mine.filter(p).length;
          return (
            <>
              <Tiles>
                <StatCard label="Drafts in progress" value={mine.length} note="Saved briefs you created" />
                <StatCard label="Need fixes" value={count((d) => d.validation === 'FAIL' || d.review === 'CHANGES_REQUESTED')} note="Failed checks or changes requested" />
                <StatCard label="Not validated or out of date" value={count((d) => d.validation === 'NOT_RUN' || d.validation === 'STALE')} note="Validate the current version" />
                <StatCard label="Waiting for review" value={count((d) => d.review === 'PENDING')} note="Submitted to a reviewer" />
              </Tiles>
              <Panel title="Continue where you left off">
                {mine.length
                  ? <Table<DraftSummary> data={mine.slice(0, 6)} columns={draftColumns} idKey="id" density="balanced" dividers="rows" hasHover />
                  : (
                    <EmptyState icon="edit" title="No drafts yet" description="Write your first brief for a recruiting study."
                      action={<Button variant="primary" href="/marketing/create">Create post</Button>} />
                  )}
              </Panel>
            </>
          );
        }}
      </QueryState>
    </VStack>
  );
}

const draftColumns: TableColumn<DraftSummary>[] = [
  {
    key: 'prompt_preview', header: 'Brief', width: proportional(3, { minWidth: 240 }),
    renderCell: (d) => (
      <VStack gap={0.5}>
        <Link href={`/marketing/create/${encodeURIComponent(d.id)}`}>{d.prompt_preview}</Link>
        <Text type="supporting" color="secondary">{d.study_title} · version {d.version}</Text>
      </VStack>
    ),
  },
  { key: 'validation', header: 'Validation', width: pixel(160), renderCell: (d) => <ValidationBadge value={d.validation} /> },
  { key: 'review', header: 'Review', width: pixel(180), renderCell: (d) => <ReviewBadge value={d.review} /> },
  { key: 'updated_at', header: 'Updated', width: pixel(130), renderCell: (d) => <Timestamp value={d.updated_at} format="relative" type="supporting" color="secondary" /> },
];

/* ---------- Reviewer ---------- */

function ReviewerDashboard() {
  const approvals = useApprovals();
  return (
    <VStack gap={6}>
      <SectionTitle title="Review queue" description="Posts waiting for your decision. Only a version that passed its checks can be approved."
        actions={<Button variant="secondary" href="/marketing/approvals">Open the queue</Button>} />
      <QueryState query={approvals} what="the review queue">
        {(all) => {
          const pending = all.filter((a) => a.state === 'PENDING');
          const forMe = pending.filter((a) => !a.is_own);
          const overdue = pending.filter((a) => a.due_at && Date.parse(a.due_at) < Date.now());
          const decided = all.filter((a) => a.decided_at && Date.now() - Date.parse(a.decided_at) < 7 * 864e5);
          return (
            <>
              <Tiles>
                <StatCard label="Waiting for you" value={forMe.length} note="Excludes your own submissions" />
                <StatCard label="Past due" value={overdue.length} note="Due date has passed" />
                <StatCard label="Out of date" value={all.filter((a) => a.state === 'STALE').length} note="Draft changed after submitting" />
                <StatCard label="Decided this week" value={decided.length} />
              </Tiles>
              <Panel title="Next to review">
                {forMe.length
                  ? <Table<ApprovalRequest> data={forMe.slice(0, 5)} columns={approvalColumns} idKey="approval_id" density="balanced" dividers="rows" hasHover />
                  : <EmptyState icon="check" title="Nothing waiting" description="New submissions appear here." />}
              </Panel>
            </>
          );
        }}
      </QueryState>
    </VStack>
  );
}

const approvalColumns: TableColumn<ApprovalRequest>[] = [
  {
    key: 'caption', header: 'Post', width: proportional(3, { minWidth: 240 }),
    renderCell: (a) => (
      <VStack gap={0.5}>
        <Link href={`/marketing/approvals/${encodeURIComponent(a.approval_id)}`}>{a.creative_id} · version {a.creative_version}</Link>
        <Text type="supporting" color="secondary" maxLines={1}>{a.caption}</Text>
      </VStack>
    ),
  },
  { key: 'validation', header: 'Validation', width: pixel(160), renderCell: (a) => <ValidationBadge value={a.validation.is_current ? a.validation.outcome : 'STALE'} /> },
  {
    key: 'due_at', header: 'Due', width: pixel(140),
    renderCell: (a) => (a.due_at ? <Timestamp value={a.due_at} format="relative" type="supporting" color="secondary" /> : <Text type="supporting" color="secondary">No due date</Text>),
  },
];

/* ---------- Policy administrator ---------- */

function PolicyDashboard() {
  const rules = useRules();
  return (
    <VStack gap={6}>
      <SectionTitle title="Policy rules" description="The rules every brief, caption and image is checked against."
        actions={<Button variant="secondary" href="/marketing/rules">Manage rules</Button>} />
      <QueryState query={rules} what="the policy rules">
        {(all) => {
          const active = all.filter((r) => r.status === 'ACTIVE');
          const failing = [...active].sort((a, b) => b.fail_count_30d - a.fail_count_30d).filter((r) => r.fail_count_30d > 0).slice(0, 5);
          return (
            <>
              <Tiles>
                <StatCard label="Active rules" value={active.length} note={`${active.filter((r) => r.mandatory).length} mandatory`} />
                <StatCard label="Drafts to publish" value={all.filter((r) => r.status === 'DRAFT').length} note="Not applied until activated" />
                <StatCard label="Failures, last 30 days" value={active.reduce((n, r) => n + r.fail_count_30d, 0)} />
                <StatCard label="Could not assess, 30 days" value={active.reduce((n, r) => n + r.unable_count_30d, 0)} note="Missing or unreadable input" />
              </Tiles>
              <Panel title="Rules that fail most often">
                {failing.length ? (
                  <List hasDividers>
                    {failing.map((r) => (
                      <ListItem key={r.rule_id} label={r.title} description={r.rule_id}
                        endContent={<Text type="supporting" color="secondary" hasTabularNumbers>{r.fail_count_30d} {r.fail_count_30d === 1 ? 'failure' : 'failures'}</Text>} />
                    ))}
                  </List>
                ) : <EmptyState icon="check" title="No failures in 30 days" />}
              </Panel>
            </>
          );
        }}
      </QueryState>
    </VStack>
  );
}

/* ---------- Publisher ---------- */

function PublisherDashboard() {
  const pubs = usePublications();
  const accounts = useAccounts();
  return (
    <VStack gap={6}>
      <SectionTitle title="Publishing" description="Scheduled posts, results that need attention, and the accounts you post to."
        actions={<Button variant="secondary" href="/marketing/publications">Open publications</Button>} />
      <QueryState query={pubs} what="publications">
        {(all) => {
          const upcoming = all.filter((p) => p.state === 'SCHEDULED' || p.state === 'QUEUED').sort((a, b) => (a.publish_at ?? '').localeCompare(b.publish_at ?? ''));
          const attention = all.filter((p) => ['FAILED', 'PARTIAL', 'UNKNOWN', 'BLOCKED'].includes(p.state));
          const accountsNeedingWork = (accounts.data ?? []).filter((a) => !['CONNECTED', 'TEST_ONLY'].includes(a.state));
          return (
            <>
              <Tiles>
                <StatCard label="Scheduled" value={upcoming.length} />
                <StatCard label="Need attention" value={attention.length} note="Failed, partial or not confirmed" />
                <StatCard label="Published, last 7 days" value={all.filter((p) => p.state === 'PUBLISHED' && p.publish_at && Date.now() - Date.parse(p.publish_at) < 7 * 864e5).length} />
                <StatCard label="Accounts to fix" value={accounts.isSuccess ? accountsNeedingWork.length : '—'} note="Expired or missing permission" />
              </Tiles>
              <Grid columns={{ minWidth: 340, repeat: 'fit' }} gap={3}>
                <Panel title="Coming up">
                  {upcoming.length ? <PublicationList rows={upcoming.slice(0, 5)} /> : <EmptyState icon="cal" title="Nothing scheduled" />}
                </Panel>
                <Panel title="Needs attention">
                  {attention.length ? <PublicationList rows={attention.slice(0, 5)} /> : <EmptyState icon="check" title="All results confirmed" />}
                </Panel>
              </Grid>
              {accountsNeedingWork.length > 0 && <AccountWarnings rows={accountsNeedingWork} />}
            </>
          );
        }}
      </QueryState>
    </VStack>
  );
}

function PublicationList({ rows }: { rows: Publication[] }) {
  return (
    <List hasDividers>
      {rows.map((p) => (
        <ListItem key={p.publication_id}
          label={`${p.creative_id} · v${p.creative_version}`}
          startContent={<HStack gap={1}>{[...new Set(p.channels.map((c) => c.channel))].map((ch) => <PlatformLogo key={ch} platform={ch} size={16} />)}</HStack>}
          description={`${p.channels.map((c) => c.account_name).join(', ')} · ${p.publish_at ? `${p.publish_at.replace('T', ' ')} ${p.timezone}` : 'As soon as possible'}`}
          endContent={<PublicationBadge value={p.state} />} />
      ))}
    </List>
  );
}

function AccountWarnings({ rows }: { rows: SocialAccount[] }) {
  return (
    <Panel title="Accounts that cannot publish">
      <List hasDividers>
        {rows.map((a) => (
          <ListItem key={a.account_id} label={a.name} description={a.state_reason} startContent={<PlatformLogo platform={a.channel} />}
            endContent={(
              <HStack gap={3} vAlign="center">
                <AccountBadge value={a.state} />
                <Button size="sm" variant="secondary" href="/marketing/integrations" aria-label={`Fix ${a.name}`}>Fix</Button>
              </HStack>
            )} />
        ))}
      </List>
    </Panel>
  );
}

/* ---------- Administrator ---------- */

function AdminOverview() {
  const members = useMembers();
  const drafts = useDrafts();
  const approvals = useApprovals();
  const pubs = usePublications();
  /** A count once the list has loaded; a dash until then (never a made-up zero). */
  const count = <T,>(rows: T[] | undefined, p: (x: T) => boolean = () => true) => (rows ? rows.filter(p).length : '—');
  return (
    <VStack gap={6}>
      <SectionTitle title="Organisation overview" description="People, work in progress and publishing across this organisation."
        actions={<Button variant="secondary" href="/marketing/team">Manage team</Button>} />
      <Tiles>
        <StatCard label="Active members" value={count(members.data, (m) => m.status === 'ACTIVE')} note={members.data ? `${members.data.filter((m) => m.status === 'INVITED').length} invited` : undefined} />
        <StatCard label="Drafts" value={count(drafts.data)} />
        <StatCard label="Waiting for review" value={count(approvals.data, (a) => a.state === 'PENDING')} />
        <StatCard label="Scheduled posts" value={count(pubs.data, (p) => p.state === 'SCHEDULED')} />
      </Tiles>
      {members.data && members.data.some((m) => !m.mfa && m.status === 'ACTIVE') && (
        <Text type="supporting" color="secondary">Some active members have not set up two-step sign-in.</Text>
      )}
    </VStack>
  );
}

/* ---------- Activity ---------- */

function RecentActivity() {
  const activity = useActivity();
  return (
    <VStack gap={6}>
      <SectionTitle title="Recent activity" description="What changed in this organisation." />
      <Card padding={6}>
        <QueryState query={activity} what="recent activity" empty={<EmptyState icon="clock" title="No activity yet" />}>
          {(items) => <ActivityList items={items.slice(0, 8)} />}
        </QueryState>
      </Card>
    </VStack>
  );
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <List hasDividers>
      {items.map((a) => (
        <ListItem key={a.id}
          label={<>{a.actor} {a.action} {a.href ? <Link href={a.href}>{a.target}</Link> : a.target}</>}
          endContent={<Timestamp value={a.at} format="relative" type="supporting" color="secondary" />} />
      ))}
    </List>
  );
}
