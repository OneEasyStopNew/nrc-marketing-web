import { useMemo, useState } from 'react';
import { ChannelLabel } from '@/components/ui/PlatformLogo';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Grid } from '@astryxdesign/core/Grid';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAuth, useSession } from '@/auth/AuthProvider';
import { useAsset } from '@/api/assets';
import { creativesApi } from '@/api/creatives';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type ApprovalRequest, type Decision } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Alert, EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { PostPreview } from '@/pages/create/parts';
import { useApprovals, useWorkspaceMutation } from '@/pages/shared/queries';
import { QueryState, ReviewBadge, ValidationBadge } from '@/pages/shared/ui';

/** /marketing/approvals (queue) and /marketing/approvals/:id (one review). */
export default function ApprovalsPage() {
  return (
    <Routes>
      <Route index element={<Queue />} />
      <Route path=":approvalId" element={<Review />} />
    </Routes>
  );
}

/* ---------- Queue ---------- */

type View = 'waiting' | 'decided' | 'stale';

function Queue() {
  const approvals = useApprovals();
  const [view, setView] = useState<View>('waiting');
  const [search, setSearch] = useState('');
  const all = approvals.data ?? [];
  const groups: Record<View, ApprovalRequest[]> = {
    waiting: all.filter((a) => a.state === 'PENDING'),
    decided: all.filter((a) => ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(a.state)),
    stale: all.filter((a) => a.state === 'STALE'),
  };
  const q = search.trim().toLowerCase();
  const rows = groups[view].filter((a) => !q || `${a.creative_id} ${a.caption} ${a.submitted_by}`.toLowerCase().includes(q));

  return (
    <VStack gap={8}>
      <PageHeader title="Approvals" description="Review posts before they can be published. Approval binds to the exact version you see." />
      <VStack gap={4}>
        <Tabs<View> value={view} onChange={setView} tabs={[
          { id: 'waiting', label: 'Waiting for review', count: groups.waiting.length, attention: groups.waiting.length > 0 },
          { id: 'decided', label: 'Decided', count: groups.decided.length },
          { id: 'stale', label: 'Out of date', count: groups.stale.length },
        ]} />
        <VStack width={320} maxWidth="100%">
          <TextInput label="Search the queue" isLabelHidden type="search" placeholder="Search by draft, caption or person" value={search} onChange={setSearch} hasClear
            startIcon={<Icon name="search" />} />
        </VStack>
        <QueryState query={approvals} what="the review queue">
          {() => rows.length
            ? <Table<ApprovalRequest> data={rows} columns={queueColumns} idKey="approval_id" density="balanced" dividers="rows" hasHover />
            : <EmptyState icon="check" title={q ? 'No matches' : view === 'waiting' ? 'Nothing waiting for review' : 'Nothing here'} description={q ? 'Try another search.' : undefined} />}
        </QueryState>
      </VStack>
    </VStack>
  );
}

const queueColumns: TableColumn<ApprovalRequest>[] = [
  {
    key: 'caption', header: 'Post', width: proportional(3, { minWidth: 220 }),
    renderCell: (a) => (
      <VStack gap={0.5}>
        <Link href={`/marketing/approvals/${encodeURIComponent(a.approval_id)}`}>{a.creative_id} · version {a.creative_version}</Link>
        <Text type="supporting" color="secondary" maxLines={2}>{a.caption}</Text>
      </VStack>
    ),
  },
  { key: 'submitted_by', header: 'Submitted', width: pixel(170), renderCell: (a) => <VStack gap={0.5}><Text type="body">{a.is_own ? 'You' : a.submitted_by}</Text><Timestamp value={a.submitted_at} format="relative" type="supporting" color="secondary" /></VStack> },
  { key: 'validation', header: 'Validation', width: pixel(150), renderCell: (a) => <ValidationBadge value={a.validation.is_current ? a.validation.outcome : 'STALE'} /> },
  { key: 'state', header: 'Status', width: pixel(170), renderCell: (a) => <ReviewBadge value={a.state} /> },
  { key: 'due_at', header: 'Due', width: pixel(120), renderCell: (a) => (a.due_at ? <Timestamp value={a.due_at} format="relative" type="supporting" color="secondary" /> : <Text type="supporting" color="secondary">—</Text>) },
];

/* ---------- One review ---------- */

function Review() {
  const { approvalId = '' } = useParams();
  const { context } = useSession();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const req = useQuery({
    queryKey: ['ws', context.tenant.tenant_id, 'approval', approvalId],
    queryFn: ({ signal }) => workspaceApi.approval(approvalId, signal),
  });
  const a = req.data;
  const creative = useQuery({
    queryKey: ['creative-review', context.tenant.tenant_id, a?.creative_id],
    queryFn: ({ signal }) => creativesApi.get(a!.creative_id, signal),
    enabled: !!a,
  });
  const asset = useAsset(creative.data?.creative.asset_id);
  const [decision, setDecision] = useState<Decision | ''>('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ decision?: string; reason?: string }>({});
  const decide = useWorkspaceMutation(
    (id: string, version: number, d: Decision, r: string) => workspaceApi.decide(id, version, d, r),
    ['approvals', 'drafts'],
  );
  const format = context.post_formats[0];

  const blocker = useMemo(() => {
    if (!a) return null;
    if (!can('approval:decide')) return 'Your role can see this request but cannot decide on it.';
    if (a.is_own) return 'You submitted this post. Someone else must review it.';
    if (a.state === 'STALE') return a.reason ?? 'The draft changed after it was submitted. The creator must submit the new version.';
    if (a.state !== 'PENDING') return null;
    if (creative.data && creative.data.creative.version !== a.creative_version) return `The draft is now version ${creative.data.creative.version}. This request is for version ${a.creative_version} and cannot be decided.`;
    return null;
  }, [a, can, creative.data]);
  const canApprove = !!a && a.validation.is_current && a.validation.outcome === 'PASS';

  if (!a) {
    const notFound = req.isError && isApiError(req.error) && (req.error.kind === 'not_found' || req.error.kind === 'forbidden');
    return (
      <VStack gap={8}>
        <PageHeader title="Review" crumbs={[{ label: 'Approvals', to: '/marketing/approvals' }, { label: 'Review' }]} />
        {notFound ? <EmptyState icon="search" title="Review request not found" description="It does not exist, or it is not available to you in this organisation." />
          : <QueryState query={req} what="the review request">{() => null}</QueryState>}
      </VStack>
    );
  }

  const submit = async () => {
    const e: typeof errors = {};
    if (!decision) e.decision = 'Choose a decision.';
    if (decision && decision !== 'APPROVE' && !reason.trim()) e.reason = 'Say what needs to change, so the creator can fix it.';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await decide.mutateAsync([a.approval_id, a.creative_version, decision as Decision, reason.trim()]);
      await req.refetch();
      toast(decision === 'APPROVE' ? `Version ${a.creative_version} approved` : decision === 'REJECT' ? 'Post rejected' : 'Changes requested', 'done',
        decision === 'APPROVE' ? 'It can now be scheduled. Approval is not publication.' : 'The creator sees your reason on the draft.');
    } catch (err) {
      if (!isApiError(err)) throw err;
      const f = fieldMessagesOf(err);
      if (f.reason || f.decision) setErrors({ reason: f.reason, decision: f.decision });
      else toast(err.message, 'blocked', err.requestId ? `Reference ${err.requestId}` : undefined);
      void req.refetch();
    }
  };

  const decided = a.state !== 'PENDING' && a.state !== 'STALE';

  return (
    <VStack gap={8}>
      <PageHeader title={`Review ${a.creative_id} · version ${a.creative_version}`}
        crumbs={[{ label: 'Approvals', to: '/marketing/approvals' }, { label: a.creative_id, mono: true }]}
        badge={<ReviewBadge value={a.state} />}
        description="You are deciding on exactly this version. Any later edit makes this decision out of date." />

      {blocker && <Alert tone={a.state === 'STALE' ? 'waiting' : 'info'} title="You cannot decide on this request">{blocker}</Alert>}

      <Grid columns={{ minWidth: 340, repeat: 'fit' }} gap={6}>
        <section aria-label="Post preview"><VStack gap={4}>
          <PostPreview tenantName={context.tenant.name} caption={a.caption} format={format} full
            image={asset.data?.download_url ? { src: asset.data.download_url, alt: `Image for version ${a.creative_version}${asset.data.provider === 'simulation' ? ' (simulation placeholder)' : ''}` } : undefined} />
          <Card>
            <CardHead title="Brief" />
            <Text type="body" wordBreak="break-word">{a.prompt}</Text>
          </Card>
        </VStack></section>

        <VStack gap={4}>
          <Card>
            <CardHead title="What you are approving" icon="shield" regulatory />
            <CardBody>
              <MetadataList>
                <MetadataListItem label="Study">{a.study_title}</MetadataListItem>
                <MetadataListItem label="Where it goes"><ChannelLabel text={a.channel_label} /></MetadataListItem>
                <MetadataListItem label="Version">{a.creative_version}</MetadataListItem>
                <MetadataListItem label="Validation">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <ValidationBadge value={a.validation.is_current ? a.validation.outcome : 'STALE'} />
                    <Link href={`/marketing/validation/${encodeURIComponent(a.creative_id)}/${encodeURIComponent(a.validation.run_id)}`}>Evidence</Link>
                  </HStack>
                </MetadataListItem>
                <MetadataListItem label="Open findings">{a.validation.open_findings}</MetadataListItem>
                <MetadataListItem label="Submitted">{a.is_own ? 'You' : a.submitted_by} · {fmtDateTime(a.submitted_at)}</MetadataListItem>
                <MetadataListItem label="Due">{a.due_at ? fmtDateTime(a.due_at) : 'No due date'}</MetadataListItem>
              </MetadataList>
            </CardBody>
          </Card>

          {decided ? (
            <Card>
              <CardHead title="Decision" />
              <CardBody>
                <MetadataList>
                  <MetadataListItem label="Result"><ReviewBadge value={a.state} /></MetadataListItem>
                  <MetadataListItem label="By">{a.decided_by ?? '—'}</MetadataListItem>
                  <MetadataListItem label="When">{a.decided_at ? fmtDateTime(a.decided_at) : '—'}</MetadataListItem>
                  <MetadataListItem label="Reason">{a.reason ?? '—'}</MetadataListItem>
                </MetadataList>
              </CardBody>
              <CardFoot>
                <Text type="supporting" color="secondary">Approval is not publication. A publisher schedules approved versions.</Text>
              </CardFoot>
            </Card>
          ) : (
            <Card>
              <CardHead title="Your decision" />
              <CardBody>
                {!canApprove && !blocker && (
                  <Alert tone="waiting" title="Approve is not available">
                    Validation for this version {a.validation.is_current ? `did not pass (${a.validation.outcome.replace('_', ' ').toLowerCase()})` : 'is out of date'}. You can request changes or reject.
                  </Alert>
                )}
                <RadioList label="Decision" value={decision} onChange={(v) => { setDecision(v as Decision); setErrors((e) => ({ ...e, decision: undefined })); }}
                  isDisabled={!!blocker} isRequired status={errors.decision ? { type: 'error', message: errors.decision } : undefined}>
                  <RadioListItem value="APPROVE" label="Approve this version" description="It can then be scheduled by a publisher." isDisabled={!canApprove} />
                  <RadioListItem value="REQUEST_CHANGES" label="Request changes" description="The creator fixes it and submits a new version." />
                  <RadioListItem value="REJECT" label="Reject" description="This post will not be used." />
                </RadioList>
                <TextArea label="Reason" value={reason} onChange={(v) => { setReason(v); setErrors((e) => ({ ...e, reason: undefined })); }} rows={4}
                  isDisabled={!!blocker} isOptional={decision === 'APPROVE'} isRequired={decision !== '' && decision !== 'APPROVE'}
                  description="Required when you request changes or reject. The creator sees it."
                  status={errors.reason ? { type: 'error', message: errors.reason } : undefined} statusVariant="detached" width="100%" />
              </CardBody>
              <CardFoot>
                <Button variant="ghost" onClick={() => navigate('/marketing/approvals')}>Back to the queue</Button>
                <StackItem size="fill">{null}</StackItem>
                <Button variant={decision === 'REJECT' ? 'danger' : 'primary'} loading={decide.isPending} disabled={!!blocker} onClick={() => void submit()}>
                  {decision === 'REJECT' ? 'Reject post' : decision === 'REQUEST_CHANGES' ? 'Send back for changes' : 'Record decision'}
                </Button>
              </CardFoot>
            </Card>
          )}
        </VStack>
      </Grid>
    </VStack>
  );
}
