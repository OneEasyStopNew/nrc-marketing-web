import { useMemo, useState, type ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { BundleState, PolicyBundleDetail } from '@/api/policyAdmin';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageHeader } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { QueryState } from '@/pages/shared/ui';
import { BundleStateBadge, STATE_WORD } from './labels';
import { rulebookHref, SOURCES_PATH } from './paths';
import { useRulebooks } from './useRulebooks';

const STATES = Object.keys(STATE_WORD) as BundleState[];
const isState = (v: string): v is BundleState => (STATES as string[]).includes(v);

/**
 * Rulebooks (NRC-20): every version of the policy, newest first. Only one is
 * active at a time; the rest are drafts, waiting for review or approval,
 * built and waiting to be activated, or kept as history. Read-only here; the
 * status buttons live on each version's page.
 */
export default function RulebooksPage(): ReactElement {
  const [state, setState] = useState<BundleState | null>(null);
  const list = useRulebooks(state);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const columns = useMemo(() => rulebookColumns(), []);
  const active = rows.find((b) => b.lifecycle_state === 'ACTIVE');

  return (
    <VStack gap={6}>
      <PageHeader
        crumbs={[{ label: 'Rules', to: '/marketing/rules' }, { label: 'Rulebooks' }]}
        title="Rulebooks"
        description="Every version of the policy rulebook. Only one is active at a time; the others are drafts, waiting for review, or kept as history."
        actions={<Button variant="secondary" icon="doc" href={SOURCES_PATH}>Policy files</Button>}
      />
      <HStack gap={3} vAlign="end" wrap="wrap">
        <Selector
          label="Status"
          value={state ?? 'any'}
          onChange={(v) => setState(isState(v) ? v : null)}
          options={[{ value: 'any', label: 'Any status' }, ...STATES.map((s) => ({ value: s, label: STATE_WORD[s][1] }))]}
        />
      </HStack>
      <QueryState query={{ isPending: list.isPending, isError: list.isError, error: list.error, data: rows, refetch: list.refetch }} what="the rulebooks"
        empty={<EmptyState icon="doc" title={state ? 'No rulebooks with this status' : 'No rulebooks yet'}
          description={state ? 'Choose another status to see the other versions.' : 'Upload a policy source and create a draft to start the first rulebook.'} />}>
        {(data) => (
          <VStack gap={4}>
            {!state && (active
              ? <Alert tone="done" title={`Version ${active.version} is the active rulebook.`}>Every brief, caption and image is checked against it.</Alert>
              : <Alert tone="waiting" title="No rulebook is active.">Validation cannot pass anything until a rulebook is activated.</Alert>)}
            <Table<PolicyBundleDetail> data={data} columns={columns} idKey="id" density="balanced" dividers="rows" />
            {list.hasNextPage && (
              <HStack hAlign="start">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show older versions</Button>
              </HStack>
            )}
          </VStack>
        )}
      </QueryState>
    </VStack>
  );
}

function rulebookColumns(): TableColumn<PolicyBundleDetail>[] {
  return [
    {
      key: 'version', header: 'Version', width: pixel(120),
      renderCell: (b) => <Link href={rulebookHref(b.id)}>{`Version ${b.version}`}</Link>,
    },
    {
      key: 'name', header: 'Name', width: proportional(3, { minWidth: 200 }),
      renderCell: (b) => (
        <VStack gap={0.5} hAlign="start">
          <Text type="body" wordBreak="break-word">{b.name}</Text>
          {b.is_synthetic && <Badge variant="regulatory">Synthetic</Badge>}
        </VStack>
      ),
    },
    { key: 'lifecycle_state', header: 'Status', width: proportional(1, { minWidth: 150 }), renderCell: (b) => <BundleStateBadge state={b.lifecycle_state} /> },
    { key: 'rule_count', header: 'Rules', width: pixel(80), renderCell: (b) => <Text type="body" hasTabularNumbers>{b.rule_count}</Text> },
    {
      key: 'activated_at', header: 'Activated', width: proportional(1, { minWidth: 140 }),
      renderCell: (b) => <Text type="body" color={b.activated_at ? 'primary' : 'secondary'}>{b.activated_at ? fmtDateTime(b.activated_at) : 'Never'}</Text>,
    },
    { key: 'updated_at', header: 'Last change', width: proportional(1, { minWidth: 140 }), renderCell: (b) => <Text type="body">{fmtDateTime(b.updated_at)}</Text> },
  ];
}
