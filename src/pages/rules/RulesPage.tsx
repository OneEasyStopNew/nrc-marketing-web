import { useMemo, useState, type ReactElement } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type PolicyRule, type RuleDraft, type RuleGate, type RuleStatus } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Alert, EmptyState, PageHeader, Tabs } from '@/components/ui/Misc';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useRules, useWorkspaceMutation } from '@/pages/shared/queries';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { GATE_LABEL, InDevelopmentDialog, QueryState, RuleStatusBadge, SeverityBadge, useIsSimulation } from '@/pages/shared/ui';

const GATES: RuleGate[] = ['completeness', 'study_facts', 'policy', 'media'];
const APPLIES: { value: PolicyRule['applies_to'][number]; label: string }[] = [
  { value: 'brief', label: 'Brief' }, { value: 'caption', label: 'Caption' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' },
];

/**
 * Rules (NRC-20): the policy rules every brief, caption and image is checked
 * against, each traced to the clause it comes from. Policy administrators
 * draft and edit rules; a draft applies only once activated.
 */
export default function RulesPage(): ReactElement {
  const { can } = useAuth();
  const rules = useRules();
  const [status, setStatus] = useState<RuleStatus>('ACTIVE');
  const [gate, setGate] = useState<RuleGate | 'any'>('any');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PolicyRule | 'new' | null>(null);
  const all = useMemo(() => rules.data ?? [], [rules.data]);
  const count = (s: RuleStatus) => all.filter((r) => r.status === s).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => r.status === status && (gate === 'any' || r.gate === gate)
      && (!q || `${r.rule_id} ${r.title} ${r.description} ${r.source.clause}`.toLowerCase().includes(q)));
  }, [all, status, gate, search]);
  const open = all.find((r) => r.rule_id === openId);
  const manage = can('policy:manage');

  return (
    <VStack gap={8}>
      <PageHeader title="Rules" description="The rules every brief, caption and image is checked against, and the clause each one comes from."
        actions={manage ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New rule</Button> : undefined} />
      <VStack gap={4}>
        <Tabs<RuleStatus> value={status} onChange={setStatus} tabs={[
          { id: 'ACTIVE', label: 'Active', count: count('ACTIVE') },
          { id: 'DRAFT', label: 'Drafts', count: count('DRAFT'), attention: count('DRAFT') > 0 },
          { id: 'RETIRED', label: 'Retired', count: count('RETIRED') },
        ]} />
        <HStack gap={3} vAlign="center" wrap="wrap">
          <VStack width={320} maxWidth="100%">
            <TextInput label="Search rules" isLabelHidden type="search" placeholder="Search by ID, title or clause" value={search} onChange={setSearch} hasClear
              startIcon={<Icon name="search" />} />
          </VStack>
          <Selector label="Check area" isLabelHidden value={gate} onChange={(v) => setGate((v ?? 'any') as RuleGate | 'any')}
            options={[{ value: 'any', label: 'All check areas' }, ...GATES.map((g) => ({ value: g, label: GATE_LABEL[g] }))]} />
        </HStack>
        <QueryState query={rules} what="the policy rules">
          {() => rows.length
            ? <Table<PolicyRule> data={rows} columns={ruleColumns((r) => setOpenId(r.rule_id))} idKey="rule_id" density="balanced" dividers="rows" hasHover />
            : <EmptyState icon="doc" title="No rules match" description={search || gate !== 'any' ? 'Try another search or check area.' : undefined} />}
        </QueryState>
      </VStack>
      {open && <RuleDrawer rule={open} manage={manage} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)} />}
      {/* NRC-20: the demo is read-only; editing rules is in development (config/inDevelopment.ts). */}
      {editing && (IN_DEVELOPMENT.ruleEditing
        ? <InDevelopmentDialog feature={editing === 'new' ? 'New rule' : `Edit ${editing.rule_id}`} description="Adding and editing rules is being built and will be available soon." onClose={() => setEditing(null)} />
        : <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />)}
    </VStack>
  );
}

function ruleColumns(onOpen: (r: PolicyRule) => void): TableColumn<PolicyRule>[] {
  return [
    {
      key: 'title', header: 'Rule', width: proportional(3, { minWidth: 240 }),
      renderCell: (r) => (
        <VStack gap={0.5}>
          <Link onClick={() => onOpen(r)}>{r.title}</Link>
          <Text type="supporting" color="secondary">{r.rule_id} v{r.version} · {r.source.clause}</Text>
        </VStack>
      ),
    },
    { key: 'gate', header: 'Check area', width: pixel(140), renderCell: (r) => GATE_LABEL[r.gate] },
    { key: 'severity', header: 'Severity', width: pixel(110), renderCell: (r) => <SeverityBadge value={r.severity} /> },
    { key: 'mandatory', header: 'Required', width: pixel(100), renderCell: (r) => (r.mandatory ? 'Yes' : 'No') },
    { key: 'fail_count_30d', header: 'Failed, 30 days', width: pixel(130), align: 'end', renderCell: (r) => r.fail_count_30d },
  ];
}

function RuleDrawer({ rule: r, manage, onClose, onEdit }: { rule: PolicyRule; manage: boolean; onClose: () => void; onEdit: () => void }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<RuleStatus | null>(null);
  const change = useWorkspaceMutation((id: string, version: number, s: RuleStatus) => workspaceApi.updateRule(id, version, { status: s }), ['rules']);
  const setStatus = async (s: RuleStatus) => {
    try {
      await change.mutateAsync([r.rule_id, r.version, s]);
      setConfirm(null);
      toast(s === 'ACTIVE' ? `${r.rule_id} is now active` : `${r.rule_id} retired`, 'done', s === 'ACTIVE' ? 'New validation runs use it. Earlier results are not rewritten.' : 'New validation runs no longer use it.');
    } catch (e) {
      setConfirm(null);
      toast(isApiError(e) ? e.message : 'The rule could not be changed', 'blocked');
    }
  };
  return (
    <Drawer open onClose={onClose} title={r.title} subtitle={`${r.rule_id} · version ${r.version}`} badge={<RuleStatusBadge value={r.status} />}
      footer={manage ? (
        <>
          {r.status !== 'RETIRED' && <Button variant="secondary" icon="edit" onClick={onEdit}>Edit</Button>}
          {r.status === 'DRAFT' && <Button variant="primary" onClick={() => setConfirm('ACTIVE')}>Activate</Button>}
          {r.status === 'ACTIVE' && <Button variant="danger-outline" onClick={() => setConfirm('RETIRED')}>Retire</Button>}
        </>
      ) : undefined}>
      <VStack gap={5}>
        {r.status === 'DRAFT' && <Alert tone="waiting" title="Draft rule">It is not used in validation until it is activated.</Alert>}
        <Text type="body">{r.description}</Text>
        <MetadataList>
          <MetadataListItem label="Check area">{GATE_LABEL[r.gate]}</MetadataListItem>
          <MetadataListItem label="Severity"><SeverityBadge value={r.severity} /></MetadataListItem>
          <MetadataListItem label="Required">{r.mandatory ? 'Yes: if it cannot be assessed, the post cannot move on' : 'No'}</MetadataListItem>
          <MetadataListItem label="Applies to">{r.applies_to.map((a) => APPLIES.find((x) => x.value === a)?.label).join(', ')}</MetadataListItem>
          <MetadataListItem label="Suggested fix">{r.suggested_correction ?? '—'}</MetadataListItem>
          <MetadataListItem label="Failed, 30 days">{r.fail_count_30d}</MetadataListItem>
          <MetadataListItem label="Could not assess, 30 days">{r.unable_count_30d}</MetadataListItem>
          <MetadataListItem label="Last changed">{r.updated_by} · {fmtDateTime(r.updated_at)}</MetadataListItem>
        </MetadataList>
        <Divider />
        <VStack gap={2}>
          <Heading level={3}>Source</Heading>
          <Text type="supporting" color="secondary">{r.source.document} · {r.source.clause}</Text>
          <Blockquote>{r.source.excerpt}</Blockquote>
        </VStack>
      </VStack>
      {confirm && IN_DEVELOPMENT.ruleEditing && (
        <InDevelopmentDialog feature={confirm === 'ACTIVE' ? `Activate ${r.rule_id}` : `Retire ${r.rule_id}`}
          description="Activating and retiring rules is being built and will be available soon." onClose={() => setConfirm(null)} />
      )}
      <AlertDialog isOpen={!!confirm && !IN_DEVELOPMENT.ruleEditing} onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'ACTIVE' ? `Activate ${r.rule_id}?` : `Retire ${r.rule_id}?`}
        description={confirm === 'ACTIVE' ? 'New validation runs will check posts against it. Results already given are not changed.' : 'New validation runs stop using it. Its history stays.'}
        actionLabel={confirm === 'ACTIVE' ? 'Activate' : 'Retire'} actionVariant={confirm === 'ACTIVE' ? 'primary' : 'destructive'}
        isActionLoading={change.isPending} onAction={() => confirm && void setStatus(confirm)} />
    </Drawer>
  );
}

function RuleDialog({ rule, onClose }: { rule: PolicyRule | null; onClose: () => void }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const [d, setD] = useState<RuleDraft>(() => rule
    ? { title: rule.title, description: rule.description, gate: rule.gate, severity: rule.severity, mandatory: rule.mandatory, applies_to: rule.applies_to, source: rule.source, suggested_correction: rule.suggested_correction }
    : { title: '', description: '', gate: 'policy', severity: 'major', mandatory: true, applies_to: ['brief', 'caption'], source: { document: sim ? 'Sim policy bundle (simulation)' : '', clause: '', excerpt: '' }, suggested_correction: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useWorkspaceMutation(
    (body: RuleDraft) => (rule ? workspaceApi.updateRule(rule.rule_id, rule.version, body) : workspaceApi.createRule(body)),
    ['rules'],
  );
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const status = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!d.title.trim()) e.title = 'Give the rule a short title.';
    if (!d.description.trim()) e.description = 'Say what the rule checks.';
    if (!d.applies_to.length) e.applies_to = 'Choose what the rule applies to.';
    if (!d.source.clause.trim()) e.clause = 'Cite the clause this rule comes from.';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const saved = await save.mutateAsync([{ ...d, title: d.title.trim(), description: d.description.trim(), suggested_correction: d.suggested_correction?.trim() || null }]);
      toast(rule ? `${saved.rule_id} saved as version ${saved.version}` : `${saved.rule_id} drafted`, 'done', rule?.status === 'ACTIVE' ? 'New validation runs use this version.' : 'It applies only once activated.');
      onClose();
    } catch (err) {
      const f = fieldMessagesOf(err);
      if (Object.keys(f).length) setErrors(f);
      else toast(isApiError(err) ? err.message : 'The rule could not be saved', 'blocked');
    }
  };

  return (
    <Modal open onClose={onClose} title={rule ? `Edit ${rule.rule_id}` : 'New rule'} size="lg"
      footer={(<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void submit()}>{rule ? 'Save new version' : 'Save draft'}</Button></>)}>
      <VStack gap={5}>
        {rule?.status === 'ACTIVE' && <Alert tone="waiting" title="This rule is active">Saving creates version {rule.version + 1}, used by new validation runs straight away.</Alert>}
        <TextInput label="Title" isRequired value={d.title} onChange={(v) => set('title', v)} width="100%" status={status('title')} statusVariant="detached" />
        <TextArea label="What it checks" isRequired value={d.description} onChange={(v) => set('description', v)} rows={3} width="100%" status={status('description')} statusVariant="detached" />
        <Grid columns={{ minWidth: 220 }} gap={4}>
          <Selector label="Check area" value={d.gate} onChange={(v) => v && set('gate', v as RuleGate)} width="100%" options={GATES.map((g) => ({ value: g, label: GATE_LABEL[g] }))} />
          <Selector label="Severity" value={d.severity} onChange={(v) => v && set('severity', v as PolicyRule['severity'])} width="100%"
            options={[{ value: 'critical', label: 'Critical', description: 'Blocks the post' }, { value: 'major', label: 'Major', description: 'Blocks the post' }, { value: 'minor', label: 'Minor', description: 'A person decides' }]} />
        </Grid>
        <Switch label="Required" value={d.mandatory} onChange={(v) => set('mandatory', v)} description="If a required rule cannot be assessed, the post cannot move on." />
        <CheckboxList label="Applies to" isRequired value={d.applies_to} onChange={(v) => set('applies_to', v as RuleDraft['applies_to'])} status={status('applies_to')}>
          {APPLIES.map((a) => <CheckboxListItem key={a.value} value={a.value} label={a.label} />)}
        </CheckboxList>
        <Grid columns={{ minWidth: 220 }} gap={4}>
          <TextInput label="Source document" value={d.source.document} onChange={(v) => set('source', { ...d.source, document: v })} width="100%" />
          <TextInput label="Clause" isRequired value={d.source.clause} onChange={(v) => { set('source', { ...d.source, clause: v }); setErrors((e) => ({ ...e, clause: '' })); }} placeholder={sim ? 'e.g. Sim 4.3' : 'e.g. 4.3'} width="100%" status={status('clause')} statusVariant="detached" />
        </Grid>
        <TextArea label="Clause text" isOptional value={d.source.excerpt} onChange={(v) => set('source', { ...d.source, excerpt: v })} rows={2} width="100%" description="Quoted exactly. Shown to creators beside each finding." />
        <TextInput label="Suggested fix" isOptional value={d.suggested_correction ?? ''} onChange={(v) => set('suggested_correction', v)} width="100%" />
      </VStack>
    </Modal>
  );
}
