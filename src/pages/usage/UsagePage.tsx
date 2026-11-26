import { useMemo, useState, type ReactElement } from 'react';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useSession } from '@/auth/AuthProvider';
import { isApiError } from '@/api/errors';
import {
  fmtUsd, fromMicros, toMicros, usageApi, type Attempt, type AttemptFilter, type Balance, type Price, type PriceList,
} from '@/api/usage';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Form';
import { Alert, EmptyState, PageHeader, SkeletonRows } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { saveFile } from '@/lib/download';
import { fmtDateTime } from '@/lib/utils';
import { InDevelopment, QueryState, StatCard, useInDevelopment, useIsSimulation } from '@/pages/shared/ui';
import { AttemptStatusBadge, OUTCOME_LABEL, attemptsCsv, billedText, postHref, settingsOf } from './parts';
import { useAttempts, useBalance, usePrices } from './useUsage';

/**
 * Usage and balance (NRC-44): the provider balance and what is held for
 * running generations, what the balance can still make under a chosen plan,
 * and every paid attempt with its estimate, bill and refund kept apart.
 * Nothing here adds funds or changes billing.
 */
export default function UsagePage(): ReactElement {
  const usageInDev = useInDevelopment('usage');
  const sim = useIsSimulation();
  const balance = useBalance(!usageInDev);
  const prices = usePrices(!usageInDev);

  if (usageInDev) {
    return (
      <VStack gap={8}>
        <PageHeader title="Usage and balance" description="What AI generation cost, and what the balance can still make." />
        <InDevelopment feature="Usage and balance" description="Generation costs, the balance and forecasts are being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Usage and balance" description="What AI generation cost, and what the balance can still make. Amounts are in US dollars." />
      {sim && <Alert tone="info" title="Simulation">These amounts are dummy values, not real Higgsfield prices, balances or bills.</Alert>}
      <QueryState query={balance} what="the balance">
        {(b) => <BalanceSection balance={b} />}
      </QueryState>
      <Forecast balance={balance.data} prices={prices} />
      <Attempts />
    </VStack>
  );
}

/* ---------- Balance ---------- */

/** Spendable now: the live balance less what is reserved, capped by the organisation's allocation. Null when it cannot be known. */
export function spendable(b: Balance): bigint | null {
  if (b.source !== 'LIVE' || b.amount == null) return null;
  const free = toMicros(b.amount) - toMicros(b.reserved);
  const cap = b.allocation ? toMicros(b.allocation.remaining) : null;
  const v = cap != null && cap < free ? cap : free;
  return v < 0n ? 0n : v;
}

function BalanceSection({ balance: b }: { balance: Balance }) {
  const free = spendable(b);
  const low = free != null && free < toMicros(b.low_threshold);
  const exhausted = b.allocation != null && toMicros(b.allocation.remaining) <= 0n;
  const label = b.source === 'LIVE' ? 'Balance now' : b.source === 'SNAPSHOT' ? 'Last known balance' : 'Balance';

  return (
    <VStack gap={4}>
      {b.source === 'UNAVAILABLE' && (
        <Alert tone="waiting" title="The balance is not available">
          {b.provider} did not report a balance. Generation may still be refused if funds run out. Try again later, or ask an administrator to check the provider account.
        </Alert>
      )}
      {b.source === 'SNAPSHOT' && (
        <Alert tone="waiting" title="This balance is not current">
          It is the last figure {b.provider} reported{b.as_of ? `, on ${fmtDateTime(b.as_of)}` : ''}. Spending since then is not included, so no forecast count is shown.
        </Alert>
      )}
      {exhausted && (
        <Alert tone="blocked" title="This organisation's allocation is used up">
          New generations are refused until an administrator raises the allocation. Validation and checking still work and cost nothing.
        </Alert>
      )}
      {low && !exhausted && (
        <Alert tone="waiting" title="The balance is low">
          {fmtUsd(fromMicros(free))} can still be spent, below the {fmtUsd(b.low_threshold)} warning level. Ask an administrator to add funds before large video runs.
        </Alert>
      )}
      <Grid columns={{ minWidth: 200 }} gap={4}>
        <StatCard label={label} value={b.amount != null ? fmtUsd(b.amount) : 'Not available'}
          note={b.as_of ? `${b.provider} · ${b.source === 'LIVE' ? 'reported' : 'as of'} ${fmtDateTime(b.as_of)}` : b.provider} />
        <StatCard label="Reserved" value={fmtUsd(b.reserved)} note="Held for generations still running; not billed yet." />
        {b.allocation && (
          <StatCard label="Allocation left" value={fmtUsd(b.allocation.remaining)}
            note={`Of ${fmtUsd(b.allocation.allocated)} for this organisation · ${fmtUsd(b.allocation.confirmed_used)} billed · ${fmtUsd(b.allocation.reserved)} reserved`} />
        )}
        <StatCard label="Can be spent now" value={free != null ? fmtUsd(fromMicros(free)) : 'Not known'}
          note={free != null ? 'Balance less reservations, within the allocation.' : 'Needs a current balance.'} />
      </Grid>
      {b.provider_tokens != null && <Text type="supporting" color="secondary">{b.provider} also reports {b.provider_tokens} tokens. Tokens are the provider's own unit, not dollars.</Text>}
      {b.recharge_url && (
        <Text type="body">
          To add funds, an administrator uses the <Link href={b.recharge_url} target="_blank">provider console</Link>. Funds are never added from this page.
        </Text>
      )}
    </VStack>
  );
}

/* ---------- Forecast ---------- */

type Plan = 'image' | 'video' | 'mixed';
const priceKey = (p: Price) => `${p.model}|${p.resolution}`;

/** Cost of one post under the plan, exactly, in millionths of a dollar. */
export function costPerPost(plan: Plan, image: Price | undefined, images: number, video: Price | undefined, duration: number, audio: boolean): bigint | null {
  let total = 0n;
  if (plan !== 'video') {
    if (!image) return null;
    total += toMicros(image.unit_price) * BigInt(images);
  }
  if (plan !== 'image') {
    if (!video) return null;
    const perSecond = toMicros(video.unit_price) + (audio && video.audio_unit_price ? toMicros(video.audio_unit_price) : 0n);
    total += perSecond * BigInt(duration);
  }
  return total;
}

function Forecast({ balance, prices }: { balance: Balance | undefined; prices: ReturnType<typeof usePrices> }) {
  return (
    <Card>
      <CardHead title="What the balance can still make" icon="chart" />
      <CardBody>
        {prices.isPending ? <SkeletonRows rows={3} />
          : prices.isError || !prices.data
            ? <Alert tone="waiting" title="Prices are not available">{isApiError(prices.error) ? prices.error.message : 'Try again later.'} No forecast is shown without prices.</Alert>
            : <ForecastForm balance={balance} prices={prices.data} />}
      </CardBody>
    </Card>
  );
}

function ForecastForm({ balance, prices }: { balance: Balance | undefined; prices: PriceList }) {
  const images = prices.items.filter((p) => p.kind === 'image');
  const videos = prices.items.filter((p) => p.kind === 'video');
  const [plan, setPlan] = useState<Plan>('image');
  const [imageKey, setImageKey] = useState(images[0] ? priceKey(images[0]) : '');
  const [imageCount, setImageCount] = useState(1);
  const [videoKey, setVideoKey] = useState(videos[0] ? priceKey(videos[0]) : '');
  const video = videos.find((p) => priceKey(p) === videoKey);
  const [duration, setDuration] = useState(video?.durations_s?.[0] ?? 5);
  const [audio, setAudio] = useState(true);
  const image = images.find((p) => priceKey(p) === imageKey);
  const durations = video?.durations_s ?? [5];
  const dur = durations.includes(duration) ? duration : durations[0];

  const cost = costPerPost(plan, image, imageCount, video, dur, audio);
  const free = balance ? spendable(balance) : null;
  const count = cost && cost > 0n && free != null ? free / cost : null;

  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 220 }} gap={4}>
        <Select label="Each post has" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
          <option value="image">Images only</option>
          <option value="video">One video</option>
          <option value="mixed">Images and a video</option>
        </Select>
        {plan !== 'video' && (
          <>
            <Select label="Image model" value={imageKey} onChange={(e) => setImageKey(e.target.value)}>
              {images.map((p) => <option key={priceKey(p)} value={priceKey(p)}>{p.label} · {p.resolution} · {fmtUsd(p.unit_price)} each</option>)}
            </Select>
            <Select label="Images per post" value={String(imageCount)} onChange={(e) => setImageCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </>
        )}
        {plan !== 'image' && (
          <>
            <Select label="Video model" value={videoKey} onChange={(e) => setVideoKey(e.target.value)}>
              {videos.map((p) => <option key={priceKey(p)} value={priceKey(p)}>{p.label} · {p.resolution} · {fmtUsd(p.unit_price)} a second</option>)}
            </Select>
            <Select label="Video length" value={String(dur)} onChange={(e) => setDuration(Number(e.target.value))}>
              {durations.map((d) => <option key={d} value={d}>{d} seconds</option>)}
            </Select>
            <Switch label={`Audio${video?.audio_unit_price ? ` (+${fmtUsd(video.audio_unit_price)} a second)` : ''}`} value={audio} onChange={setAudio} />
          </>
        )}
      </Grid>

      <Grid columns={{ minWidth: 200 }} gap={4}>
        <StatCard label="Cost of one post" value={cost != null ? fmtUsd(fromMicros(cost)) : 'Not known'} note="One attempt each, before any retries." />
        <StatCard label="Posts the balance covers" value={count != null ? `About ${count.toString()}` : 'Not shown'}
          note={count != null ? 'If every attempt is used and none is retried.' : 'Needs a current balance.'} />
      </Grid>
      {free == null && (
        <Alert tone="waiting" title="No count without a current balance">
          The balance is a snapshot or not available, so a number of posts could be wrong. The cost of one post is still shown.
        </Alert>
      )}

      <VStack gap={1}>
        <Heading level={3}>Assumptions</Heading>
        <List listStyle="disc" density="compact">
          <ListItem label={<Text type="body" wordBreak="break-word">Prices as of {fmtDateTime(prices.as_of)}{balance?.as_of ? `; balance as of ${fmtDateTime(balance.as_of)}` : ''}.</Text>} />
          <ListItem label={<Text type="body" wordBreak="break-word">Rejected or retried attempts cost the same again, so real posts are usually fewer.</Text>} />
          <ListItem label={<Text type="body" wordBreak="break-word">Image-only and video-only counts use the same balance. They are alternatives and cannot be added together.</Text>} />
        </List>
      </VStack>
    </VStack>
  );
}

/* ---------- Attempts ---------- */

/** A YYYY-MM-DD date, as the Astryx DateInput reads and writes it. */
type ISODateString = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

function Attempts() {
  const { context } = useSession();
  const { toast } = useToast();
  const prices = usePrices();
  const [filter, setFilter] = useState<Omit<AttemptFilter, 'cursor' | 'from' | 'to'> & { from?: ISODateString; to?: ISODateString }>({});
  const [exporting, setExporting] = useState(false);
  const q = useAttempts(filter);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = q.data?.pages[0]?.totals;
  const columns = useMemo(() => attemptColumns(), []);
  const models = [...new Map((prices.data?.items ?? []).map((p) => [p.model, p.label])).entries()];
  const set = (patch: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...patch }));

  /** The statement covers the whole filtered range, fetched page by page. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: Attempt[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 100; i++) {
        const page = await usageApi.attempts({ ...filter, cursor });
        all.push(...page.items);
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      saveFile(`usage-${context.tenant.tenant_id}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([attemptsCsv(all)], { type: 'text/csv' }));
    } catch (e) {
      toast('The statement could not be downloaded', 'blocked', isApiError(e) ? e.message : 'Try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHead title="Generation attempts" icon="clock">
        <Button variant="secondary" size="sm" icon="dl" loading={exporting} disabled={!totals?.attempts} onClick={() => void exportCsv()}>Download CSV</Button>
      </CardHead>
      <CardBody>
        <Grid columns={{ minWidth: 180 }} gap={3}>
          <DateInput label="From" value={filter.from} max={filter.to} onChange={(v) => set({ from: v })} width="100%" />
          <DateInput label="To" value={filter.to} min={filter.from} onChange={(v) => set({ to: v })} width="100%" />
          <Select label="Model" value={filter.model ?? 'all'} onChange={(e) => set({ model: e.target.value === 'all' ? undefined : e.target.value })}>
            <option value="all">All models</option>
            {models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <Input label="Post" value={filter.creative_id ?? ''} placeholder="Post ID" onChange={(e) => set({ creative_id: e.target.value.trim() || undefined })} />
        </Grid>

        {totals && (
          <MetadataList aria-label="Totals for the filtered attempts">
            <MetadataListItem label="Attempts">{totals.attempts}</MetadataListItem>
            <MetadataListItem label="Confirmed (billed)">{fmtUsd(totals.confirmed)}</MetadataListItem>
            <MetadataListItem label="Refunded">{fmtUsd(totals.refunded)}</MetadataListItem>
            <MetadataListItem label="Reserved (not billed yet)">{fmtUsd(totals.reserved)}</MetadataListItem>
            <MetadataListItem label="Estimated before each request">{fmtUsd(totals.estimated)}</MetadataListItem>
            {totals.unknown > 0 && <MetadataListItem label="Billing unknown">{totals.unknown} {totals.unknown === 1 ? 'attempt' : 'attempts'}: not in the billed total until the provider confirms</MetadataListItem>}
          </MetadataList>
        )}

        <QueryState query={q} what="generation attempts"
          empty={<EmptyState icon="dollar" title="No attempts" description="No paid generation matches these filters. Checking posts never costs anything." />}>
          {() => (rows.length
            ? <Table<Attempt> data={rows} columns={columns} idKey="attempt_id" density="balanced" dividers="rows" />
            : <EmptyState icon="dollar" title="No attempts" description="No paid generation matches these filters. Checking posts never costs anything." />)}
        </QueryState>
        {q.hasNextPage && (
          <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more attempts</Button>
        )}
      </CardBody>
    </Card>
  );
}

function attemptColumns(): TableColumn<Attempt>[] {
  return [
    { key: 'created_at', header: 'When', width: pixel(120), renderCell: (a) => <Text type="body" hasTabularNumbers>{fmtDateTime(a.created_at)}</Text> },
    {
      key: 'creative_id', header: 'Post', width: proportional(2, { minWidth: 160 }),
      renderCell: (a) => (
        <VStack gap={0.5} hAlign="start">
          <Link href={postHref(a)}>{a.creative_id} · version {a.creative_version}</Link>
          <Text type="supporting" color="secondary" wordBreak="break-word">{a.workflow === 'VALIDATION_ONLY' ? 'AI fix of a client post' : 'Create with AI'} · {OUTCOME_LABEL[a.outcome]}</Text>
        </VStack>
      ),
    },
    {
      key: 'model', header: 'Model and settings', width: proportional(2, { minWidth: 180 }),
      renderCell: (a) => (
        <VStack gap={0.5}>
          <Text type="body" wordBreak="break-word">{a.model_label}</Text>
          <Text type="supporting" color="secondary">{settingsOf(a)}</Text>
        </VStack>
      ),
    },
    {
      key: 'amounts', header: 'Billing (USD)', width: proportional(2, { minWidth: 200 }),
      renderCell: (a) => (
        <VStack gap={1} hAlign="start">
          <AttemptStatusBadge value={a.status} />
          <Text type="body" hasTabularNumbers>Billed: {billedText(a)}</Text>
          <Text type="supporting" color="secondary" hasTabularNumbers wordBreak="break-word">
            Estimated {fmtUsd(a.estimated)}{a.refunded ? ` · refunded ${fmtUsd(a.refunded)}` : ''}
            {a.confirmed != null && a.confirmed !== a.estimated && a.status === 'CONFIRMED' ? ' · billed differs from the estimate' : ''}
          </Text>
        </VStack>
      ),
    },
  ];
}
