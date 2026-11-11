import { useMemo, useState } from 'react';
import { Link as AxLink } from '@astryxdesign/core/Link';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { Heading, Text } from '@astryxdesign/core/Text';
import { List, ListItem } from '@astryxdesign/core/List';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { creativesApi, latestValidation, type BriefText, type Creative, type CreativeVersionPage } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { isInProgress, unassessedMandatory } from '@/api/validations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Alert, SkeletonRows } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { diffWords, isUnchanged } from '@/lib/diff';
import { fmtDateTime } from '@/lib/utils';
import { useValidationRun } from '@/pages/validation/useValidation';

type Version = CreativeVersionPage['items'][number];

/* ---------- Version timeline (NRC-22) ---------- */

/**
 * Every saved version, newest first, with who saved it and what validation
 * said about that exact version. Versions are never changed: "Use this text"
 * copies an older text into the editor, and saving it makes a new version.
 */
export function VersionHistory({ creative, current, onRestore, readOnly }: {
  creative: Creative;
  /** The text in the editor now (may be unsaved). */
  current: BriefText;
  onRestore: (v: Version) => void;
  readOnly: boolean;
}) {
  const { context } = useSession();
  const q = useInfiniteQuery({
    queryKey: ['creative-versions', context.tenant.tenant_id, creative.id, creative.version],
    queryFn: ({ pageParam, signal }) => creativesApi.versions(creative.id, { cursor: pageParam, limit: 10, signal }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const [compare, setCompare] = useState<Version | null>(null);
  const versions = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHead title="Versions" icon="clock" />
      {q.isPending ? (
        <CardBody><SkeletonRows rows={3} /></CardBody>
      ) : q.isError ? (
        <CardBody>
          {isApiError(q.error) && q.error.kind === 'not_implemented'
            ? <Text type="body" color="secondary">Version history is not available yet.</Text>
            : <Alert tone="blocked" title="Versions could not be loaded" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>} />}
        </CardBody>
      ) : (
        <>
          <List hasDividers aria-label="Saved versions, newest first">
            {versions.map((v) => (
              <ListItem key={v.version} align="start"
                label={(
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text type="body" weight="semibold">Version {v.version}</Text>
                    {v.version === creative.version && <Badge variant="brand">Current</Badge>}
                    {v.version === 1 && <Badge>First brief</Badge>}
                  </HStack>
                )}
                description={(
                  <VStack gap={1} hAlign="start">
                    <Text type="supporting" color="secondary">Saved {fmtDateTime(v.created_at)} by {v.created_by}</Text>
                    <Button size="sm" variant="ghost" icon="eye" onClick={() => setCompare(v)}
                      aria-label={`Compare version ${v.version} with the text now`}>Compare with now</Button>
                  </VStack>
                )}
                endContent={<ValidationOf creative={creative} version={v.version} />} />
            ))}
          </List>
          {q.hasNextPage && (
            <CardFoot>
              <Button size="sm" variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show older versions</Button>
            </CardFoot>
          )}
        </>
      )}
      {compare && (
        <CompareDialog version={compare} current={current} readOnly={readOnly}
          onClose={() => setCompare(null)}
          onRestore={() => { onRestore(compare); setCompare(null); }} />
      )}
    </Card>
  );
}

/** What validation said about one exact version, from CreativeRead.validation_runs. */
function ValidationOf({ creative, version }: { creative: Creative; version: number }) {
  const run = (creative.validation_runs ?? []).find((r) => r.creative_version === version);
  if (!run) return <Badge>Not validated</Badge>;
  if (isInProgress(run.state)) return <Badge variant="brand">Checking</Badge>;
  if (run.state === 'FAILED' || run.state === 'CANCELLED') return <Badge variant="blocked">Check did not finish</Badge>;
  if (run.outcome === 'PASS') return <Badge variant={run.is_current ? 'done' : 'neutral'}>Passed{run.is_current ? '' : ' (old)'}</Badge>;
  if (run.outcome === 'FAIL') return <Badge variant="blocked">Failed</Badge>;
  return <Badge variant="waiting">Needs review</Badge>;
}

/* ---------- Compare ---------- */

function CompareDialog({ version, current, readOnly, onClose, onRestore }: {
  version: Version;
  current: BriefText;
  readOnly: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const old: BriefText = { prompt: version.current_prompt, caption: version.caption ?? '' };
  const same = old.prompt === current.prompt && old.caption === current.caption;
  return (
    <Modal open onClose={onClose} size="xl" icon="eye" title={`Version ${version.version} compared with the text now`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!readOnly && !same && (
            <Button variant="primary" onClick={onRestore}>Use version {version.version} text</Button>
          )}
        </>
      )}>
      <VStack gap={4}>
        <Text type="body" color="secondary">
          <span className="diff-del">Removed</span> words are in version {version.version} only;{' '}
          <span className="diff-ins">added</span> words are in the text now. Nothing changes until you choose.
        </Text>
        <DiffBlock label="Brief" before={old.prompt} after={current.prompt} />
        <DiffBlock label="Caption" before={old.caption} after={current.caption} />
        {!readOnly && !same && (
          <Text type="supporting" color="secondary">Using an older text puts it in the editor. It saves as a new version; version {version.version} itself stays as it was.</Text>
        )}
      </VStack>
    </Modal>
  );
}

function DiffBlock({ label, before, after }: { label: string; before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <section aria-label={`${label} differences`}><VStack gap={2}>
      <Heading level={3}>{label}</Heading>
      {isUnchanged(parts) ? (
        <Text type="body" color="secondary">No change{before ? '' : ' (empty in both)'}.</Text>
      ) : (
        <AxCard variant="muted" padding={3}><Text type="body" wordBreak="break-word" as="p">
          {parts.map((p, i) => p.kind === 'same'
            ? <span key={i}>{p.text}</span>
            : p.kind === 'removed'
              ? <del key={i} className="diff-del"><VisuallyHidden>removed: </VisuallyHidden>{p.text}</del>
              : <ins key={i} className="diff-ins"><VisuallyHidden>added: </VisuallyHidden>{p.text}</ins>)}
        </Text></AxCard>
      )}
    </VStack></section>
  );
}

/* ---------- Findings to fix ---------- */

/**
 * The findings from the latest validation, beside the editor, so a creator can
 * fix them in place. They describe the version that was checked; after an
 * edit they are a to-do list, not a result.
 */
export function FindingsToFix({ creative, editing }: { creative: Creative; editing: boolean }) {
  const latest = latestValidation(creative);
  if (!latest || isInProgress(latest.state) || latest.state === 'FAILED' || latest.state === 'CANCELLED' || latest.outcome === 'PASS') return null;
  return <FindingsToFixList creative={creative} runId={latest.validation_run_id} editing={editing} />;
}

function FindingsToFixList({ creative, runId, editing }: { creative: Creative; runId: string; editing: boolean }) {
  const q = useValidationRun(runId);
  const run = q.data;
  if (!run) return null;
  const unassessed = unassessedMandatory(run);
  if (!run.findings.length && !unassessed.length) return null;
  const older = editing || run.creative_version !== creative.version;
  return (
    <section aria-label="Findings to fix"><VStack gap={2}><Divider />
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="body" weight="semibold">To fix from the last validation</Text>
        <Text type="supporting" color="secondary">version {run.creative_version}</Text>
        <StackItem size="fill">{null}</StackItem>
        <AxLink href={`/marketing/validation/${encodeURIComponent(creative.id)}/${encodeURIComponent(runId)}`}>Evidence</AxLink>
      </HStack>
      {older && <Text type="body" color="secondary">These are for version {run.creative_version}. After your changes, validate again to see what is still open.</Text>}
      <List listStyle="disc" density="compact">
        {unassessed.map((r) => <ListItem key={r.rule_id} label={r.reason ?? `${r.rule_id} could not be assessed.`} />)}
        {run.findings.map((f, i) => (
          <ListItem key={i}
            label={<>{f.offending_excerpt && <><q>{f.offending_excerpt}</q>: </>}{f.explanation}</>}
            description={f.suggested_correction ? `Suggested: ${f.suggested_correction}` : undefined} />
        ))}
      </List>
    </VStack></section>
  );
}
