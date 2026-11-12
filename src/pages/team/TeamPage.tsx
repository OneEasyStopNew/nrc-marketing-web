import { useMemo, useState, type ReactElement } from 'react';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { Avatar } from '@astryxdesign/core/Avatar';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useSession } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type Member } from '@/api/workspace';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useMembers, useWorkspaceMutation } from '@/pages/shared/queries';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { InDevelopment, QueryState, ROLE_LABEL, useIsSimulation } from '@/pages/shared/ui';

type Role = Member['roles'][number];
type Filter = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

const ROLES: { value: Role; description: string }[] = [
  { value: 'creator', description: 'Writes posts, validates them and generates images.' },
  { value: 'reviewer', description: 'Validates and approves or rejects posts. Cannot approve their own.' },
  { value: 'policy_admin', description: 'Drafts, activates and retires policy rules.' },
  { value: 'publisher', description: 'Connects accounts and schedules approved posts.' },
  { value: 'admin', description: 'Manages this team and its roles. Does not approve, publish or edit rules.' },
];

const STATUS_BADGE: Record<Member['status'], { label: string; tone: 'done' | 'waiting' | 'blocked' }> = {
  ACTIVE: { label: 'Active', tone: 'done' },
  INVITED: { label: 'Invited', tone: 'waiting' },
  SUSPENDED: { label: 'Suspended', tone: 'blocked' },
};

/**
 * Team: who can work in this organisation's Marketing area and with which
 * roles. Sign-in itself is handled by the identity provider; this page only
 * manages roles inside the tenant.
 */
export default function TeamPage(): ReactElement {
  // Not fetched while team management is in development: the backend has no /members yet.
  const members = useMembers(!IN_DEVELOPMENT.team);
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Member | 'new' | null>(null);
  const all = useMemo(() => members.data ?? [], [members.data]);
  const count = (s: Filter) => all.filter((m) => m.status === s).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((m) => m.status === filter && (!q || `${m.name} ${m.email}`.toLowerCase().includes(q)));
  }, [all, filter, search]);

  // Team management is in no ticket yet (config/inDevelopment.ts).
  if (IN_DEVELOPMENT.team) {
    return (
      <VStack gap={8}>
        <PageHeader title="Team" description="Who works in Marketing for this organisation, and what each person may do." />
        <InDevelopment feature="Team management" description="Inviting people and setting their roles is being built and will be available soon." />
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <PageHeader title="Team" description="Who works in Marketing for this organisation, and what each person may do."
        actions={<Button variant="primary" icon="plus" onClick={() => setDialog('new')}>Invite someone</Button>} />
      <VStack gap={4}>
        <Tabs<Filter> value={filter} onChange={setFilter} tabs={[
          { id: 'ACTIVE', label: 'Active', count: count('ACTIVE') },
          { id: 'INVITED', label: 'Invited', count: count('INVITED') },
          { id: 'SUSPENDED', label: 'Suspended', count: count('SUSPENDED') },
        ]} />
        <VStack width={320} maxWidth="100%">
          <TextInput label="Search people" isLabelHidden type="search" placeholder="Search by name or email" value={search} onChange={setSearch} hasClear
            startIcon={<Icon name="search" />} />
        </VStack>
        <QueryState query={members} what="the team">
          {() => rows.length
            ? <Table<Member> data={rows} columns={columns((m) => setDialog(m))} idKey="user_id" density="balanced" dividers="rows" hasHover />
            : <EmptyState icon="users" title="Nobody here" description={search ? 'Try another search.' : undefined} />}
        </QueryState>
      </VStack>
      {dialog && <MemberDialog member={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />}
    </VStack>
  );
}

function columns(onEdit: (m: Member) => void): TableColumn<Member>[] {
  return [
    {
      key: 'name', header: 'Person', width: proportional(2, { minWidth: 220 }),
      renderCell: (m) => (
        <HStack gap={3} vAlign="center">
          <Avatar name={m.name} size="sm" />
          <VStack gap={0.5}>
            <Text type="body" weight="semibold">{m.name}</Text>
            <Text type="supporting" color="secondary">{m.email}</Text>
          </VStack>
        </HStack>
      ),
    },
    {
      key: 'roles', header: 'Roles', width: proportional(2, { minWidth: 200 }),
      renderCell: (m) => <HStack gap={1} wrap="wrap">{m.roles.map((r) => <Badge key={r} variant={r === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[r]}</Badge>)}</HStack>,
    },
    { key: 'status', header: 'Status', width: pixel(110), renderCell: (m) => <Badge variant={STATUS_BADGE[m.status].tone}>{STATUS_BADGE[m.status].label}</Badge> },
    { key: 'mfa', header: 'Two-step sign-in', width: pixel(140), renderCell: (m) => <Text type="body" color={m.mfa ? 'primary' : 'secondary'}>{m.mfa ? 'On' : 'Off'}</Text> },
    { key: 'last_active_at', header: 'Last active', width: pixel(120), renderCell: (m) => (m.last_active_at ? <Timestamp value={m.last_active_at} format="relative" type="supporting" color="secondary" /> : <Text type="supporting" color="secondary">Never</Text>) },
    {
      key: 'actions', header: <VisuallyHidden>Actions</VisuallyHidden>, width: pixel(110), align: 'end',
      renderCell: (m) => <Button variant="ghost" size="sm" aria-label={`Change roles for ${m.name}`} onClick={() => onEdit(m)}>Roles</Button>,
    },
  ];
}

function MemberDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { toast } = useToast();
  const { context } = useSession();
  const sim = useIsSimulation();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [roles, setRoles] = useState<Role[]>(member?.roles ?? ['creator']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invite = useWorkspaceMutation((b: { name: string; email: string; roles: Role[] }) => workspaceApi.invite(b), ['members']);
  const update = useWorkspaceMutation((id: string, r: Role[]) => workspaceApi.updateRoles(id, r), ['members']);
  const busy = invite.isPending || update.isPending;

  const submit = async () => {
    const local: Record<string, string> = {};
    if (!member && !name.trim()) local.name = 'Enter their name.';
    if (!member && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) local.email = 'Enter a valid email address.';
    if (!roles.length) local.roles = 'Choose at least one role.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      if (member) {
        await update.mutateAsync([member.user_id, roles]);
        toast(`Roles updated for ${member.name}`, 'done', 'The change applies the next time they load a page.');
      } else {
        const m = await invite.mutateAsync([{ name: name.trim(), email: email.trim(), roles }]);
        toast(`${m.name} invited`, 'done', sim ? 'Simulation: no email was sent.' : 'They get an email with a sign-in link.');
      }
      onClose();
    } catch (e) {
      const f = fieldMessagesOf(e);
      if (Object.keys(f).length) setErrors(f);
      else toast(isApiError(e) ? e.message : 'The change could not be saved', 'blocked');
    }
  };

  return (
    <Modal open onClose={onClose} title={member ? `Roles for ${member.name}` : 'Invite someone'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{member ? 'Save roles' : 'Send invitation'}</Button>
        </>
      )}>
      <VStack gap={5}>
        {!member && (
          <>
            <TextInput label="Name" value={name} onChange={(v) => { setName(v); setErrors((e) => ({ ...e, name: '' })); }} isRequired
              status={errors.name ? { type: 'error', message: errors.name } : undefined} statusVariant="detached" />
            <TextInput label="Work email" type="email" value={email} onChange={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: '' })); }} isRequired
              placeholder="name@organisation.org" description={`They sign in with their ${context.tenant.name} account.`}
              status={errors.email ? { type: 'error', message: errors.email } : undefined} statusVariant="detached" />
          </>
        )}
        <CheckboxList label="Roles" value={roles} onChange={(v) => { setRoles(v as Role[]); setErrors((e) => ({ ...e, roles: '' })); }}
          status={errors.roles ? { type: 'error', message: errors.roles } : undefined}>
          {ROLES.map((r) => <CheckboxListItem key={r.value} value={r.value} label={ROLE_LABEL[r.value]} description={r.description} />)}
        </CheckboxList>
      </VStack>
    </Modal>
  );
}
