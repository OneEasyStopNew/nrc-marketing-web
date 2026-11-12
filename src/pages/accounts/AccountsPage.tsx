import { useState, type ReactElement } from 'react';
import { PlatformLogo } from '@/components/ui/PlatformLogo';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type SocialAccount } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Alert, EmptyState, PageHeader } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useAccounts, useWorkspaceMutation } from '@/pages/shared/queries';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { AccountBadge, InDevelopment, QueryState, useIsSimulation } from '@/pages/shared/ui';

/**
 * Connected accounts: the Facebook pages and Instagram profiles Marketing may
 * post to, with what each can do and what needs fixing. Tokens never reach
 * the browser; connecting goes through the backend's OAuth flow (simulated here).
 */
export default function AccountsPage(): ReactElement {
  const { can } = useAuth();
  const accounts = useAccounts();
  const [connecting, setConnecting] = useState(false);
  const manage = can('publication:manage');

  // NRC-24: connecting social accounts is outside the current demo (config/inDevelopment.ts).
  if (IN_DEVELOPMENT.accounts) {
    return (
      <VStack gap={8}>
        <PageHeader title="Connected accounts" description="The pages and profiles Marketing may post to. Access tokens stay on the server." />
        <InDevelopment feature="Connected accounts" description="Connecting Facebook and Instagram accounts is being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Connected accounts" description="The pages and profiles Marketing may post to. Access tokens stay on the server."
        actions={manage ? <Button variant="primary" icon="plus" onClick={() => setConnecting(true)}>Connect an account</Button> : undefined} />
      <QueryState query={accounts} what="connected accounts"
        empty={<EmptyState icon="globe" title="No accounts connected" description="Connect a Facebook page or Instagram profile to publish approved posts."
          action={manage ? <Button variant="secondary" onClick={() => setConnecting(true)}>Connect an account</Button> : undefined} />}>
        {(list) => (
          <Grid columns={{ minWidth: 320, repeat: 'fill' }} gap={4}>
            {list.map((a) => <AccountCard key={a.account_id} account={a} manage={manage} />)}
          </Grid>
        )}
      </QueryState>
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
    </VStack>
  );
}

function AccountCard({ account: a, manage }: { account: SocialAccount; manage: boolean }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const [confirm, setConfirm] = useState(false);
  const reconnect = useWorkspaceMutation((id: string) => workspaceApi.reconnectAccount(id), ['accounts']);
  const disconnect = useWorkspaceMutation((id: string) => workspaceApi.disconnectAccount(id), ['accounts']);
  const healthy = a.state === 'CONNECTED' || a.state === 'TEST_ONLY';
  const channel = a.channel === 'facebook' ? 'Facebook page' : 'Instagram profile';

  return (
    <Card>
      <CardHead title={a.name} lead={<PlatformLogo platform={a.channel} size={24} />} badge={<AccountBadge value={a.state} />} />
      <CardBody>
        {a.state_reason && <Alert tone={healthy ? 'info' : 'blocked'} title={a.state_reason} />}
        <MetadataList>
          <MetadataListItem label="Type">{channel}</MetadataListItem>
          <MetadataListItem label="Handle">{a.handle}</MetadataListItem>
          <MetadataListItem label="Can post">{a.formats.length ? a.formats.join(', ') : 'Nothing until fixed'}</MetadataListItem>
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
                  try { await reconnect.mutateAsync([a.account_id]); toast(`${a.name} reconnected`, 'done', sim ? 'Simulation: no real sign-in to Meta happened.' : undefined); }
                  catch (e) { toast(isApiError(e) ? e.message : 'Could not reconnect', 'blocked'); }
                })();
              }}>Reconnect</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>Disconnect</Button>
        </CardFoot>
      )}
      <AlertDialog isOpen={confirm} onOpenChange={setConfirm} title={`Disconnect ${a.name}?`}
        description="Marketing will no longer be able to post to it. Posts already live stay live; scheduled posts must be cancelled first."
        actionLabel="Disconnect" isActionLoading={disconnect.isPending}
        onAction={async () => {
          try { await disconnect.mutateAsync([a.account_id]); setConfirm(false); toast(`${a.name} disconnected`, 'done'); }
          catch (e) { setConfirm(false); toast(isApiError(e) ? e.message : 'Could not disconnect', 'blocked'); }
        }} />
    </Card>
  );
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const [channel, setChannel] = useState<SocialAccount['channel']>('facebook');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const connect = useWorkspaceMutation((c: SocialAccount['channel'], n: string) => workspaceApi.connectAccount(c, n), ['accounts']);

  const submit = async () => {
    if (!name.trim()) { setError('Name the page or profile.'); return; }
    try {
      const acc = await connect.mutateAsync([channel, name.trim()]);
      toast(`${acc.name} connected`, 'done', sim ? 'Test only in simulation: nothing can be posted for real.' : undefined);
      onClose();
    } catch (e) {
      setError(fieldMessagesOf(e).name ?? (isApiError(e) ? e.message : 'Could not connect'));
    }
  };

  return (
    <Modal open onClose={onClose} title="Connect an account"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={connect.isPending} onClick={() => void submit()}>Continue to sign in</Button>
        </>
      )}>
      <VStack gap={5}>
        <RadioList label="Where do you want to post?" value={channel} onChange={(v) => setChannel(v as SocialAccount['channel'])}>
          <RadioListItem value="facebook" label="Facebook page" description="Feed images and videos." startContent={<PlatformLogo platform="facebook" decorative />} />
          <RadioListItem value="instagram" label="Instagram professional profile" description="Feed images and Reels. Text-only posts are not possible." startContent={<PlatformLogo platform="instagram" decorative />} />
        </RadioList>
        <TextInput label="Page or profile name" value={name} onChange={(v) => { setName(v); setError(''); }} isRequired width="100%"
          placeholder="For example, NRC Research" status={error ? { type: 'error', message: error } : undefined} statusVariant="detached" />
        <Text type="supporting" color="secondary">You sign in to Meta and choose the page. Marketing never sees your password or the access token.{sim ? ' In simulation the account is connected as test only.' : ''}</Text>
      </VStack>
    </Modal>
  );
}
