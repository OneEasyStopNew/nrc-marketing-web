import { useMemo, useState } from 'react';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { isNoActivePolicy, type ActivePolicy, type ActivePolicyRule, type PolicySeverity } from '@/api/policies';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Alert, EmptyState, PageHeader, SkeletonRows } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { useActivePolicy } from '@/pages/shared/queries';
import { GATE_LABEL, QueryState, SectionTitle, SeverityBadge } from '@/pages/shared/ui';
import { filterRules, inputsLabel, isFiltered, NO_FILTER, type PolicyFilter } from './activePolicy';

/**
 * Rules (NRC-20 demo slice): the tenant's active policy, read-only. Shows the
 * bundle version and every rule with its severity, mandatory status and the
 * clause it comes from, worded exactly as the API supplies it. No editing,
 * upload or activation here; rule administration comes later.
 */
export default function ActivePolicyPage() {
  const policy = useActivePolicy();

  return (
    <VStack gap={8}>
      <PageHeader title="Rules" description="The active policy that every brief, caption and image is checked against. Read-only." />
      {policy.isPending ? <Loading />
        : policy.isError && isNoActivePolicy(policy.error) ? <SetupRequired />
          : (
            <QueryState query={policy} what="the active policy">
              {(p) => (p.rules.length ? <PolicyView policy={p} /> : <SetupRequired />)}
            </QueryState>
          )}
    </VStack>
  );
}

function Loading() {
  return (
    <VStack gap={6}>
      <Card><SkeletonRows rows={3} /></Card>
      <Card><SkeletonRows rows={5} /></Card>
      <VisuallyHidden><span role="status">Loading the active policy</span></VisuallyHidden>
    </VStack>
  );
}

/** No approved policy: validation cannot run. A setup gap, never "no violations". */
function SetupRequired() {
  return (
    <Card aria-label="Policy setup required">
      <EmptyState icon="shield" title="Policy setup required"
        description="This organisation has no active policy, so posts cannot be validated against it yet. Ask your policy administrator to approve a policy." />
    </Card>
  );
}

function PolicyView({ policy: p }: { policy: ActivePolicy }) {
  const [filter, setFilter] = useState<PolicyFilter>(NO_FILTER);
  const rows = useMemo(() => filterRules(p.rules, filter), [p.rules, filter]);
  const set = <K extends keyof PolicyFilter>(k: K, v: PolicyFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));
  const mandatoryCount = p.rules.filter((r) => r.mandatory).length;

  return (
    <>
      <VStack gap={4}>
        <SectionTitle title="Active policy" description="New validation runs use this version." />
        <Card aria-label="Active policy">
          <CardHead title={p.name} icon="shield" badge={(
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Badge variant="done">Active</Badge>
              {p.is_synthetic && <Badge variant="waiting">Synthetic</Badge>}
            </HStack>
          )} />
          {p.is_synthetic && (
            <Alert tone="waiting" title="Synthetic demo rules">These are not the approved IPB rules. Do not rely on them for real content.</Alert>
          )}
          <MetadataList columns="multi">
            <MetadataListItem label="Version"><Text type="body">Version {p.version}</Text></MetadataListItem>
            <MetadataListItem label="Approved"><Text type="body">{fmtDateTime(p.approved_at)} by {p.approved_by}</Text></MetadataListItem>
            <MetadataListItem label="Rules"><Text type="body">{p.rules.length}, {mandatoryCount} mandatory</Text></MetadataListItem>
            <MetadataListItem label="Source"><Text type="body">{p.source_ref}</Text></MetadataListItem>
          </MetadataList>
        </Card>
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Rules in this policy" description="A failed mandatory rule fails validation. A failed optional rule needs a person to decide." />
        <HStack gap={3} vAlign="center" wrap="wrap">
          <VStack width={320} maxWidth="100%">
            <TextInput label="Search rules" isLabelHidden type="search" placeholder="Search by ID, wording or clause" value={filter.search}
              onChange={(v) => set('search', v)} hasClear startIcon={<Icon name="search" />} />
          </VStack>
          <Selector label="Severity" isLabelHidden value={filter.severity} onChange={(v) => set('severity', (v ?? 'any') as PolicySeverity | 'any')}
            options={[{ value: 'any', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'major', label: 'Major' }, { value: 'minor', label: 'Minor' }]} />
          <Selector label="Mandatory" isLabelHidden value={filter.mandatory} onChange={(v) => set('mandatory', (v ?? 'any') as PolicyFilter['mandatory'])}
            options={[{ value: 'any', label: 'Mandatory and optional' }, { value: 'mandatory', label: 'Mandatory only' }, { value: 'optional', label: 'Optional only' }]} />
        </HStack>
        <Text type="supporting" color="secondary">
          <span role="status">Showing {rows.length} of {p.rules.length} rules</span>
        </Text>
        {rows.length
          ? <VStack gap={4}>{rows.map((r) => <RuleCard key={r.rule_id} rule={r} />)}</VStack>
          : (
            <EmptyState icon="doc" kind="none" title="No rules match" description="Try another search, severity or mandatory filter."
              action={isFiltered(filter) ? <Button variant="secondary" size="sm" onClick={() => setFilter(NO_FILTER)}>Clear filters</Button> : undefined} />
          )}
      </VStack>
    </>
  );
}

/** One rule. Title, requirement, clause and excerpt are rendered exactly as supplied. */
function RuleCard({ rule: r }: { rule: ActivePolicyRule }) {
  return (
    <Card aria-label={`Rule ${r.rule_id}`}>
      <VStack gap={1}>
        <Text type="label" color="secondary">{r.rule_id} · rule version {r.rule_version}</Text>
        <CardHead title={r.title} badge={(
          <HStack gap={2} vAlign="center" wrap="wrap">
            <SeverityBadge value={r.severity} />
            {r.mandatory ? <Badge variant="regulatory">Mandatory</Badge> : <Badge variant="neutral">Optional</Badge>}
          </HStack>
        )} />
      </VStack>
      <Text type="body">{r.requirement}</Text>
      <MetadataList columns="multi">
        <MetadataListItem label="Clause"><Text type="body">{r.source.clause}</Text></MetadataListItem>
        <MetadataListItem label="Source document"><Text type="body">{r.source.source_id}</Text></MetadataListItem>
        <MetadataListItem label="Applies to"><Text type="body">{inputsLabel(r.applies_to)}</Text></MetadataListItem>
        <MetadataListItem label="Check area"><Text type="body">{GATE_LABEL[r.gate] ?? r.gate}</Text></MetadataListItem>
      </MetadataList>
      {r.source.excerpt && <Blockquote>{r.source.excerpt}</Blockquote>}
    </Card>
  );
}
