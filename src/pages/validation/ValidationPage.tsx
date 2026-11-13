import { SIMULATION_BUILD } from '@/config/env';
import { z } from 'zod';
import { useNow } from '@/lib/useNow';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { VStack } from '@astryxdesign/core/Layout';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, useSession } from '@/auth/AuthProvider';
import { isPlaceholderImage, useAsset } from '@/api/assets';
import { creativesApi } from '@/api/creatives';
import { ruleLookup, useActivePolicy } from '@/api/policy';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { isApiError } from '@/api/errors';
import { http } from '@/api/http';
import { isInProgress } from '@/api/validations';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Alert, EmptyState, PageHeader, SkeletonRows, TwoColumn } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { Grid } from '@astryxdesign/core/Grid';
import { List, ListItem } from '@astryxdesign/core/List';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { DraftSummary } from '@/api/workspace';
import { Tabs } from '@/components/ui/Misc';
import { useDrafts } from '@/pages/shared/queries';
import { InDevelopment, QueryState, ReviewBadge, StatCard, ValidationBadge, relTime } from '@/pages/shared/ui';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { EvidenceText, FindingsList, findingKey, KIND_WORD, regionWords, RunSummary, Verdict } from './parts';
import { useStartValidation, useValidationRun } from './useValidation';

/** /marketing/validation (how to start) and /marketing/validation/:creativeId/:runId (one run's results). */
export default function ValidationPage(): ReactElement {
  return (
    <Routes>
      <Route index element={<Start />} />
      <Route path=":creativeId/:runId" element={<Workspace />} />
    </Routes>
  );
}

const VALIDATION_FILTERS = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'passed', label: 'Passed' },
  { id: 'all', label: 'All drafts' },
] as const;
type ValidationFilter = (typeof VALIDATION_FILTERS)[number]['id'];
const NEEDS_ATTENTION = new Set<DraftSummary['validation']>(['FAIL', 'NEEDS_REVIEW', 'STALE', 'NOT_RUN', 'RUNNING']);

function Start() {
  // The backend has no draft list yet (config/inDevelopment.ts): do not call it.
  const drafts = useDrafts(!IN_DEVELOPMENT.draftList);
  const [filter, setFilter] = useState<ValidationFilter>('attention');
  const all = drafts.data ?? [];
  const pick = (f: ValidationFilter) => all.filter((d) => f === 'all' || (f === 'passed' ? d.validation === 'PASS' : NEEDS_ATTENTION.has(d.validation)));
  const rows = pick(filter);
  const n = (v: DraftSummary['validation']) => all.filter((d) => d.validation === v).length;
  const now = useNow();
  const columns = useMemo(() => validationColumns(now), [now]);

  if (IN_DEVELOPMENT.draftList) {
    return (
      <VStack gap={6}>
        <PageHeader title="Validation" description="Automated checks of a brief against the approved study facts and the policy rules, with the evidence for each finding." />
        <InDevelopment feature="Drafts overview" description="A list of every draft with its latest check is being built and will be available soon. To validate, open a draft in Create post and choose Validate; its results open here." />
      </VStack>
    );
  }

  return (
    <VStack gap={6}>
      <PageHeader title="Validation" description="Automated checks of a brief against the approved study facts and the policy rules, with the evidence for each finding." />
      <Grid columns={{ minWidth: 180, repeat: 'fill' }} gap={4}>
        <StatCard label="Passed" value={n('PASS')} icon="check" tone="done" />
        <StatCard label="Failed" value={n('FAIL')} icon="x" tone="blocked" />
        <StatCard label="Needs a person" value={n('NEEDS_REVIEW')} icon="eye" tone="waiting" />
        <StatCard label="Not checked yet" value={n('NOT_RUN') + n('STALE')} icon="clock" tone="brand" />
      </Grid>
      <Card>
        <>
          <Tabs<ValidationFilter> value={filter} onChange={setFilter}
            tabs={VALIDATION_FILTERS.map((f) => ({ id: f.id, label: f.label, count: pick(f.id).length }))} />
        </>
        <QueryState query={drafts} what="your drafts">
          {() => rows.length
            ? <><Table<DraftSummary> data={rows} columns={columns} idKey="id" hasHover /></>
            : <EmptyState icon="shield" title={filter === 'attention' ? 'Nothing needs attention' : 'No drafts here'}
                description="Open a saved draft in Create and choose Validate. Its results open here."
                action={<Button variant="secondary" href="/marketing/create">Go to Create post</Button>} />}
        </QueryState>
      </Card>
    </VStack>
  );
}

const validationColumns = (now: number): TableColumn<DraftSummary>[] => [
  {
    key: 'prompt_preview', header: 'Brief', width: proportional(3, { minWidth: 240 }),
    renderCell: (d) => (
      <VStack gap={0.5}>
        <Link to={`/marketing/create/${encodeURIComponent(d.id)}`}>{d.prompt_preview}</Link>
        <Text type="supporting" display="block">{d.study_title} · version {d.version} · {d.created_by}</Text>
      </VStack>
    ),
  },
  { key: 'validation', header: 'Validation', width: pixel(160), renderCell: (d) => <ValidationBadge value={d.validation} /> },
  { key: 'review', header: 'Review', width: pixel(170), renderCell: (d) => <ReviewBadge value={d.review} /> },
  { key: 'updated_at', header: 'Updated', width: pixel(120), renderCell: (d) => <Text type="supporting">{relTime(d.updated_at, now)}</Text> },
];

function Workspace() {
  const { creativeId = '', runId = '' } = useParams();
  const { context } = useSession();
  const { can, mode } = useAuth();
  const { toast } = useToast();
  const run = useValidationRun(runId);
  // Its own cache entry: the draft page must never open its editor from a copy
  // taken while this run was still in progress.
  const draft = useQuery({
    queryKey: ['creative-for-validation', context.tenant.tenant_id, creativeId],
    queryFn: ({ signal }) => creativesApi.get(creativeId, signal),
    staleTime: 0,
  });
  const creative = draft.data?.creative;
  const r = run.data;

  // The exact text this run checked: the current version, or that version from the history.
  // A version's text never changes, so the version number identifies it; `creative` is only the way to read it.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- see the line above
  const checked = useQuery({
    queryKey: ['creative-version-text', context.tenant.tenant_id, creativeId, r?.creative_version],
    // enabled guarantees creative and r are set when this runs.
    queryFn: ({ signal }) => creativesApi.versionText(creative!, r!.creative_version, signal),
    enabled: !!creative && !!r && r.input_kind !== 'image',
    staleTime: Infinity,
  });
  const checkedText = checked.data ? (r?.input_kind === 'text' ? checked.data.caption : checked.data.prompt) : null;
  // The exact picture an image run checked, and the rules its findings cite.
  const image = useAsset(r?.input_kind === 'image' ? r.asset_id : null);
  const policy = useActivePolicy();
  const policyName = r && context.active_policy?.version === r.policy_bundle_version ? context.active_policy.name : undefined;

  // A run that finished changes the draft's readiness: refresh it.
  const finished = r ? !isInProgress(r.state) : false;
  useEffect(() => { if (finished) void draft.refetch(); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (selected == null) return;
    const el = document.getElementById(findingKey(selected));
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, [selected]);

  const { start, starting } = useStartValidation();
  const stale = !!r && !!creative && (!r.is_current || r.creative_version !== creative.version);
  const study = creative && context.studies.find((s) => s.study_id === creative.study_id);
  const canValidate = can('validation:run') && study?.recruitment_status === 'recruiting';

  const crumbs = [{ label: 'Validation', to: '/marketing/validation' }, { label: 'Results' }];
  const draftLink = `/marketing/create/${encodeURIComponent(creativeId)}`;

  if (run.isError || draft.isError) {
    const e = run.error ?? draft.error;
    const notFound = isApiError(e) && (e.kind === 'not_found' || e.kind === 'forbidden');
    return (
      <VStack gap={6}>
        <PageHeader title="Validation results" crumbs={crumbs} />
        <Card>
          {notFound ? (
            <EmptyState icon="search" title="Validation run not found" description="It does not exist, or it is not available to you in this organisation." />
          ) : (
            <>
              <Alert tone="blocked" title="The results could not be loaded"
                action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => { void run.refetch(); void draft.refetch(); }}>Try again</Button>}>
                {isApiError(e) ? e.message : 'Try again in a moment.'}
              </Alert>
            </>
          )}
        </Card>
      </VStack>
    );
  }

  if (!r || !creative) {
    return (
      <VStack gap={6}>
        <PageHeader title="Validation results" crumbs={crumbs} />
        <Card><SkeletonRows rows={5} /><VisuallyHidden><span role="status">Loading the results</span></VisuallyHidden></Card>
      </VStack>
    );
  }

  const simulate = async (mode: 'timeout' | 'extraction') => {
    await http.post('/__sim/fail-next-validation', z.unknown(), { mode });
    toast(mode === 'timeout' ? 'The next validation will time out' : 'The next validation cannot read the text', 'waiting');
  };

  return (
    <VStack gap={6}>
      <PageHeader title="Validation results" crumbs={crumbs}
        actions={(
          <>
            <Button variant="secondary" href={draftLink}>Revise the brief</Button>
            {canValidate && (stale || r.state === 'FAILED' || r.state === 'CANCELLED') && (
              <Button variant="primary" loading={starting} onClick={() => void start(creative, r.input_kind, r.asset_id)}>
                Validate version {creative.version}
              </Button>
            )}
          </>
        )} />

      <VisuallyHidden><span role="status" aria-live="polite">
        {isInProgress(r.state) ? `Checking the ${KIND_WORD[r.input_kind]}` : 'Validation finished'}
      </span></VisuallyHidden>
      <Verdict run={r} stale={stale} />

      <TwoColumn mainLabel="Validation summary" sideLabel="Findings">
        <VStack gap={6}>
          <Card>
            <CardHead title="Summary" icon="shield" regulatory />
            <CardBody><RunSummary run={r} currentVersion={creative.version} stale={stale} policyName={policyName} /></CardBody>
          </Card>
          <Card>
            <CardHead title={`Checked ${KIND_WORD[r.input_kind]}`} />
            <CardBody>
              {r.input_kind === 'image'
                ? (
                  <VStack gap={3}>
                    {image.isPending && <SkeletonRows rows={4} />}
                    {image.isError && <Alert tone="waiting" title="The image could not be loaded">Findings are listed with the area they point to.</Alert>}
                    {image.data?.download_url && (
                      <AspectRatio ratio={image.data.width_px / image.data.height_px} fit="contain">
                        <img src={image.data.download_url}
                          alt={`The visual that was checked${isPlaceholderImage(image.data) ? ' (a placeholder, not generated)' : ''}`} />
                      </AspectRatio>
                    )}
                    {image.data && (
                      <Text type="supporting" color="secondary">
                        {image.data.width_px}×{image.data.height_px}
                        {isPlaceholderImage(image.data) && ' · placeholder picture from the staging service, not a generated image'}
                      </Text>
                    )}
                    {r.findings.filter((f) => f.image_region).map((f, i) => (
                      <Text key={i} type="body" wordBreak="break-word">
                        <Text type="body" weight="semibold">{f.rule_id}</Text> points to this area: {regionWords(f.image_region!)}
                      </Text>
                    ))}
                  </VStack>
                )
                : checked.isError
                  ? <Alert tone="waiting" title="The checked text could not be loaded">Findings are listed without highlights.</Alert>
                  : checkedText == null
                    ? <SkeletonRows rows={2} />
                    : <EvidenceText text={checkedText} findings={r.findings} selected={selected} />}
            </CardBody>
          </Card>
          {r.coverage_gaps.length > 0 && r.state !== 'FAILED' && (
            <Card>
              <CardHead title="Not assessed" icon="info" />
              <CardBody>
                <List listStyle="disc" density="compact">
                  {r.coverage_gaps.map((g, i) => <ListItem key={i} label={g.reason} description={g.rule_id ?? undefined} />)}
                </List>
              </CardBody>
            </Card>
          )}
        </VStack>

        <VStack gap={4}>
          <Card>
            <CardHead title="Findings" icon="flag" />
            {isInProgress(r.state)
              ? <CardBody><Text type="body" color="secondary">Findings appear when the run finishes.</Text></CardBody>
              : <FindingsList findings={r.findings} selected={selected} onSelect={setSelected} canShowInText={checkedText != null} ruleOf={ruleLookup(policy.data)} />}
          </Card>
          {SIMULATION_BUILD && mode === 'simulation' && canValidate && (
            <Card>
              <CardHead title="Simulation tools" icon="warn" />
              <CardBody>
                <Button variant="ghost" size="sm" onClick={() => void simulate('timeout')}>Make the next validation time out</Button>
                <Button variant="ghost" size="sm" onClick={() => void simulate('extraction')}>Make the next validation unreadable</Button>
              </CardBody>
            </Card>
          )}
        </VStack>
      </TwoColumn>
    </VStack>
  );
}
