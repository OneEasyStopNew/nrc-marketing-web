import { useMemo, useState, type ReactElement } from 'react';
import { useNow } from '@/lib/useNow';
import { PlatformLogo } from '@/components/ui/PlatformLogo';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type Publication, type PublicationRequest } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useAccounts, useApprovals, usePublications, useWorkspaceMutation } from '@/pages/shared/queries';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { AccountBadge, InDevelopment, PublicationBadge, QueryState, relTime, useIsSimulation } from '@/pages/shared/ui';

type View = 'upcoming' | 'attention' | 'history';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'UTC'];
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };

/**
 * Publications: what is scheduled, what needs attention, and what was sent,
 * with each channel's own result. Simulation never marks anything as live:
 * "publish now" stays queued and nothing reaches Facebook or Instagram.
 */
export default function PublicationsPage(): ReactElement {
  const { can } = useAuth();
  const sim = useIsSimulation();
  // Not fetched while publishing is in development: the backend has no /publications yet.
  const pubs = usePublications(!IN_DEVELOPMENT.publications);
  const [view, setView] = useState<View>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const all = pubs.data ?? [];
  const groups: Record<View, Publication[]> = {
    upcoming: all.filter((p) => p.state === 'SCHEDULED' || p.state === 'QUEUED' || p.state === 'PROCESSING').sort((a, b) => (a.publish_at ?? '').localeCompare(b.publish_at ?? '')),
    attention: all.filter((p) => ['FAILED', 'PARTIAL', 'UNKNOWN', 'BLOCKED'].includes(p.state)),
    history: all.filter((p) => p.state === 'PUBLISHED' || p.state === 'CANCELLED'),
  };
  const columns = useMemo(() => publicationColumns((p) => setOpenId(p.publication_id)), []);
  const open = all.find((p) => p.publication_id === openId);

  // NRC-24: scheduling and publishing are outside the current demo (config/inDevelopment.ts).
  if (IN_DEVELOPMENT.publications) {
    return (
      <VStack gap={8}>
        <PageHeader title="Publications" description="Schedule approved posts and follow each channel's result." />
        <InDevelopment feature="Publishing" description="Scheduling approved posts and following each channel's result is being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Publications" description="Schedule approved posts and follow each channel's result."
        actions={can('publication:manage') ? <Button variant="primary" icon="cal" onClick={() => setScheduling(true)}>Schedule a post</Button> : undefined} />
      {sim && <Alert tone="info" title="Simulation">Nothing here is sent to Facebook or Instagram. Results shown as published are dummy history.</Alert>}
      <VStack gap={4}>
        <Tabs<View> value={view} onChange={setView} tabs={[
          { id: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
          { id: 'attention', label: 'Needs attention', count: groups.attention.length, attention: groups.attention.length > 0 },
          { id: 'history', label: 'History', count: groups.history.length },
        ]} />
        <QueryState query={pubs} what="publications">
          {() => groups[view].length
            ? <Table<Publication> data={groups[view]} columns={columns} idKey="publication_id" density="balanced" dividers="rows" hasHover />
            : <EmptyState icon={view === 'attention' ? 'check' : 'cal'} title={view === 'upcoming' ? 'Nothing scheduled' : view === 'attention' ? 'All results confirmed' : 'No history yet'} />}
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

/* ---------- Detail ---------- */

function PublicationDrawer({ pub, onClose }: { pub: Publication; onClose: () => void }) {
  const sim = useIsSimulation();
  const { can } = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const cancel = useWorkspaceMutation((id: string) => workspaceApi.cancelPublication(id), ['publications']);
  const cancellable = can('publication:manage') && (pub.state === 'SCHEDULED' || pub.state === 'QUEUED');

  return (
    <Drawer open onClose={onClose} title={`${pub.creative_id} · version ${pub.creative_version}`} subtitle={pub.study_title} badge={<PublicationBadge value={pub.state} />}
      footer={cancellable ? <Button variant="danger" onClick={() => setConfirm(true)}>Cancel this post</Button> : undefined}>
      <VStack gap={5}>
        {pub.state === 'UNKNOWN' && (
          <Alert tone="waiting" title="Result not confirmed">
            The provider did not confirm whether this was posted. Check the page itself before doing anything; trying again could post it twice.
          </Alert>
        )}
        {pub.state_reason && pub.state !== 'UNKNOWN' && <Alert tone={pub.state === 'FAILED' || pub.state === 'PARTIAL' ? 'blocked' : 'info'} title={pub.state_reason} />}
        <MetadataList>
          <MetadataListItem label="When">{pub.publish_at ? `${pub.publish_at.replace('T', ' ')} (${pub.timezone})` : 'As soon as possible'}</MetadataListItem>
          <MetadataListItem label="Scheduled by">{pub.created_by} · {fmtDateTime(pub.created_at)}</MetadataListItem>
          <MetadataListItem label="Draft"><Link href={`/marketing/create/${encodeURIComponent(pub.creative_id)}`}>{pub.creative_id}</Link></MetadataListItem>
        </MetadataList>
        <Divider />
        <VStack gap={2}>
          <Heading level={3}>Result per account</Heading>
          <List hasDividers>
            {pub.channels.map((c) => (
              <ListItem key={c.account_id} label={c.account_name} align="start"
                startContent={<PlatformLogo platform={c.channel} decorative />}
                description={(
                  <VStack gap={0.5}>
                    <Text type="supporting" color="secondary">{c.channel === 'facebook' ? 'Facebook' : 'Instagram'}</Text>
                    {c.error && <Text type="supporting">{c.error}</Text>}
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
    </Drawer>
  );
}

/* ---------- Schedule ---------- */

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const now = useNow();
  const { toast } = useToast();
  const sim = useIsSimulation();
  const approvals = useApprovals();
  const accounts = useAccounts();
  const approved = (approvals.data ?? []).filter((a) => a.state === 'APPROVED');
  const [versionKey, setVersionKey] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [publishAt, setPublishAt] = useState<ISODateTimeString | undefined>();
  const [timezone, setTimezone] = useState(TIMEZONES.includes(localZone()) ? localZone() : 'America/New_York');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schedule = useWorkspaceMutation((body: PublicationRequest) => workspaceApi.schedule(body), ['publications']);
  const chosen = approved.find((a) => `${a.creative_id}|${a.creative_version}` === versionKey);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!chosen) e.version = 'Choose an approved version.';
    if (!accountIds.length) e.account_ids = 'Choose at least one account.';
    if (when === 'later' && !publishAt) e.publish_at = 'Choose a date and time.';
    setErrors(e);
    if (Object.keys(e).length || !chosen) return;
    try {
      const pub = await schedule.mutateAsync([{
        creative_id: chosen.creative_id, creative_version: chosen.creative_version, account_ids: accountIds,
        publish_at: when === 'later' ? publishAt! : null, timezone,
      }]);
      toast(pub.state === 'SCHEDULED' ? 'Post scheduled' : 'Post queued', 'done',
        `${pub.state === 'SCHEDULED' ? `${pub.publish_at?.replace('T', ' ')} ${pub.timezone}.` : 'It is sent next; check its result here.'}${sim ? ' Simulation: nothing is sent to Facebook or Instagram.' : ''}`);
      onClose();
    } catch (err) {
      const f = fieldMessagesOf(err);
      if (Object.keys(f).length) setErrors(f);
      else toast(isApiError(err) ? err.message : 'The post could not be scheduled', 'blocked');
    }
  };

  return (
    <Modal open onClose={onClose} title="Schedule a post" size="lg"
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

        <QueryState query={accounts} what="connected accounts">
          {(list) => (
            <CheckboxList label="Accounts" isRequired value={accountIds} onChange={(v) => { setAccountIds(v); setErrors((x) => ({ ...x, account_ids: '' })); }}
              status={errors.account_ids ? { type: 'error', message: errors.account_ids } : undefined}
              description="Only accounts that can publish are selectable." hasDividers>
              {list.map((a) => {
                const usable = a.state === 'CONNECTED' || a.state === 'TEST_ONLY';
                return (
                  <CheckboxListItem key={a.account_id} value={a.account_id} isDisabled={!usable}
                    label={<HStack gap={2} vAlign="center"><PlatformLogo platform={a.channel} size={16} decorative />{a.name}</HStack>} description={usable ? `${a.channel === 'facebook' ? 'Facebook' : 'Instagram'} · ${a.formats.join(', ')}` : a.state_reason ?? 'Cannot publish'}
                    endContent={<AccountBadge value={a.state} />} />
                );
              })}
            </CheckboxList>
          )}
        </QueryState>

        <RadioList label="When" value={when} onChange={(v) => setWhen(v as 'now' | 'later')} orientation="horizontal">
          <RadioListItem value="later" label="At a set time" />
          <RadioListItem value="now" label="As soon as possible" />
        </RadioList>
        {when === 'later' && (
          <Grid columns={{ minWidth: 220 }} gap={4}>
            <DateTimeInput label="Date and time" isRequired value={publishAt}
              status={errors.publish_at ? { type: 'error', message: errors.publish_at } : undefined} onChange={(v) => { setPublishAt(v); setErrors((x) => ({ ...x, publish_at: '' })); }}
              min={new Date(now + 5 * 60_000).toISOString().slice(0, 16) as ISODateTimeString}
              description="In the time zone you choose." />
            <Selector label="Time zone" value={timezone} onChange={(v) => v && setTimezone(v)} options={TIMEZONES} width="100%" hasSearch />
          </Grid>
        )}
        {chosen && <Text type="supporting" color="secondary">Approved by {chosen.decided_by} {chosen.decided_at ? relTime(chosen.decided_at, now) : ''}. If the draft changes, this schedule stops before sending.</Text>}
      </VStack>
    </Modal>
  );
}
