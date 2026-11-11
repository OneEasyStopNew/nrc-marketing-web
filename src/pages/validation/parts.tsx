import { useMemo, useState, type ReactNode } from 'react';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import {
  GATES, isInProgress, passedAssessedChecks, unassessedMandatory,
  type ExecutionState, type Finding, type Gate, type Outcome, type Severity, type ValidationRun,
} from '@/api/validations';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Misc';
import { cn, fmtDateTime } from '@/lib/utils';
import { segmentByCodePoints } from '@/lib/spans';

/* ---------- Labels ---------- */

export const GATE_LABEL: Record<Gate, string> = {
  completeness: 'Completeness',
  study_facts: 'Study facts',
  policy: 'Policy rules',
  media: 'Image and media',
};

const SEVERITY: Record<Severity, { label: string; variant: BadgeVariant; mark: string; icon: 'warn' | 'clock' }> = {
  critical: { label: 'Critical', variant: 'blocked', mark: 'mark-block', icon: 'warn' },
  major: { label: 'Major', variant: 'blocked', mark: 'mark-block', icon: 'warn' },
  minor: { label: 'Minor', variant: 'waiting', mark: 'mark-warn', icon: 'clock' },
};
const SEVERITY_ORDER: Severity[] = ['critical', 'major', 'minor'];

/** Execution state: is the run still working, did it finish, did it break. Never the policy result. */
export function ExecutionBadge({ state }: { state: ExecutionState }) {
  const [variant, text]: [BadgeVariant, string] = (() => {
    switch (state) {
      case 'QUEUED': return ['neutral', 'Queued'];
      case 'RUNNING': return ['brand', 'Checking'];
      case 'WAITING_PROVIDER': return ['brand', 'Waiting for the checking service'];
      case 'SUCCEEDED': return ['done', 'Finished'];
      case 'NEEDS_REVIEW': return ['waiting', 'Finished, needs a person'];
      case 'FAILED': return ['blocked', 'Could not finish'];
      case 'CANCEL_REQUESTED': return ['waiting', 'Cancelling'];
      case 'CANCELLED': return ['neutral', 'Cancelled'];
      default: return ['waiting', 'Status unknown'];
    }
  })();
  return <Badge variant={variant}>{text}</Badge>;
}

/** Policy outcome, only once the run finished. PASS means the assessed checks passed, not approval. */
export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return <Badge>No result yet</Badge>;
  if (outcome === 'PASS') return <Badge variant="done">Passed the assessed checks</Badge>;
  if (outcome === 'FAIL') return <Badge variant="blocked">Failed</Badge>;
  return <Badge variant="waiting">Needs review</Badge>;
}

function GateBadge({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return <Badge>Not assessed</Badge>;
  if (outcome === 'PASS') return <Badge variant="done">Passed</Badge>;
  if (outcome === 'FAIL') return <Badge variant="blocked">Failed</Badge>;
  return <Badge variant="waiting">Needs review</Badge>;
}

/* ---------- Summary ---------- */

/**
 * What the run says and about which versions. Gates the run did not report
 * show "Not assessed", never green; approval and publishing are separate
 * steps the validator does not decide.
 */
export function RunSummary({ run, currentVersion, stale }: { run: ValidationRun; currentVersion: number | undefined; stale: boolean }) {
  const gateOutcome = (g: Gate) => run.gates.find((x) => x.gate === g)?.outcome;
  const done = !isInProgress(run.state);
  return (
    <VStack gap={4}>
      <MetadataList>
        <Pair k="Run">{<ExecutionBadge state={run.state} />}</Pair>
        <Pair k="Result">
          {!done ? <Badge>No result yet</Badge>
            : stale ? <HStack gap={2} vAlign="center" wrap="wrap"><Badge variant="waiting">Out of date</Badge><Text type="supporting" color="secondary">Historical result: {run.outcome ?? 'none'}</Text></HStack>
              : <OutcomeBadge outcome={run.outcome} />}
        </Pair>
        <Pair k="Checked">
          {run.input_kind === 'brief' ? 'Brief' : run.input_kind === 'text' ? 'Caption' : 'Image'}, version {run.creative_version}
          {currentVersion != null && currentVersion !== run.creative_version && <Text type="body" color="secondary"> (the draft is now version {currentVersion})</Text>}
        </Pair>
        <Pair k="Study snapshot">version {run.study_snapshot_version}</Pair>
        <Pair k="Policy bundle">{run.policy_bundle_version ? <Text type="code">{run.policy_bundle_version}</Text> : <Text type="body" color="secondary">Not reported</Text>}</Pair>
        <Pair k="Evaluated">{run.evaluated_at ? fmtDateTime(run.evaluated_at) : <Text type="body" color="secondary">Not yet</Text>}</Pair>
      </MetadataList>

      <VStack gap={2}>
        <Heading level={3}>Checks</Heading>
        <List hasDividers density="compact" aria-label="Checks by area">
          {GATES.map((g) => (
            <ListItem key={g} label={GATE_LABEL[g]}
              endContent={!done ? <Badge>Waiting</Badge> : stale ? <Badge variant="waiting">Out of date</Badge> : <GateBadge outcome={gateOutcome(g)} />} />
          ))}
          <ListItem label="Human approval" endContent={<Badge>Separate step</Badge>} />
          <ListItem label="Ready to publish" endContent={<Badge>Not decided here</Badge>} />
        </List>
        <Text type="supporting" color="secondary">Validation is an automated check, not an approval. A reviewer approves separately.</Text>
      </VStack>
    </VStack>
  );
}

function Pair({ k, children }: { k: string; children: ReactNode }) {
  return (
    <MetadataListItem label={k}>{children}</MetadataListItem>
  );
}

/**
 * The single verdict line at the top. "Passed" only when the backend says PASS,
 * every reported gate passed and nothing required went unassessed; an empty
 * findings list alone is never treated as a pass.
 */
export function Verdict({ run, stale }: { run: ValidationRun; stale: boolean }) {
  const unassessed = unassessedMandatory(run);
  if (isInProgress(run.state)) {
    return <Alert tone="info" icon="clock" title="Checking the brief">Results appear here when the run finishes. You can leave this page; the run continues.</Alert>;
  }
  if (run.state === 'FAILED' || run.state === 'CANCELLED') {
    return (
      <Alert tone="blocked" title="Validation could not finish">
        {run.coverage_gaps[0]?.reason ?? 'Nothing was assessed.'} Run validation again; this is not a result about the brief.
      </Alert>
    );
  }
  return (
    <VStack gap={3}>
      {stale && (
        <Alert tone="waiting" title="This result is out of date">
          It is for version {run.creative_version}. The draft changed afterwards, so this result no longer applies. Validate the current version.
        </Alert>
      )}
      {unassessed.length > 0 && (
        <Alert tone="blocked" title="A required check could not be assessed">
          {unassessed.map((r) => r.reason ?? `${r.rule_id} could not be assessed.`).join(' ')} The brief cannot move on until it is.
        </Alert>
      )}
      {!stale && passedAssessedChecks(run) && (
        <Alert tone="done" title="Passed the assessed checks">
          For version {run.creative_version}. This is not approval; a reviewer still decides.
        </Alert>
      )}
      {!stale && run.outcome === 'FAIL' && <Alert tone="blocked" title="Failed">Fix the findings below, then validate again.</Alert>}
      {!stale && run.outcome === 'NEEDS_REVIEW' && unassessed.length === 0 && (
        <Alert tone="waiting" title="Needs review">A person needs to decide on the findings marked below.</Alert>
      )}
    </VStack>
  );
}

/* ---------- Findings ---------- */

type Filter = 'all' | 'blocking' | 'minor' | 'decision';

export const findingKey = (i: number) => `finding-${i}`;

/**
 * Findings as in the ComplianceCheck pattern: severity, the rule and its
 * version, the explanation, the quoted text, the suggested correction and the
 * source clause. "Show in text" moves focus to the highlighted words.
 */
export function FindingsList({ findings, selected, onSelect, canShowInText }: {
  findings: Finding[];
  selected: number | null;
  onSelect: (i: number) => void;
  canShowInText: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const indexed = useMemo(
    () => findings.map((f, i) => ({ f, i })).sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity)),
    [findings],
  );
  const shown = indexed.filter(({ f }) =>
    filter === 'all' || (filter === 'blocking' ? f.severity !== 'minor' : filter === 'minor' ? f.severity === 'minor' : f.needs_human_decision));
  const count = (pred: (f: Finding) => boolean) => findings.filter(pred).length;

  if (!findings.length) {
    return <Text type="body" color="secondary">No findings were reported. This alone does not mean the brief passed; see the result above.</Text>;
  }

  return (
    <VStack gap={3}>
      <>
        <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All findings ({findings.length})</option>
          <option value="blocking">Critical and major ({count((f) => f.severity !== 'minor')})</option>
          <option value="minor">Minor ({count((f) => f.severity === 'minor')})</option>
          <option value="decision">Needs a decision ({count((f) => f.needs_human_decision)})</option>
        </Select>
      </>
      {!shown.length && <Text type="body" color="secondary">No findings match this filter.</Text>}
      <List hasDividers aria-label="Findings">
        {shown.map(({ f, i }) => {
          const sev = SEVERITY[f.severity];
          return (
            <ListItem key={i} align="start" isSelected={selected === i}
              startContent={<Icon name={sev.icon} color={f.severity === 'minor' ? 'warning' : 'error'} />}
              label={(
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Badge variant={sev.variant}>{sev.label}</Badge>
                  <Text type="supporting" color="secondary">{f.rule_id} v{f.rule_version}</Text>
                  {f.needs_human_decision && <Badge variant="regulatory">Needs a decision</Badge>}
                </HStack>
              )}
              description={(
              <VStack gap={2}>
                <Text type="body" wordBreak="break-word">{f.explanation}</Text>
                {f.offending_excerpt && <Text type="body" color="secondary">Text: <q>{f.offending_excerpt}</q></Text>}
                {f.suggested_correction && <Text type="body" color="secondary">Suggested: {f.suggested_correction}</Text>}
                <Collapsible trigger={`Source: ${f.source.clause}`} defaultIsOpen={false}>
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary">Source {f.source.source_id}, {f.source.clause}</Text>
                    <Blockquote>{f.source.excerpt ?? 'No excerpt provided.'}</Blockquote>
                  </VStack>
                </Collapsible>
                {f.text_span && canShowInText && (
                  <HStack><Button size="sm" variant="ghost" icon="search" aria-label={`Show in text: ${f.rule_id}`} onClick={() => onSelect(i)}>Show in text</Button></HStack>
                )}
              </VStack>
              )} />
          );
        })}
      </List>
    </VStack>
  );
}

/* ---------- Checked text with highlights ---------- */

/**
 * The exact text the run checked, with each finding's span marked. Offsets
 * are Unicode code points (backend convention). Marks are focusable so
 * "Show in text" can move keyboard and screen-reader focus to them.
 */
export function EvidenceText({ text, findings, selected }: { text: string; findings: Finding[]; selected: number | null }) {
  const segments = useMemo(
    () => segmentByCodePoints(text, findings.flatMap((f, i) => (f.text_span ? [{ key: i, span: f.text_span }] : []))),
    [text, findings],
  );
  if (!text) return <Text type="body" color="secondary">The checked text is empty.</Text>;
  const target = selected == null ? -1 : segments.findIndex((s) => s.keys.includes(selected));
  return (
    <Text type="body" wordBreak="break-word" as="p">
      {segments.map((s, n) => {
        if (!s.keys.length) return <span key={n}>{s.text}</span>;
        const worst = s.keys.map((k) => findings[k].severity).sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b))[0];
        const first = s.keys[0];
        const isSelected = selected != null && s.keys.includes(selected);
        return (
          <mark key={n} id={n === target ? findingKey(selected!) : undefined}
            tabIndex={n === target ? -1 : undefined}
            className={cn(SEVERITY[worst].mark, isSelected && 'mark-selected')}
            aria-label={`${SEVERITY[worst].label} finding ${findings[first].rule_id}: ${s.text}`}>
            {s.text}
          </mark>
        );
      })}
    </Text>
  );
}
