import { useMemo, useState, type ReactElement } from 'react';
import { useNow } from '@/lib/useNow';
import { PLATFORM_NAME, PlatformLogo } from '@/components/ui/PlatformLogo';
import { Calendar } from '@astryxdesign/core/Calendar';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type Publication, type PublicationRequest, type PublicationTarget, type SocialAccount } from '@/api/workspace';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { saveFile } from '@/lib/download';
import { charCount, fmtDateTime } from '@/lib/utils';
import { useAccounts, useApprovals, usePublications, useSocialSets, useWorkspaceMutation } from '@/pages/shared/queries';
import { AccountBadge, InDevelopment, PublicationBadge, QueryState, relTime, useIsSimulation, useInDevelopment } from '@/pages/shared/ui';
import { FIELD_LABEL } from '@/pages/accounts/AccountsPage';

type View = 'upcoming' | 'calendar' | 'attention' | 'history';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'UTC'];
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const defaultZone = () => (TIMEZONES.includes(localZone()) ? localZone() : 'America/New_York');

/** A YYYY-MM-DD date, as the Astryx Calendar reads and writes it. */
type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

/** "2026-11-12T09:00" (wall time in the post's zone) shown as written, with its zone. */
const wallTime = (p: Pick<Publication, 'publish_at' | 'timezone'>) => (p.publish_at ? `${p.publish_at.replace('T', ' ')} (${p.timezone})` : 'As soon as possible');

/**
 * Publications (NRC-24, eight networks NRC-39): what is scheduled, a calendar
 * of it, what needs attention and what was sent, with each account's own
 * result. Simulation never marks anything as live, and an account without a
 * publishing API is handed off to post by hand, never shown as published.
 */
export default function PublicationsPage(): ReactElement {
  const publicationsInDev = useInDevelopment('publications');
  const { can } = useAuth();
  const sim = useIsSimulation();
  // Not fetched while publishing is in development: the backend has no /publications yet.
  const pubs = usePublications(!publicationsInDev);
  const [view, setView] = useState<View>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const all = pubs.data ?? [];
  const groups: Record<Exclude<View, 'calendar'>, Publication[]> = {
    upcoming: all.filter((p) => p.state === 'SCHEDULED' || p.state === 'QUEUED' || p.state === 'PROCESSING').sort((a, b) => (a.publish_at ?? '').localeCompare(b.publish_at ?? '')),
    attention: all.filter((p) => ['FAILED', 'PARTIAL', 'UNKNOWN', 'BLOCKED', 'MANUAL'].includes(p.state) || p.channels.some((c) => c.state === 'MANUAL')),
    history: all.filter((p) => p.state === 'PUBLISHED' || p.state === 'CANCELLED'),
  };
  const columns = useMemo(() => publicationColumns((p) => setOpenId(p.publication_id)), []);
  const open = all.find((p) => p.publication_id === openId);

  if (publicationsInDev) {
    return (
      <VStack gap={8}>
        <PageHeader title="Publications" description="Schedule approved posts and follow each channel's result." />
        <InDevelopment feature="Publishing" description="Scheduling approved posts and following each channel's result is being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Publications" description="Schedule approved posts and follow each account's result."
        actions={can('publication:manage') ? <Button variant="primary" icon="cal" onClick={() => setScheduling(true)}>Schedule a post</Button> : undefined} />
      {sim && <Alert tone="info" title="Simulation">Nothing here is sent to any social network. Results shown as published are dummy history.</Alert>}
      <VStack gap={4}>
        <Tabs<View> value={view} onChange={setView} tabs={[
          { id: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
          { id: 'calendar', label: 'Calendar' },
          { id: 'attention', label: 'Needs attention', count: groups.attention.length, attention: groups.attention.length > 0 },
          { id: 'history', label: 'History', count: groups.history.length },
        ]} />
        <QueryState query={pubs} what="publications">
          {() => (view === 'calendar'
            ? <CalendarView pubs={all} onOpen={(p) => setOpenId(p.publication_id)} />
            : groups[view].length
              ? <Table<Publication> data={groups[view]} columns={columns} idKey="publication_id" density="balanced" dividers="rows" hasHover />
              : <EmptyState icon={view === 'attention' ? 'check' : 'cal'} title={view === 'upcoming' ? 'Nothing scheduled' : view === 'attention' ? 'All results confirmed' : 'No history yet'} />)}
        </QueryState>
      </VStack>
      {open && <PublicationDrawer pub={open} onClose={() => setOpenId(null)} />}
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} />}
    </VStack>
  );
}

function publicationColumns(onOpen: (p: Publication) => void): TableColumn<Publication>[] {
  return [
    {
      key: 'caption', header: 'Post', width: proportional(3, { minWidth: 220 }),
      renderCell: (p) => (
        <VStack gap={0.5} hAlign="start">
          <Link onClick={() => onOpen(p)}>{p.creative_id} · version {p.creative_version}</Link>
          <Text type="supporting" color="secondary" maxLines={1}>{p.caption}</Text>
        </VStack>
      ),
    },
    { key: 'channels', header: 'Accounts', width: proportional(2), renderCell: (p) => (
        <VStack gap={1}>
          {p.channels.map((c) => (
            <HStack key={c.account_id} gap={2} vAlign="center">
              <PlatformLogo platform={c.channel} size={16} />
              <Text type="body" maxLines={1}>{c.account_name}</Text>
            </HStack>
          ))}
        </VStack>
      ) },
    { key: 'publish_at', header: 'When', width: pixel(200), renderCell: (p) => (p.publish_at
        ? <VStack gap={0.5}><Text type="body" hasTabularNumbers>{p.publish_at.replace('T', ' ')}</Text><Text type="supporting" color="secondary">{p.timezone}</Text></VStack>
        : <Text type="body">As soon as possible</Text>) },
    { key: 'state', header: 'Status', width: pixel(160), renderCell: (p) => <PublicationBadge value={p.state} /> },
  ];
}

/* ---------- Calendar ---------- */

/**
 * A month to pick a day from, and that day's posts. Times are the wall times
 * the posts were scheduled in, each in its own time zone.
 */
function CalendarView({ pubs, onOpen }: { pubs: Publication[]; onOpen: (p: Publication) => void }) {
  const dated = pubs.filter((p) => p.publish_at).sort((a, b) => a.publish_at!.localeCompare(b.publish_at!));
  const days = [...new Set(dated.map((p) => p.publish_at!.slice(0, 10)))];
  const firstUpcoming = dated.find((p) => p.state === 'SCHEDULED')?.publish_at?.slice(0, 10) ?? days[0];
  const [day, setDay] = useState<string>(firstUpcoming ?? new Date().toISOString().slice(0, 10));
  const onDay = dated.filter((p) => p.publish_at!.startsWith(day));
  const month = day.slice(0, 7);
  const inMonth = days.filter((d) => d.startsWith(month));

  return (
    <Grid columns={{ minWidth: 300 }} gap={6}>
      <VStack gap={3}>
        <Calendar mode="single" value={day as ISODate} focusDate={day as ISODate}
          onChange={(v: ISODate | null) => { if (v) setDay(v); }}
          onFocusDateChange={(f) => { if (f.slice(0, 7) !== month) setDay(f); }} />
        <VStack gap={1} hAlign="start">
          <Text type="label" color="secondary">Days with posts this month</Text>
          {inMonth.length
            ? <HStack gap={2} wrap="wrap">{inMonth.map((d) => (
                <Button key={d} size="sm" variant={d === day ? 'secondary' : 'ghost'} active={d === day} onClick={() => setDay(d)}
                  aria-label={`${d}, ${dated.filter((p) => p.publish_at!.startsWith(d)).length} posts`}>
                  {d.slice(5)} ({dated.filter((p) => p.publish_at!.startsWith(d)).length})
                </Button>
              ))}</HStack>
            : <Text type="body" color="secondary">None.</Text>}
        </VStack>
      </VStack>
      <VStack gap={3}>
        <Heading level={3}>{day}</Heading>
        <div role="status" aria-live="polite">
          {onDay.length
            ? (
              <List hasDividers aria-label={`Posts on ${day}`}>
                {onDay.map((p) => (
                  <ListItem key={p.publication_id} align="start"
                    label={<Link onClick={() => onOpen(p)}>{p.publish_at!.slice(11)} {p.timezone} · {p.creative_id} v{p.creative_version}</Link>}
                    description={(
                      <HStack gap={2} wrap="wrap" vAlign="center">
                        {p.channels.map((c) => <PlatformLogo key={c.account_id} platform={c.channel} size={16} />)}
                        <Text type="supporting" color="secondary">{p.channels.length} {p.channels.length === 1 ? 'account' : 'accounts'}</Text>
                      </HStack>
                    )}
                    endContent={<PublicationBadge value={p.state} />} />
                ))}
              </List>
            )
            : <Text type="body" color="secondary">No posts on this day.</Text>}
        </div>
      </VStack>
    </Grid>
  );
}

/* ---------- Detail ---------- */

function PublicationDrawer({ pub, onClose }: { pub: Publication; onClose: () => void }) {
  const sim = useIsSimulation();
  const { can } = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const cancel = useWorkspaceMutation((id: string) => workspaceApi.cancelPublication(id), ['publications']);
  const manage = can('publication:manage');
  const cancellable = manage && (pub.state === 'SCHEDULED' || pub.state === 'QUEUED');
  const manual = pub.channels.filter((c) => c.state === 'MANUAL');

  /** The hand-off for accounts with no publishing API: the exact caption and what to post where. */
  const downloadHandoff = () => {
    const text = [
      `Post ${pub.creative_id}, approved version ${pub.creative_version}`,
      `When: ${wallTime(pub)}`,
      '',
      ...manual.map((c) => `${PLATFORM_NAME[c.channel]} · ${c.account_name} · ${c.format}`),
      '',
      'Caption, exactly as approved:',
      pub.caption,
      '',
      'Post this by hand. Marketing cannot confirm it was posted, so it never shows as published.',
    ].join('\r\n');
    saveFile(`post-by-hand-${pub.publication_id}.txt`, new Blob([text], { type: 'text/plain' }));
  };

  return (
    <Drawer open onClose={onClose} title={`${pub.creative_id} · version ${pub.creative_version}`} subtitle={pub.study_title} badge={<PublicationBadge value={pub.state} />}
      footer={cancellable ? (
        <HStack gap={2} wrap="wrap">
          {pub.state === 'SCHEDULED' && <Button variant="secondary" icon="cal" onClick={() => setMoving(true)}>Reschedule</Button>}
          <Button variant="danger" onClick={() => setConfirm(true)}>Cancel this post</Button>
        </HStack>
      ) : undefined}>
      <VStack gap={5}>
        {pub.state === 'UNKNOWN' && (
          <Alert tone="waiting" title="Result not confirmed">
            The network did not confirm whether this was posted. Check the page itself before doing anything; trying again could post it twice.
          </Alert>
        )}
        {pub.state_reason && pub.state !== 'UNKNOWN' && <Alert tone={pub.state === 'FAILED' || pub.state === 'PARTIAL' ? 'blocked' : 'info'} title={pub.state_reason} />}
        {manual.length > 0 && (
          <Alert tone="info" title="Some accounts are posted by hand"
            action={<Button size="sm" variant="secondary" icon="dl" onClick={downloadHandoff}>Download for posting by hand</Button>}>
            {manual.map((c) => c.account_name).join(', ')} {manual.length === 1 ? 'has' : 'have'} no publishing API. Post it yourself; Marketing cannot confirm it, so it is never marked published.
          </Alert>
        )}
        <MetadataList>
          <MetadataListItem label="When">{wallTime(pub)}</MetadataListItem>
          <MetadataListItem label="Scheduled by">{pub.created_by} · {fmtDateTime(pub.created_at)}</MetadataListItem>
          <MetadataListItem label="Draft"><Link href={`/marketing/create/${encodeURIComponent(pub.creative_id)}`}>{pub.creative_id}</Link></MetadataListItem>
        </MetadataList>
        <Divider />
        <VStack gap={2}>
          <Heading level={3}>Result per account</Heading>
          <List hasDividers aria-label="Result per account">
            {pub.channels.map((c) => (
              <ListItem key={c.account_id} label={c.account_name} align="start"
                startContent={<PlatformLogo platform={c.channel} decorative />}
                description={(
                  <VStack gap={0.5}>
                    <Text type="supporting" color="secondary">{PLATFORM_NAME[c.channel]} · {c.format}</Text>
                    {c.error && <Text type="supporting" wordBreak="break-word">{c.error}</Text>}
                    {c.permalink && <Link href={c.permalink} target="_blank">{sim ? 'View post (simulation link)' : 'View post'}</Link>}
                  </VStack>
                )}
                endContent={<PublicationBadge value={c.state} />} />
            ))}
          </List>
          {pub.state === 'PARTIAL' && <Text type="supporting" color="secondary">Only the failed account would be retried. Accounts that posted are never posted to again.</Text>}
        </VStack>
        <Divider />
        <VStack gap={2}>
          <Heading level={3}>Caption</Heading>
          <Text type="body" wordBreak="break-word">{pub.caption}</Text>
        </VStack>
      </VStack>
      <AlertDialog isOpen={confirm} onOpenChange={setConfirm} title="Cancel this post?"
        description="It has not been sent yet. Cancelling stops it; you can schedule the approved version again later."
        actionLabel="Cancel post" cancelLabel="Keep it scheduled" isActionLoading={cancel.isPending}
        onAction={async () => {
          try {
            await cancel.mutateAsync([pub.publication_id]);
            setConfirm(false);
            toast('Post cancelled', 'done', 'Nothing was sent.');
          } catch (e) {
            setConfirm(false);
            toast(isApiError(e) ? e.message : 'The post could not be cancelled', 'blocked');
          }
        }} />
      {moving && <RescheduleDialog pub={pub} onClose={() => setMoving(false)} />}
    </Drawer>
  );
}

function RescheduleDialog({ pub, onClose }: { pub: Publication; onClose: () => void }) {
  const now = useNow();
  const { toast } = useToast();
  const [publishAt, setPublishAt] = useState<ISODateTimeString | undefined>(pub.publish_at as ISODateTimeString | undefined);
  const [timezone, setTimezone] = useState(pub.timezone);
  const [error, setError] = useState('');
  const move = useWorkspaceMutation((at: string, tz: string) => workspaceApi.reschedule(pub.publication_id, at, tz), ['publications']);

  const submit = async () => {
    if (!publishAt) { setError('Choose a date and time.'); return; }
    try {
      const p = await move.mutateAsync([publishAt, timezone]);
      toast('Post rescheduled', 'done', wallTime(p));
      onClose();
    } catch (e) {
      setError(fieldMessagesOf(e).publish_at ?? (isApiError(e) ? e.message : 'The post could not be moved.'));
    }
  };

  return (
    <Modal open onClose={onClose} title="Reschedule" size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={move.isPending} onClick={() => void submit()}>Move the post</Button>
        </>
      )}>
      <VStack gap={4}>
        <DateTimeInput label="New date and time" isRequired value={publishAt}
          min={new Date(now + 5 * 60_000).toISOString().slice(0, 16) as ISODateTimeString}
          status={error ? { type: 'error', message: error } : undefined}
          onChange={(v) => { setPublishAt(v); setError(''); }} description="In the time zone you choose. Daylight-saving changes are handled by the time zone." />
        <Selector label="Time zone" value={timezone} onChange={(v) => v && setTimezone(v)} options={TIMEZONES} width="100%" hasSearch />
        <Text type="supporting" color="secondary">The same approved version is sent to the same accounts. Nothing is sent twice.</Text>
      </VStack>
    </Modal>
  );
}

/* ---------- Schedule ---------- */

type Settings = Omit<PublicationTarget, 'account_id'>;

/** Formats that carry the approved post's picture. Approved posts are image posts; video-only formats cannot take one. */
const IMAGE_FORMATS = ['Feed image', 'Carousel', 'Pin', 'Story'];
const formatsFor = (a: SocialAccount): string[] => a.formats.filter((f) => IMAGE_FORMATS.includes(f));

/** Why this account cannot take the post as approved, or null when it can. */
function blockOf(a: SocialAccount, caption: string, s: Settings | undefined): string | null {
  if (a.state !== 'CONNECTED' && a.state !== 'TEST_ONLY') return a.state_reason ?? 'Reconnect it first.';
  if (!a.formats.length) return 'It cannot post anything until it is fixed.';
  if (!formatsFor(a).length) return `${PLATFORM_NAME[a.channel]} here takes ${a.formats.join(', ')} only, and this post is an image. Make a video version of the post for it.`;
  if (a.caption_max != null && charCount(caption) > a.caption_max) {
    return `The caption is ${charCount(caption)} characters; this account takes ${a.caption_max}. Shorten it in the draft and have it approved again.`;
  }
  if (!s) return null;
  if (a.required_fields.includes('title') && !s.title?.trim()) return 'Add a title.';
  if (a.required_fields.includes('privacy') && !s.privacy) return 'Choose who can see it.';
  if (a.required_fields.includes('ai_disclosure') && s.ai_disclosure == null) return 'Say whether it was made with AI.';
  return null;
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const now = useNow();
  const { toast } = useToast();
  const sim = useIsSimulation();
  const approvals = useApprovals();
  const accounts = useAccounts();
  const sets = useSocialSets();
  const approved = (approvals.data ?? []).filter((a) => a.state === 'APPROVED');
  const [versionKey, setVersionKey] = useState('');
  const [setId, setSetId] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, Settings>>({});
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [publishAt, setPublishAt] = useState<ISODateTimeString | undefined>();
  const [timezone, setTimezone] = useState(defaultZone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schedule = useWorkspaceMutation((body: PublicationRequest) => workspaceApi.schedule(body), ['publications']);
  const chosen = approved.find((a) => `${a.creative_id}|${a.creative_version}` === versionKey);
  const caption = chosen?.caption ?? '';
  const inSet = (accounts.data ?? []).filter((a) => a.social_set_id === setId);
  const selected = inSet.filter((a) => accountIds.includes(a.account_id));
  const settingsOf = (a: SocialAccount): Settings => settings[a.account_id] ?? { format: formatsFor(a)[0] ?? '' };
  const patch = (id: string, p: Partial<Settings>, a: SocialAccount) => setSettings((s) => ({ ...s, [id]: { ...settingsOf(a), ...s[id], ...p } }));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!chosen) e.version = 'Choose an approved version.';
    if (!setId) e.social_set = 'Choose a social set.';
    else if (!selected.length) e.targets = 'Choose at least one account.';
    else if (selected.some((a) => blockOf(a, caption, settingsOf(a)))) e.targets = 'Fix the accounts marked below, or leave them out.';
    if (when === 'later' && !publishAt) e.publish_at = 'Choose a date and time.';
    setErrors(e);
    if (Object.keys(e).length || !chosen) return;
    try {
      const pub = await schedule.mutateAsync([{
        creative_id: chosen.creative_id, creative_version: chosen.creative_version,
        targets: selected.map((a) => ({ account_id: a.account_id, ...settingsOf(a) })),
        publish_at: when === 'later' ? publishAt! : null, timezone,
      }]);
      const manual = pub.channels.filter((c) => c.state === 'MANUAL').length;
      toast(pub.state === 'SCHEDULED' ? 'Post scheduled' : 'Post queued', 'done',
        `${pub.state === 'SCHEDULED' ? `${wallTime(pub)}.` : 'It is sent next; check its result here.'}${manual ? ` ${manual} posted by hand: download it from the post.` : ''}${sim ? ' Simulation: nothing is sent.' : ''}`);
      onClose();
    } catch (err) {
      const f = fieldMessagesOf(err);
      if (Object.keys(f).length) setErrors(f);
      else toast(isApiError(err) ? err.message : 'The post could not be scheduled', 'blocked');
    }
  };

  return (
    <Modal open onClose={onClose} title="Schedule a post" size="xl"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={schedule.isPending} onClick={() => void submit()}>{when === 'now' ? 'Queue post' : 'Schedule post'}</Button>
        </>
      )}>
      <VStack gap={5}>
        <Selector label="Approved version" isRequired width="100%" value={versionKey || undefined} placeholder="Choose an approved post"
          isLoading={approvals.isPending}
          options={approved.map((a) => ({ value: `${a.creative_id}|${a.creative_version}`, label: `${a.creative_id} · version ${a.creative_version}`, description: a.caption.slice(0, 80) }))}
          emptyText="No approved versions yet. A reviewer must approve a post first."
          onChange={(v) => { setVersionKey(v ?? ''); setErrors((x) => ({ ...x, version: '' })); }}
          status={errors.version ? { type: 'error', message: errors.version } : undefined} statusVariant="detached" />

        <Selector label="Social set" isRequired width="100%" value={setId || undefined} placeholder="Choose a brand or region"
          isLoading={sets.isPending}
          options={(sets.data ?? []).map((s) => ({ value: s.social_set_id, label: s.name, description: s.region }))}
          onChange={(v) => { setSetId(v ?? ''); setAccountIds([]); setErrors((x) => ({ ...x, social_set: '' })); }}
          status={errors.social_set ? { type: 'error', message: errors.social_set } : undefined} statusVariant="detached" />

        {setId && (
          <QueryState query={accounts} what="connected accounts">
            {() => (
              <CheckboxList label="Accounts" isRequired value={accountIds} onChange={(v) => { setAccountIds(v); setErrors((x) => ({ ...x, targets: '' })); }}
                status={errors.targets ? { type: 'error', message: errors.targets } : undefined}
                description="Accounts that cannot take this post say why." hasDividers>
                {inSet.map((a) => {
                  const usable = (a.state === 'CONNECTED' || a.state === 'TEST_ONLY') && a.formats.length > 0;
                  return (
                    <CheckboxListItem key={a.account_id} value={a.account_id} isDisabled={!usable}
                      label={<HStack gap={2} vAlign="center"><PlatformLogo platform={a.channel} size={16} decorative />{a.name}</HStack>}
                      description={usable
                        ? `${PLATFORM_NAME[a.channel]} · ${a.formats.join(', ')}${a.publish_mode === 'MANUAL' ? ' · posted by hand' : ''}`
                        : a.state_reason ?? 'Cannot publish'}
                      endContent={<AccountBadge value={a.state} />} />
                  );
                })}
              </CheckboxList>
            )}
          </QueryState>
        )}

        {selected.length > 0 && (
          <VStack gap={3}>
            <Heading level={3}>What each account receives</Heading>
            <Text type="supporting" color="secondary">
              Every account gets the approved caption unchanged. Changing the caption or the picture means a new version that must be checked and approved again.
            </Text>
            {selected.map((a) => {
              const s = settingsOf(a);
              const block = chosen ? blockOf(a, caption, s) : null;
              return (
                <AxCard key={a.account_id} padding={4} aria-label={`What ${a.name} receives`}>
                  <VStack gap={3}>
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <PlatformLogo platform={a.channel} size={20} decorative />
                      <Text type="body" weight="semibold">{a.name}</Text>
                      <Text type="supporting" color="secondary">{PLATFORM_NAME[a.channel]}</Text>
                      {block ? <Badge variant="blocked">Cannot send</Badge> : <Badge variant="done">Ready</Badge>}
                    </HStack>
                    {block && <Alert tone="blocked" title={block} />}
                    {a.publish_mode === 'MANUAL' && (
                      <Text type="supporting" color="secondary">No publishing API: after scheduling, download the post and post it by hand. It shows as "Post by hand", never as published.</Text>
                    )}
                    <Grid columns={{ minWidth: 200 }} gap={3}>
                      <Selector label="Format" width="100%" value={s.format || undefined} placeholder="No image format" options={formatsFor(a)} onChange={(v) => v && patch(a.account_id, { format: v }, a)} />
                      {a.required_fields.includes('title') && (
                        <TextInput label="Title" isRequired width="100%" value={s.title ?? ''} onChange={(v) => patch(a.account_id, { title: v }, a)} />
                      )}
                      {a.required_fields.includes('privacy') && (
                        <Selector label="Who can see it" isRequired width="100%" value={s.privacy} placeholder="Choose"
                          options={[{ value: 'public', label: 'Everyone' }, { value: 'followers', label: 'Followers only' }, { value: 'private', label: 'Only the account' }]}
                          onChange={(v) => patch(a.account_id, { privacy: v as Settings['privacy'] }, a)} />
                      )}
                    </Grid>
                    {a.required_fields.includes('ai_disclosure') && (
                      <RadioList label="Was the picture or video made with AI?" isRequired orientation="horizontal"
                        value={s.ai_disclosure == null ? '' : s.ai_disclosure ? 'yes' : 'no'}
                        description={`${PLATFORM_NAME[a.channel]} labels AI-made content when you say yes.`}
                        onChange={(v) => patch(a.account_id, { ai_disclosure: v === 'yes' }, a)}>
                        <RadioListItem value="yes" label="Yes" />
                        <RadioListItem value="no" label="No" />
                      </RadioList>
                    )}
                    {chosen && (
                      <Text type="supporting" color="secondary">
                        Caption {charCount(caption)}{a.caption_max != null ? ` of ${a.caption_max}` : ''} characters · {s.format || 'no format'}
                      </Text>
                    )}
                  </VStack>
                </AxCard>
              );
            })}
            <Text type="supporting" color="secondary">Required: {[...new Set(selected.flatMap((a) => a.required_fields))].map((f) => FIELD_LABEL[f]).join(', ') || 'nothing extra'}.</Text>
          </VStack>
        )}

        <RadioList label="When" value={when} onChange={(v) => setWhen(v as 'now' | 'later')} orientation="horizontal">
          <RadioListItem value="later" label="At a set time" />
          <RadioListItem value="now" label="As soon as possible" />
        </RadioList>
        {when === 'later' && (
          <Grid columns={{ minWidth: 220 }} gap={4}>
            <DateTimeInput label="Date and time" isRequired value={publishAt}
              status={errors.publish_at ? { type: 'error', message: errors.publish_at } : undefined} onChange={(v) => { setPublishAt(v); setErrors((x) => ({ ...x, publish_at: '' })); }}
              min={new Date(now + 5 * 60_000).toISOString().slice(0, 16) as ISODateTimeString}
              description="In the time zone you choose. Daylight-saving changes are handled by the time zone." />
            <Selector label="Time zone" value={timezone} onChange={(v) => v && setTimezone(v)} options={TIMEZONES} width="100%" hasSearch />
          </Grid>
        )}
        {chosen && <Text type="supporting" color="secondary">Approved by {chosen.decided_by} {chosen.decided_at ? relTime(chosen.decided_at, now) : ''}. If the draft changes, this schedule stops before sending.</Text>}
      </VStack>
    </Modal>
  );
}
