import { useState, type ReactElement } from 'react';
import { PLATFORM_NAME, PlatformLogo } from '@/components/ui/PlatformLogo';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { SocialChannel, workspaceApi, type RequiredField, type SocialAccount, type SocialSet } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Alert, EmptyState, PageHeader } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useAccounts, useSocialSets, useWorkspaceMutation } from '@/pages/shared/queries';
import { AccountBadge, InDevelopment, QueryState, SectionTitle, useIsSimulation, useInDevelopment } from '@/pages/shared/ui';

export const FIELD_LABEL: Record<RequiredField, string> = { title: 'Title', privacy: 'Privacy setting', ai_disclosure: 'AI-content answer' };

/**
 * Connected accounts (NRC-24, eight networks NRC-39): the accounts Marketing
 * may post to, grouped by social set (a brand or region), with what each
 * account can do and what needs fixing. Tokens never reach the browser;
 * connecting goes through the backend's sign-in flow (simulated here).
 */
export default function AccountsPage(): ReactElement {
  const accountsInDev = useInDevelopment('accounts');
  const { can } = useAuth();
  // Not fetched while connected accounts are in development: the backend has no /accounts yet.
  const accounts = useAccounts(!accountsInDev);
  const sets = useSocialSets(!accountsInDev);
  const [connecting, setConnecting] = useState<string | null>(null);
  const manage = can('publication:manage');

  if (accountsInDev) {
    return (
      <VStack gap={8}>
        <PageHeader title="Connected accounts" description="The pages and profiles Marketing may post to. Access tokens stay on the server." />
        <InDevelopment feature="Connected accounts" description="Connecting social accounts is being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Connected accounts" description="The pages and profiles Marketing may post to, by social set. Access tokens stay on the server."
        actions={manage ? <Button variant="primary" icon="plus" onClick={() => setConnecting('')}>Connect an account</Button> : undefined} />
      <QueryState query={sets} what="social sets"
        empty={<EmptyState icon="globe" title="No social sets" description="An administrator creates a social set (a brand or region) before accounts are connected." />}>
        {(list) => (
          <VStack gap={10}>
            {list.map((s) => (
              <SetSection key={s.social_set_id} set={s} accounts={(accounts.data ?? []).filter((a) => a.social_set_id === s.social_set_id)}
                loading={accounts.isPending} manage={manage} onConnect={() => setConnecting(s.social_set_id)} />
            ))}
          </VStack>
        )}
      </QueryState>
      {connecting != null && sets.data && <ConnectDialog sets={sets.data} initialSet={connecting} onClose={() => setConnecting(null)} />}
    </VStack>
  );
}

function SetSection({ set: s, accounts, loading, manage, onConnect }: {
  set: SocialSet; accounts: SocialAccount[]; loading: boolean; manage: boolean; onConnect: () => void;
}) {
  const full = s.account_count >= s.account_limit;
  const over = s.account_count > s.account_limit;
  return (
    <section aria-label={s.name}>
      <VStack gap={4}>
        <SectionTitle title={s.name}
          description={`${s.region} · ${s.account_count} of ${s.account_limit} accounts · used by ${s.access_groups.join(', ') || 'nobody yet'}`}
          actions={manage && !full ? <Button variant="secondary" size="sm" icon="plus" onClick={onConnect}>Connect to this set</Button> : undefined} />
        {over && (
          <Alert tone="waiting" title="Over the account limit">
            This set holds {s.account_count} accounts and its limit is {s.account_limit}. Nothing was removed and history is kept, but no account can be added until one is disconnected or an administrator raises the limit.
          </Alert>
        )}
        {full && !over && <Text type="supporting" color="secondary">This set is at its limit. Disconnect an account, or ask an administrator to raise the limit, to add another.</Text>}
        {loading ? null : accounts.length
          ? <Grid columns={{ minWidth: 300, repeat: 'fill' }} gap={4}>{accounts.map((a) => <AccountCard key={a.account_id} account={a} manage={manage} />)}</Grid>
          : <EmptyState icon="globe" title="No accounts in this set" description="Connect an account to post to it." />}
      </VStack>
    </section>
  );
}

function AccountCard({ account: a, manage }: { account: SocialAccount; manage: boolean }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const [confirm, setConfirm] = useState(false);
  const reconnect = useWorkspaceMutation((id: string) => workspaceApi.reconnectAccount(id), ['accounts', 'social-sets']);
  const disconnect = useWorkspaceMutation((id: string) => workspaceApi.disconnectAccount(id), ['accounts', 'social-sets']);
  const healthy = a.state === 'CONNECTED' || a.state === 'TEST_ONLY';

  return (
    <Card aria-label={`${a.name}, ${PLATFORM_NAME[a.channel]}`}>
      <CardHead title={a.name} lead={<PlatformLogo platform={a.channel} size={24} />} badge={<AccountBadge value={a.state} />} />
      <CardBody>
        {a.state_reason && <Alert tone={healthy ? 'info' : 'blocked'} title={a.state_reason} />}
        <MetadataList>
          <MetadataListItem label="Network">{PLATFORM_NAME[a.channel]}</MetadataListItem>
          <MetadataListItem label="Handle">{a.handle}</MetadataListItem>
          <MetadataListItem label="Posting">{a.publish_mode === 'MANUAL' ? 'By hand: no publishing API' : 'Sent by Marketing'}</MetadataListItem>
          <MetadataListItem label="Can post">{a.formats.length ? a.formats.join(', ') : 'Nothing until fixed'}</MetadataListItem>
          <MetadataListItem label="Caption limit">{a.caption_max != null ? `${a.caption_max} characters` : 'No caption'}</MetadataListItem>
          {a.required_fields.length > 0 && <MetadataListItem label="Needs with each post">{a.required_fields.map((f) => FIELD_LABEL[f]).join(', ')}</MetadataListItem>}
          <MetadataListItem label="Permissions">{a.permissions.length ? a.permissions.join(', ') : 'None granted'}</MetadataListItem>
          <MetadataListItem label="Connected">{a.connected_by} · {fmtDateTime(a.connected_at)}</MetadataListItem>
          <MetadataListItem label="Access expires">{a.expires_at ? fmtDateTime(a.expires_at) : '—'}</MetadataListItem>
        </MetadataList>
      </CardBody>
      {manage && (
        <CardFoot>
          {!healthy && (
            <Button variant="secondary" size="sm" icon="refresh" loading={reconnect.isPending}
              onClick={() => {
                void (async () => {
                  try { await reconnect.mutateAsync([a.account_id]); toast(`${a.name} reconnected`, 'done', sim ? `Simulation: no real sign-in to ${PLATFORM_NAME[a.channel]} happened.` : undefined); }
                  catch (e) { toast(isApiError(e) ? e.message : 'Could not reconnect', 'blocked'); }
                })();
              }}>Reconnect</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>Disconnect</Button>
        </CardFoot>
      )}
      <AlertDialog isOpen={confirm} onOpenChange={setConfirm} title={`Disconnect ${a.name}?`}
        description="Marketing will no longer be able to post to it. Posts already live stay live and history is kept; scheduled posts must be cancelled first."
        actionLabel="Disconnect" isActionLoading={disconnect.isPending}
        onAction={async () => {
          try { await disconnect.mutateAsync([a.account_id]); setConfirm(false); toast(`${a.name} disconnected`, 'done'); }
          catch (e) { setConfirm(false); toast(isApiError(e) ? e.message : 'Could not disconnect', 'blocked'); }
        }} />
    </Card>
  );
}

const CHANNEL_HINT: Record<SocialChannel, string> = {
  facebook: 'A Facebook page.', instagram: 'An Instagram professional profile. Text-only posts are not possible.',
  threads: 'A Threads profile linked to Instagram.', tiktok: 'A TikTok business account. Videos only.',
  linkedin: 'A LinkedIn company page.', youtube: 'A YouTube channel. Videos and Shorts.',
  pinterest: 'A Pinterest business account. Pins.', snapchat: 'A Snapchat public profile.',
};

function ConnectDialog({ sets, initialSet, onClose }: { sets: SocialSet[]; initialSet: string; onClose: () => void }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const open = sets.filter((s) => s.account_count < s.account_limit);
  const [setId, setSetId] = useState(open.some((s) => s.social_set_id === initialSet) ? initialSet : open[0]?.social_set_id ?? '');
  const [channel, setChannel] = useState<SocialChannel>('facebook');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const connect = useWorkspaceMutation((c: SocialChannel, n: string, s: string) => workspaceApi.connectAccount(c, n, s), ['accounts', 'social-sets']);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!setId) e.social_set_id = 'Choose a social set.';
    if (!name.trim()) e.name = 'Name the page or profile.';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const acc = await connect.mutateAsync([channel, name.trim(), setId]);
      toast(`${acc.name} connected`, 'done', sim ? 'Test only in simulation: nothing can be posted for real.' : undefined);
      onClose();
    } catch (err) {
      const f = fieldMessagesOf(err);
      if (Object.keys(f).length) setErrors(f);
      else setErrors({ name: isApiError(err) ? err.message : 'Could not connect' });
    }
  };

  return (
    <Modal open onClose={onClose} title="Connect an account" size="lg"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={connect.isPending} disabled={!open.length} onClick={() => void submit()}>Continue to sign in</Button>
        </>
      )}>
      <VStack gap={5}>
        {!open.length && <Alert tone="waiting" title="Every social set is at its limit">Disconnect an account, or ask an administrator to raise a limit, before connecting another.</Alert>}
        <Selector label="Social set" isRequired width="100%" value={setId || undefined} placeholder="Choose a social set"
          options={open.map((s) => ({ value: s.social_set_id, label: s.name, description: `${s.account_count} of ${s.account_limit} accounts` }))}
          onChange={(v) => setSetId(v ?? '')}
          status={errors.social_set_id ? { type: 'error', message: errors.social_set_id } : undefined} statusVariant="detached" />
        <RadioList label="Network" value={channel} onChange={(v) => setChannel(v as SocialChannel)}>
          {SocialChannel.options.map((c) => (
            <RadioListItem key={c} value={c} label={PLATFORM_NAME[c]} description={CHANNEL_HINT[c]} startContent={<PlatformLogo platform={c} decorative />} />
          ))}
        </RadioList>
        <TextInput label="Page or profile name" value={name} onChange={(v) => { setName(v); setErrors((x) => ({ ...x, name: '' })); }} isRequired width="100%"
          placeholder="For example, NRC Research" status={errors.name ? { type: 'error', message: errors.name } : undefined} statusVariant="detached" />
        <Text type="supporting" color="secondary">
          You sign in to {PLATFORM_NAME[channel]} and choose the account. Marketing never sees your password or the access token. What the account can post is read from the network after sign-in.
          {sim ? ' In simulation the account is connected as test only.' : ''}
        </Text>
      </VStack>
    </Modal>
  );
}
