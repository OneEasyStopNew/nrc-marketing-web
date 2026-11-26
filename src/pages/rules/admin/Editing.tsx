import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { policyAdminApi, type PolicyBundleDetail, type PolicyRuleRecord } from '@/api/policyAdmin';
import type { Schemas } from '@/api/schemas.gen';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { GATE_LABEL } from '@/pages/shared/ui';
import { WORDING_KIND_WORD } from './labels';
import { rulebookHref } from './paths';
import { useRulebookChange } from './useRulebooks';

/**
 * Editing a draft rulebook (NRC-20): add a rule, change a rule, add exact
 * wording or a phrase that is not allowed, and start a new draft from any
 * version. Only a DRAFT is edited; an active rulebook never is. Every edit
 * sends the revision the screen showed, and a changed rule goes back to "Not
 * reviewed". Text is sent exactly as typed.
 */

type Gate = Schemas['Gate'];
type Severity = Schemas['Severity'];
type CheckType = Schemas['CheckType'];
type InputKind = Schemas['ValidationInputKind'];
type WordingKind = Schemas['WordingKind'];

const RULE_ID = /^[A-Z][A-Z0-9-]{1,39}$/;
const INPUTS: { value: InputKind; label: string }[] = [
  { value: 'brief', label: 'Brief' }, { value: 'text', label: 'Caption' }, { value: 'image', label: 'Image' },
];

interface RuleFields {
  rule_id: string; title: string; requirement: string; text: string;
  gate: Gate; severity: Severity; mandatory: boolean; check_type: CheckType; input_kinds: InputKind[];
}
const EMPTY: RuleFields = {
  rule_id: '', title: '', requirement: '', text: '', gate: 'policy', severity: 'major', mandatory: true, check_type: 'semantic', input_kinds: ['brief', 'text'],
};

/** Field problems found before sending; the API checks the same and answers 422 otherwise. */
function ruleProblems(f: RuleFields, isNew: boolean): Record<string, string> {
  const p: Record<string, string> = {};
  if (isNew && !RULE_ID.test(f.rule_id)) p.rule_id = 'Use capital letters, digits and dashes, starting with a letter. Example: REC-09.';
  if (!f.title.trim()) p.title = 'Give the rule a title.';
  if (!f.requirement.trim()) p.requirement = 'Say what the post must do.';
  if (isNew && !f.text.trim()) p.text = 'Paste the rule as it reads in the policy.';
  if (isNew && f.input_kinds.length === 0) p.input_kinds = 'Choose at least one.';
  return p;
}

export function RuleForm({ bundle, rule, onClose }: { bundle: PolicyBundleDetail; rule?: PolicyRuleRecord; onClose: () => void }): ReactElement {
  const { toast } = useToast();
  const isNew = !rule;
  const [f, setF] = useState<RuleFields>(rule
    ? { ...EMPTY, rule_id: rule.rule_id, title: rule.title, requirement: rule.requirement, gate: rule.gate, severity: rule.severity, mandatory: rule.mandatory, check_type: rule.check_type }
    : EMPTY);
  const [shown, setShown] = useState<Record<string, string>>({});
  const save = useRulebookChange(() => isNew
    ? policyAdminApi.createRule(bundle.id, bundle.revision, {
      rule_id: f.rule_id, title: f.title, requirement: f.requirement, text: f.text, gate: f.gate, severity: f.severity,
      mandatory: f.mandatory, check_type: f.check_type, input_kinds: f.input_kinds,
    })
    : policyAdminApi.updateRule(bundle.id, bundle.revision, rule.id, {
      title: f.title, requirement: f.requirement, gate: f.gate, severity: f.severity, mandatory: f.mandatory, check_type: f.check_type,
    }));
  const errors = { ...shown, ...fieldMessagesOf(save.error) };
  const set = <K extends keyof RuleFields>(k: K, v: RuleFields[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => {
    const p = ruleProblems(f, isNew);
    setShown(p);
    if (Object.keys(p).length) return;
    save.mutate([], {
      onSuccess: (saved) => {
        toast(isNew ? `${saved.rule_id} added` : `${saved.rule_id} saved`, 'done', 'It is marked "Not reviewed" until it is reviewed.');
        onClose();
      },
    });
  };

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? `Add a rule to version ${bundle.version}` : `Edit ${rule.rule_id}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{isNew ? 'Add rule' : 'Save'}</Button></>}>
      <VStack gap={4}>
        {!isNew && <Text type="body" color="secondary">Saving sends the rule back to "Not reviewed".</Text>}
        {isNew && <Input label="Rule ID" required value={f.rule_id} error={errors.rule_id} help="It never changes. Example: REC-09." onChange={(e) => set('rule_id', e.target.value)} />}
        <Input label="Title" required value={f.title} error={errors.title} onChange={(e) => set('title', e.target.value)} />
        <Textarea label="What the post must do" required rows={3} limit={1000} value={f.requirement} error={errors.requirement} onChange={(e) => set('requirement', e.target.value)} />
        {isNew && (
          <Textarea label="The rule as it reads in the policy" required rows={4} value={f.text} error={errors.text}
            help="Copied exactly from the source document. Validation searches this text." onChange={(e) => set('text', e.target.value)} />
        )}
        <Grid columns={{ minWidth: 200 }} gap={4}>
          <Select label="Checked under" value={f.gate} onChange={(e) => set('gate', e.target.value as Gate)}>
            {(Object.keys(GATE_LABEL) as Gate[]).map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
          </Select>
          <Select label="Severity" value={f.severity} onChange={(e) => set('severity', e.target.value as Severity)}>
            <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
          </Select>
          <Select label="How it is checked" value={f.check_type} onChange={(e) => set('check_type', e.target.value as CheckType)}>
            <option value="deterministic">By exact rules</option><option value="semantic">By meaning (AI)</option>
          </Select>
        </Grid>
        <Switch label="Mandatory" value={f.mandatory} onChange={(v) => set('mandatory', v)} description="A post cannot pass while a mandatory rule fails or cannot be checked." />
        {isNew && (
          <CheckboxList label="Checks" isRequired value={f.input_kinds} onChange={(v) => set('input_kinds', v as InputKind[])}
            status={errors.input_kinds ? { type: 'error', message: errors.input_kinds } : undefined}>
            {INPUTS.map((i) => <CheckboxListItem key={i.value} value={i.value} label={i.label} />)}
          </CheckboxList>
        )}
        {save.error && !Object.keys(fieldMessagesOf(save.error)).length && <SaveFailure error={save.error} />}
      </VStack>
    </Modal>
  );
}

export function WordingForm({ bundle, rule, onClose }: { bundle: PolicyBundleDetail; rule: PolicyRuleRecord; onClose: () => void }): ReactElement {
  const { toast } = useToast();
  const [kind, setKind] = useState<WordingKind>('EXACT_WORDING');
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const save = useRulebookChange(() => policyAdminApi.addWording(bundle.id, bundle.revision, rule.id, { kind, text }));
  const submit = () => {
    if (!text.trim()) { setMissing(true); return; }
    save.mutate([], { onSuccess: () => { toast(`Wording added to ${rule.rule_id}`, 'done', 'It is marked "Not reviewed" until it is reviewed.'); onClose(); } });
  };
  return (
    <Modal open onClose={onClose} title={`Add wording to ${rule.rule_id}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Add wording</Button></>}>
      <VStack gap={4}>
        <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as WordingKind)}>
          {(Object.keys(WORDING_KIND_WORD) as WordingKind[]).map((k) => <option key={k} value={k}>{WORDING_KIND_WORD[k]}</option>)}
        </Select>
        <Textarea label="Wording" required rows={3} value={text} help="Kept exactly as typed, spaces included."
          error={missing && !text.trim() ? 'Type the wording.' : fieldMessagesOf(save.error).text} onChange={(e) => setText(e.target.value)} />
        {save.error && !fieldMessagesOf(save.error).text && <SaveFailure error={save.error} />}
      </VStack>
    </Modal>
  );
}

/** "Start a new draft from version N": the server copies this version's rules, review included. */
export function NewDraftButton({ bundle }: { bundle: PolicyBundleDetail }): ReactElement {
  const { toast } = useToast();
  const navigate = useNavigate();
  const create = useRulebookChange(() => policyAdminApi.createBundle({
    name: bundle.name, source_ref: bundle.source_ref, is_synthetic: bundle.is_synthetic, based_on_bundle_id: bundle.id,
  }));
  return (
    <Button variant="secondary" icon="copy" loading={create.isPending}
      onClick={() => create.mutate([], {
        onSuccess: (d) => { toast(`Version ${d.version} started as a draft`, 'done', `It starts as a copy of version ${bundle.version}.`); void navigate(rulebookHref(d.id)); },
        onError: (e) => toast('The draft could not be started', 'blocked', e.message),
      })}>
      {`New draft from version ${bundle.version}`}
    </Button>
  );
}

function SaveFailure({ error }: { error: Error }): ReactElement {
  if (isApiError(error) && error.kind === 'stale') {
    return <Alert tone="blocked" title="Someone changed this rulebook">Close this; the page shows the latest version. Your text is not saved: copy it first.</Alert>;
  }
  if (isApiError(error) && error.kind === 'conflict') {
    return <Alert tone="blocked" title="Not saved">Only a draft can be edited. This rulebook is no longer a draft.</Alert>;
  }
  return <Alert tone="blocked" title="Not saved">{isApiError(error) ? error.message : 'Try again in a moment.'}</Alert>;
}
