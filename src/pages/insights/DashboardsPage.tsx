import { useState, type ReactElement, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Table, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useSession } from '@/auth/AuthProvider';
import { analyticsApi, type Dashboard, type DashboardFilter, type Freshness } from '@/api/analytics';
import { fmtUsd } from '@/api/usage';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import { Alert, PageHeader, ProgressBar, Seg, Tabs } from '@/components/ui/Misc';
import { PLATFORM_NAME, type Platform } from '@/components/ui/PlatformLogo';
import { saveFile } from '@/lib/download';
import { fmtDateTime } from '@/lib/utils';
import { useSocialSets } from '@/pages/shared/queries';
import { InDevelopment, QueryState, StatCard, useInDevelopment, useIsSimulation } from '@/pages/shared/ui';
import { csvCell } from '@/pages/usage/parts';

type View = 'usage' | 'validation' | 'social';
/** A YYYY-MM-DD date, as the Astryx DateInput reads and writes it. */
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

/** One row of a bar chart: a value the backend has, or null with the reason it has not. */
interface Bar { label: string; value: number | null; text: string; note?: string }

const count = new Intl.NumberFormat('en-US');
const n = (v: number | null) => (v == null ? 'Not available' : count.format(v));

/**
 * Dashboards (NRC-46): usage and cost, validation quality and social
 * performance, with shared filters. Every figure says how fresh it is and what
 * it means; a figure the backend does not have reads "Not available", never 0.
 */
export default function DashboardsPage(): ReactElement {
  const analyticsInDev = useInDevelopment('analytics');
  const sim = useIsSimulation();
  const { context } = useSession();
  const sets = useSocialSets(!analyticsInDev);
  const [view, setView] = useState<View>('usage');
  const [filter, setFilter] = useState<Omit<DashboardFilter, 'from' | 'to'> & { from?: ISODate; to?: ISODate }>({});
  const set = (p: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...p }));
  const q = useQuery({
    queryKey: ['analytics', context.tenant.tenant_id, filter],
    queryFn: ({ signal }) => analyticsApi.dashboard(filter, signal),
    enabled: !analyticsInDev,
    placeholderData: keepPreviousData,
  });

  if (analyticsInDev) {
    return (
      <VStack gap={8}>
        <PageHeader title="Dashboards" description="Usage and cost, validation quality and social performance." />
        <InDevelopment feature="Dashboards" description="Usage, validation and social dashboards are being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Dashboards" description="Usage and cost, validation quality and social performance, for the filters you choose."
        actions={q.data ? <Button variant="secondary" icon="dl" onClick={() => exportCsv(view, q.data, filter)}>Download CSV</Button> : undefined} />
      {sim && <Alert tone="info" title="Simulation">These figures come from dummy data. They are not real costs, results or social metrics.</Alert>}

      <Grid columns={{ minWidth: 180 }} gap={3}>
        <DateInput label="From" value={filter.from} max={filter.to} onChange={(v) => set({ from: v })} width="100%" />
        <DateInput label="To" value={filter.to} min={filter.from} onChange={(v) => set({ to: v })} width="100%" />
        <Select label="Study" value={filter.study_id ?? 'all'} onChange={(e) => set({ study_id: e.target.value === 'all' ? undefined : e.target.value })}>
          <option value="all">All studies</option>
          {context.studies.map((s) => <option key={s.study_id} value={s.study_id}>{s.study_title}</option>)}
        </Select>
        <Select label="Social set" value={filter.social_set_id ?? 'all'} onChange={(e) => set({ social_set_id: e.target.value === 'all' ? undefined : e.target.value })}>
          <option value="all">All social sets</option>
          {(sets.data ?? []).map((s) => <option key={s.social_set_id} value={s.social_set_id}>{s.name}</option>)}
        </Select>
        <Select label="Workflow" value={filter.workflow ?? 'all'} onChange={(e) => set({ workflow: e.target.value === 'all' ? undefined : e.target.value as DashboardFilter['workflow'] })}>
          <option value="all">Both workflows</option>
          <option value="AI_CREATE">Create with AI</option>
          <option value="VALIDATION_ONLY">Check an existing post</option>
        </Select>
      </Grid>

      <VStack gap={4}>
        <Tabs<View> value={view} onChange={setView} tabs={[
          { id: 'usage', label: 'Usage and cost' },
          { id: 'validation', label: 'Validation quality' },
          { id: 'social', label: 'Social performance' },
        ]} />
        <QueryState query={q} what="the dashboards">
          {(d) => (view === 'usage' ? <UsageView d={d} /> : view === 'validation' ? <ValidationView d={d} /> : <SocialView d={d} />)}
        </QueryState>
      </VStack>
    </VStack>
  );
}

/* ---------- Shared pieces ---------- */

function FreshnessNote({ f, what }: { f: Freshness; what: string }) {
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">{f.as_of ? `${what} as of ${fmtDateTime(f.as_of)}.` : `No ${what.toLowerCase()} yet.`}</Text>
      {f.partial && <Alert tone="waiting" title="Partial data">{f.partial}</Alert>}
    </VStack>
  );
}

/**
 * A horizontal bar per row, in one colour, each with its value written out;
 * or the same rows as a table. A missing value gets no bar and says why.
 */
function BarChart({ title, rows, valueHeader, children }: { title: string; rows: Bar[]; valueHeader: string; children?: ReactNode }) {
  const [as, setAs] = useState<'bars' | 'table'>('bars');
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  const columns: TableColumn<Bar & Record<string, unknown>>[] = [
    { key: 'label', header: 'Item', width: proportional(2, { minWidth: 160 }), renderCell: (r) => <Text type="body" wordBreak="break-word">{r.label}</Text> },
    { key: 'text', header: valueHeader, width: proportional(1, { minWidth: 140 }), renderCell: (r) => <Text type="body" hasTabularNumbers>{r.text}</Text> },
    { key: 'note', header: 'Note', width: proportional(2, { minWidth: 160 }), renderCell: (r) => <Text type="supporting" color="secondary" wordBreak="break-word">{r.note ?? ''}</Text> },
  ];
  return (
    <Card>
      <CardHead title={title} icon="chart">
        <Seg label={`Show ${title} as`} value={as} onChange={setAs} options={[{ id: 'bars', label: 'Bars' }, { id: 'table', label: 'Table' }]} />
      </CardHead>
      <CardBody>
        {!rows.length ? <Text type="body" color="secondary">Nothing for these filters.</Text>
          : as === 'table'
            ? <Table<Bar & Record<string, unknown>> data={rows.map((r) => ({ ...r }))} columns={columns} idKey="label" density="balanced" dividers="rows" />
            : (
              <VStack gap={4}>
                {rows.map((r) => (r.value == null
                  ? (
                    <VStack key={r.label} gap={1}>
                      <HStack hAlign="between" gap={3} wrap="wrap"><Text type="supporting">{r.label}</Text><Text type="supporting" color="secondary">Not available</Text></HStack>
                      {r.note && <Text type="supporting" color="secondary" wordBreak="break-word">{r.note}</Text>}
                    </VStack>
                  )
                  : <ProgressBar key={r.label} value={r.value} max={max} label={r.label} valueLabel={r.text} ariaLabel={`${r.label}: ${r.text}`} />))}
              </VStack>
            )}
        {children}
      </CardBody>
    </Card>
  );
}

function Definitions({ items }: { items: [string, string][] }) {
  return (
    <VStack gap={1}>
      <Heading level={3}>What these mean</Heading>
      <List listStyle="disc" density="compact">
        {items.map(([term, def]) => <ListItem key={term} label={<Text type="body" wordBreak="break-word"><Text type="body" weight="semibold">{term}:</Text> {def}</Text>} />)}
      </List>
    </VStack>
  );
}

/* ---------- Views ---------- */

function UsageView({ d }: { d: Dashboard }) {
  const u = d.usage;
  return (
    <VStack gap={6}>
      <FreshnessNote f={u.freshness} what="Usage" />
      <Grid columns={{ minWidth: 190 }} gap={4}>
        <StatCard label="Generation attempts" value={n(u.attempts)} note={`${u.usable_outputs} used in a post`} />
        <StatCard label="Billed" value={fmtUsd(u.confirmed)} note={u.unconfirmed_estimate !== '0.00' ? `Plus ${fmtUsd(u.unconfirmed_estimate)} estimated, not billed yet` : 'All attempts billed'} />
        <StatCard label="Cost per usable output" value={u.cost_per_usable ? fmtUsd(u.cost_per_usable) : 'Not available'} note={`Billed ÷ ${u.usable_outputs} usable outputs`} />
        <StatCard label="Cost per published post" value={u.cost_per_published ? fmtUsd(u.cost_per_published) : 'Not available'} note={`Billed ÷ ${u.published_posts} published posts`} />
        <StatCard label="Median time to an image" value={u.median_latency_s != null ? `${u.median_latency_s} s` : 'Not available'} />
      </Grid>
      <BarChart title="Attempts by model" valueHeader="Attempts"
        rows={u.by_model.map((m) => ({ label: m.model_label, value: m.attempts, text: `${m.attempts} (${m.usable} used)`, note: `${fmtUsd(m.confirmed)} billed` }))} />
      <Definitions items={[
        ['Billed', 'what the provider confirmed. Estimates for attempts not billed yet are shown apart and never added in.'],
        ['Cost per published post', 'each post counts once, however many accounts it went to, so reused images do not raise the cost.'],
        ['Usable output', 'an image or video used in the post; rejected, replaced and discarded attempts still cost money but are not counted here.'],
      ]} />
      <Link href="/marketing/usage">Every attempt, with its bill, on Usage and balance</Link>
    </VStack>
  );
}

function ValidationView({ d }: { d: Dashboard }) {
  const v = d.validation;
  const pct = (x: number) => (v.runs ? `${Math.round((x / v.runs) * 100)}%` : '—');
  return (
    <VStack gap={6}>
      <FreshnessNote f={v.freshness} what="Validation" />
      <Grid columns={{ minWidth: 190 }} gap={4}>
        <StatCard label="Checks run" value={n(v.runs)} />
        <StatCard label="Passed" value={n(v.pass)} note={`${pct(v.pass)} of checks`} />
        <StatCard label="Failed" value={n(v.fail)} note={`${pct(v.fail)} of checks`} />
        <StatCard label="Needs review" value={n(v.needs_review)} note={`${v.unable_to_assess} could not assess a required check`} />
        <StatCard label="Versions to pass" value={v.avg_correction_rounds != null ? v.avg_correction_rounds.toFixed(1) : 'Not available'} note="Average, for posts that passed" />
      </Grid>
      <BarChart title="Results" valueHeader="Checks" rows={[
        { label: 'Passed', value: v.pass, text: `${v.pass} · ${pct(v.pass)}` },
        { label: 'Failed', value: v.fail, text: `${v.fail} · ${pct(v.fail)}` },
        { label: 'Needs review', value: v.needs_review, text: `${v.needs_review} · ${pct(v.needs_review)}` },
      ]} />
      <BarChart title="Rules found most often" valueHeader="Findings"
        rows={v.top_rules.map((r) => ({ label: `${r.rule_id}: ${r.title}`, value: r.findings, text: String(r.findings) }))} />
      <Definitions items={[
        ['Passed', 'no rule failed on that version. It is not an approval.'],
        ['Needs review', 'a person must decide, including when a required check could not be assessed.'],
      ]} />
      <Link href="/marketing/validation">Open the checks and their evidence</Link>
    </VStack>
  );
}

function SocialView({ d }: { d: Dashboard }) {
  const s = d.social;
  const name = (c: string) => PLATFORM_NAME[c as Platform] ?? c;
  return (
    <VStack gap={6}>
      <FreshnessNote f={s.freshness} what="Social figures" />
      <Grid columns={{ minWidth: 170 }} gap={4}>
        <StatCard label="Published" value={n(s.published)} note="Confirmed by the network" />
        <StatCard label="Failed" value={n(s.failed)} />
        <StatCard label="Not confirmed" value={n(s.unknown)} note="Check before retrying" />
        <StatCard label="Partly published" value={n(s.partial)} />
        <StatCard label="Posted by hand" value={n(s.manual)} note="Never counted as published" />
      </Grid>
      <BarChart title="Impressions by account" valueHeader="Impressions"
        rows={s.by_account.map((a) => ({ label: `${a.account_name} (${name(a.channel)})`, value: a.impressions, text: n(a.impressions), note: a.unavailable_reason ?? `${n(a.engagements)} engagements · ${n(a.video_views)} video views` }))} />
      <Alert tone="info" title="Figures are not added across networks">
        Each network counts impressions and views its own way, so there is no total reach across networks. Compare accounts on the same network only.
      </Alert>
      <Definitions items={[
        ['Impressions', 'how often the network says the post was shown, as it reports it.'],
        ['Not available', 'the network sent no figure. It is not zero.'],
      ]} />
      <Link href="/marketing/publications">Open the publications</Link>
    </VStack>
  );
}

/* ---------- CSV ---------- */

function exportCsv(view: View, d: Dashboard, f: DashboardFilter) {
  const scope = [`Filters: from ${f.from ?? 'any'} to ${f.to ?? 'any'}; study ${f.study_id ?? 'all'}; social set ${f.social_set_id ?? 'all'}; workflow ${f.workflow ?? 'both'}`, `Generated ${d.generated_at} (UTC)`];
  let rows: (string | number | null)[][];
  if (view === 'usage') {
    rows = [['Model', 'Attempts', 'Used', 'Billed USD'], ...d.usage.by_model.map((m) => [m.model_label, m.attempts, m.usable, m.confirmed]),
      [], ['Billed USD', d.usage.confirmed], ['Estimated, not billed USD', d.usage.unconfirmed_estimate], ['Cost per usable output USD', d.usage.cost_per_usable ?? 'Not available'], ['Cost per published post USD', d.usage.cost_per_published ?? 'Not available']];
  } else if (view === 'validation') {
    rows = [['Result', 'Checks'], ['Passed', d.validation.pass], ['Failed', d.validation.fail], ['Needs review', d.validation.needs_review],
      [], ['Rule', 'Findings'], ...d.validation.top_rules.map((r) => [`${r.rule_id}: ${r.title}`, r.findings])];
  } else {
    rows = [['Account', 'Network', 'Published posts', 'Impressions', 'Engagements', 'Video views', 'Note'],
      ...d.social.by_account.map((a) => [a.account_name, a.channel, a.posts, a.impressions ?? 'Not available', a.engagements ?? 'Not available', a.video_views ?? 'Not available', a.unavailable_reason])];
  }
  const csv = [...scope.map((s) => csvCell(s)), '', ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
  saveFile(`dashboard-${view}-${d.generated_at.slice(0, 10)}.csv`, new Blob([csv], { type: 'text/csv' }));
}
