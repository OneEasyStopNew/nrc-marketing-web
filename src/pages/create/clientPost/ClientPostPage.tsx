import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Heading, Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useAuth, useSession } from '@/auth/AuthProvider';
import {
  CLIENT_CAPTION_MAX, MAX_UPLOAD_BYTES, applySuggestion, checkIsCurrent, clientPostsApi, localPreview, newClientKey,
  type CheckPart, type ClientCheck, type ClientMedia, type ClientPost, type PartFinding, type VersionedPost,
} from '@/api/clientPosts';
import { isApiError } from '@/api/errors';
import { isInProgress } from '@/api/validations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Form';
import { Alert, EmptyState, PageHeader, SkeletonRows, TwoColumn } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { saveFile } from '@/lib/download';
import { charCount, fmtDateTime } from '@/lib/utils';
import { ExecutionBadge, EvidenceText, FindingsList, OutcomeBadge, findingKey } from '@/pages/validation/parts';
import { formatLabel, languageLabel } from '../parts';
import { clientCheckReport } from './report';
import { ClientVersions } from './Versions';
import { AiFixAction } from './AiFix';
import { CarouselOrder } from './CarouselOrder';
import { useAiFixAvailable } from './useClientPost';
import { Wrap } from './Wrap';
import { postKey, useClientPost, useLatestCheck, useStartCheck } from './useClientPost';

const CRUMBS = [{ label: 'Create post', to: '/marketing/create' }, { label: 'Checked post' }];

/** /marketing/create/check/:postId: one client post, its latest check, fixes and download (NRC-41). */
export function ClientPostPage(): ReactElement {
  const { postId = '' } = useParams();
  const q = useClientPost(postId);
  const checkQ = useLatestCheck(postId);

  if (q.isError) {
    const notFound = isApiError(q.error) && (q.error.kind === 'not_found' || q.error.kind === 'forbidden');
    return (
      <Page>
        <Card>
          {notFound
            ? <EmptyState icon="search" title="Post not found" description="It does not exist, or it is not available to you in this organisation."
                action={<Button variant="secondary" size="sm" href="/marketing/create/check">Check another post</Button>} />
            : <Alert tone="blocked" title="The post could not be loaded"
                action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>}>
                {isApiError(q.error) ? q.error.message : 'Try again in a moment.'}
              </Alert>}
        </Card>
      </Page>
    );
  }
  if (!q.data) {
    return <Page><Card><SkeletonRows rows={5} /><VisuallyHidden><span role="status">Loading the post</span></VisuallyHidden></Card></Page>;
  }
  return <Loaded versioned={q.data} check={checkQ.data ?? null} checkLoading={checkQ.isPending} checkError={checkQ.isError} />;
}

function Page({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <VStack gap={6}>
      <PageHeader title="Checked post" crumbs={CRUMBS} actions={actions}
        badge={<Badge variant="regulatory">Validation only</Badge>} />
      {children}
    </VStack>
  );
}

function Loaded({ versioned, check, checkLoading, checkError }: {
  versioned: VersionedPost; check: ClientCheck | null; checkLoading: boolean; checkError: boolean;
}) {
  const { post, etag } = versioned;
  const { context } = useSession();
  const { can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { start, starting } = useStartCheck(post.id);
  const [saving, setSaving] = useState(false);
  const study = context.studies.find((s) => s.study_id === post.study_id);
  const running = !!check && isInProgress(check.state);
  const current = checkIsCurrent(post, check ?? undefined);
  const finished = !!check && !running;
  const canWrite = can('creative:write');

  /** Saves a new version; the old check stops being current. */
  const saveVersion = async (body: { caption?: string | null; asset_ids?: string[]; change_note: string }) => {
    setSaving(true);
    try {
      const next = await clientPostsApi.update(post.id, etag, body);
      qc.setQueryData(postKey(context.tenant.tenant_id, post.id), next);
      toast(`Saved as version ${next.post.version}`, 'done', 'Check this version to see if the fix worked.');
      return true;
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.code === 'VERSION_CONFLICT') {
        toast('Someone changed this post', 'waiting', 'The latest version is loaded. Nothing was overwritten.');
        void qc.invalidateQueries({ queryKey: postKey(context.tenant.tenant_id, post.id) });
      } else toast('The change could not be saved', 'blocked', e.retryable ? 'Try again in a moment.' : e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!check) return;
    const html = clientCheckReport(post, check, study?.study_title ?? 'Study not available');
    saveFile(`check-report-v${post.version}.html`, new Blob([html], { type: 'text/html' }));
    if (post.caption) saveFile(`caption-v${post.version}.txt`, new Blob([post.caption], { type: 'text/plain' }));
  };

  const needsCheck = !check || !current || check.state === 'FAILED' || check.state === 'CANCELLED';

  return (
    <Page actions={(
      <>
        {current && finished && (
          <Button variant="secondary" icon="dl" onClick={download}>Download post and report</Button>
        )}
        {needsCheck && can('validation:run') && (
          <Button variant="primary" icon="shield" loading={starting} disabled={running || saving} onClick={() => void start(post.version)}>
            Check version {post.version}
          </Button>
        )}
      </>
    )}>
      <VisuallyHidden><span role="status" aria-live="polite">{running ? 'Checking the post' : finished ? 'Check finished' : ''}</span></VisuallyHidden>
      <Verdict post={post} check={check} loading={checkLoading} error={checkError} />

      <TwoColumn mainLabel="The post and its findings" sideLabel="Summary">
        <VStack gap={6}>
          <CaptionCard key={post.version} post={post} part={current ? check?.parts.find((p) => p.target === 'caption') : undefined}
            canEdit={canWrite} saving={saving} onSave={saveVersion} />
          <CarouselOrder key={`order-${post.version}`} post={post} canEdit={canWrite} saving={saving} onSave={saveVersion} />
          {post.media.map((m, i) => (
            <MediaCard key={m.asset_id} post={post} media={m} index={i}
              part={current ? check?.parts.find((p) => p.asset_id === m.asset_id) : undefined}
              canEdit={canWrite} saving={saving} onSave={saveVersion} />
          ))}
          {current && finished && <NotAssessed post={post} parts={check.parts} />}
        </VStack>

        <VStack gap={4}>
          <Summary post={post} check={check} current={current} studyTitle={study?.study_title} />
          <ClientVersions post={post} check={check} canEdit={canWrite} saving={saving} onSave={saveVersion} />
        </VStack>
      </TwoColumn>
    </Page>
  );
}

/* ---------- Verdict ---------- */

const unassessedMandatory = (parts: CheckPart[]) =>
  parts.flatMap((p) => p.rule_results.filter((r) => r.mandatory && r.result === 'UNABLE_TO_ASSESS'));

/** A part's result. A PASS with something left unassessed is never shown as a plain pass. */
function PartBadge({ part }: { part: CheckPart }) {
  if (part.outcome === 'PASS' && part.coverage_gaps.length) return <Badge variant="waiting">Partly assessed</Badge>;
  return <OutcomeBadge outcome={part.outcome} />;
}

/**
 * One line on where the post stands. "Passed" only when the check is for this
 * version, it finished with PASS, every part passed and nothing required went
 * unassessed. Never "approved".
 */
function Verdict({ post, check, loading, error }: { post: ClientPost; check: ClientCheck | null; loading: boolean; error: boolean }) {
  if (loading) return <SkeletonRows rows={1} />;
  if (error) return <Alert tone="waiting" title="The latest check could not be loaded">Reload the page to try again.</Alert>;
  if (!check) return <Alert tone="info" title="Not checked yet">Check version {post.version} to see findings for the caption and every file.</Alert>;
  if (isInProgress(check.state)) {
    return <Alert tone="info" icon="clock" title="Checking the caption and files">Results appear here when the check finishes. You can leave this page; the check continues.</Alert>;
  }
  if (check.state === 'FAILED' || check.state === 'CANCELLED') {
    return <Alert tone="blocked" title="The check could not finish">Nothing was assessed. Check again; this is not a result about the post.</Alert>;
  }
  if (!checkIsCurrent(post, check)) {
    return (
      <Alert tone="waiting" title="The post changed after its last check">
        The last check was for version {check.post_version}; the post is now version {post.version}. Check the new version before using it.
      </Alert>
    );
  }
  const unassessed = unassessedMandatory(check.parts);
  const allPassed = check.outcome === 'PASS' && check.parts.length > 0 && check.parts.every((p) => p.outcome === 'PASS') && !unassessed.length;
  const gaps = check.parts.some((p) => p.coverage_gaps.length > 0);
  return (
    <VStack gap={3}>
      {unassessed.length > 0 && (
        <Alert tone="blocked" title="A required check could not be assessed">
          {unassessed.map((r) => r.reason ?? `${r.rule_id} could not be assessed.`).join(' ')} The post cannot pass until it is.
        </Alert>
      )}
      {allPassed && !gaps && <Alert tone="done" title="Passed the assessed checks">For version {post.version}. This is not approval; a reviewer still decides.</Alert>}
      {allPassed && gaps && (
        <Alert tone="waiting" title="Passed what could be assessed">
          For version {post.version}, some parts were not assessed (see Not assessed below). A person must review those before the post is used. This is not approval.
        </Alert>
      )}
      {check.outcome === 'FAIL' && <Alert tone="blocked" title="Failed">Fix the findings below, then check the new version.</Alert>}
      {check.outcome === 'NEEDS_REVIEW' && !unassessed.length && <Alert tone="waiting" title="Needs review">A person needs to decide on the findings marked below.</Alert>}
    </VStack>
  );
}

/* ---------- Caption ---------- */

function CaptionCard({ post, part, canEdit, saving, onSave }: {
  post: ClientPost;
  part: CheckPart | undefined;
  canEdit: boolean;
  saving: boolean;
  onSave: (body: { caption: string | null; change_note: string }) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.caption ?? '');
  // A new version remounts this card (key={post.version}), so the edit box and discarded fixes start fresh.
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (selected == null) return;
    const el = document.getElementById(findingKey(selected));
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }, [selected]);

  const caption = post.caption ?? '';
  const fixes = (part?.findings ?? []).map((f, i) => ({ f, i, after: applySuggestion(caption, f) }))
    .filter((x): x is { f: PartFinding; i: number; after: string } => x.after != null && !dismissed.has(x.i));
  const over = charCount(text) > CLIENT_CAPTION_MAX;

  return (
    <Card>
      <CardHead title="Caption" icon="doc" badge={part ? <PartBadge part={part} /> : undefined}>
        {canEdit && !editing && <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(true)}>Edit by hand</Button>}
      </CardHead>
      <CardBody>
        {editing ? (
          <VStack gap={3}>
            <Textarea label="Caption" rows={5} value={text} limit={CLIENT_CAPTION_MAX} onChange={(e) => setText(e.target.value)}
              help="Saving makes a new version. The original stays in the history." />
            <HStack gap={2}>
              <Button variant="secondary" loading={saving} disabled={over || text === caption}
                onClick={() => void onSave({ caption: text.trim() ? text : null, change_note: 'Caption: edited by hand' })}>
                Save as version {post.version + 1}
              </Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setText(caption); }}>Cancel</Button>
            </HStack>
          </VStack>
        ) : caption
          ? <EvidenceText text={caption} findings={part?.findings ?? []} selected={selected} />
          : <Text type="body" color="secondary">No caption. Only the files are checked.</Text>}

        {!editing && fixes.map(({ f, i, after }) => (
          <VStack key={i} gap={2}>
            <Heading level={4}>Suggested fix for {f.rule_id}</Heading>
            <Text type="body" color="secondary" wordBreak="break-word">{f.explanation}</Text>
            <Grid columns={{ minWidth: 240 }} gap={3}>
              <Compare title={`Now (version ${post.version})`} text={caption} />
              <Compare title="With the fix" text={after} proposed />
            </Grid>
            {canEdit && (
              <HStack gap={2}>
                <Button variant="secondary" icon="check" loading={saving}
                  onClick={() => void onSave({ caption: after, change_note: `Caption: accepted the suggested fix for ${f.rule_id}` })}>
                  Accept as version {post.version + 1}
                </Button>
                <Button variant="ghost" onClick={() => setDismissed((d) => new Set(d).add(i))}>Discard</Button>
              </HStack>
            )}
          </VStack>
        ))}

        {part && part.findings.length > 0 && (
          <FindingsList findings={part.findings} selected={selected} onSelect={setSelected} canShowInText={!!caption} />
        )}
      </CardBody>
    </Card>
  );
}

function Compare({ title, text, proposed }: { title: string; text: string; proposed?: boolean }) {
  return (
    <AxCard padding={4} variant={proposed ? 'blue' : 'default'}>
      <VStack gap={1}>
        {/* Full-strength text: small grey text is too faint on the tinted card in dark mode. */}
        <Text type="body" weight="semibold">{title}</Text>
        <Text type="body" wordBreak="break-word">{text || 'Empty'}</Text>
      </VStack>
    </AxCard>
  );
}

/* ---------- Files ---------- */

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function MediaCard({ post, media, index, part, canEdit, saving, onSave }: {
  post: ClientPost;
  media: ClientMedia;
  index: number;
  part: CheckPart | undefined;
  canEdit: boolean;
  saving: boolean;
  onSave: (body: { asset_ids: string[]; change_note: string }) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const label = `${media.kind === 'video' ? 'Video' : `Image ${post.media.length > 1 ? index + 1 : ''}`.trim()}: ${media.file_name}`;
  // The file as this tab uploaded it, else the server's preview.
  const ownFile = localPreview(media.asset_id);
  const previewSrc = ownFile ?? media.preview_url;
  const ratio = media.width_px && media.height_px ? media.width_px / media.height_px : 1;
  const { can } = useAuth();
  const aiFixAvailable = useAiFixAvailable();
  // Only a flagged image of the current, finished check, and only for roles that may generate.
  const canFixWithAi = aiFixAvailable && can('generation:run') && media.kind === 'image' && !!part && part.findings.length > 0;

  const replace = async (file: File) => {
    setUploading(true);
    try {
      const next = await clientPostsApi.upload(file, newClientKey('upload'));
      if (next.state !== 'READY') {
        toast('This file cannot be used', 'blocked', next.state_reason ?? 'Choose another file.');
        return;
      }
      if (next.kind !== media.kind) {
        toast(`Choose ${media.kind === 'video' ? 'a video' : 'an image'}`, 'waiting', `A replacement must be the same kind of file as ${media.file_name}.`);
        return;
      }
      await onSave({
        asset_ids: post.media.map((m) => (m.asset_id === media.asset_id ? next.asset_id : m.asset_id)),
        change_note: `Replaced ${media.file_name} with ${next.file_name}`,
      });
    } catch (e) {
      toast('The upload did not finish', 'blocked', isApiError(e) ? e.message : 'Try again in a moment.');
    } finally {
      setUploading(false);
    }
  };

  const timed = (part?.findings ?? []).filter((f) => f.time_range);

  return (
    <Card>
      <CardHead title={label} icon={media.kind === 'video' ? 'play' : 'img'} badge={part ? <PartBadge part={part} /> : undefined} />
      <CardBody>
        {ownFile && media.kind === 'video' ? (
          <AspectRatio ratio={ratio} fit="contain">
            <video src={ownFile} controls muted playsInline preload="metadata" aria-label={label} />
          </AspectRatio>
        ) : previewSrc ? (
          <AspectRatio ratio={ratio} fit="contain">
            <img src={previewSrc} alt={`${label}${media.kind === 'video' ? ' (still picture of the video)' : ''}`} loading="lazy" decoding="async" />
          </AspectRatio>
        ) : <Text type="body" color="secondary">No preview available.</Text>}
        <Text type="supporting" color="secondary">
          {media.width_px}×{media.height_px}{media.duration_s != null && ` · ${media.duration_s} s`} · {media.mime_type}
        </Text>

        {timed.length > 0 && (
          <List hasDividers density="compact" aria-label="Where in the video">
            {timed.map((f, i) => (
              <ListItem key={i} label={`${time(f.time_range!.start_s)} to ${time(f.time_range!.end_s)}`} description={<Wrap secondary>{f.rule_id}: {f.explanation}</Wrap>} />
            ))}
          </List>
        )}
        {part && (part.findings.length > 0
          ? <FindingsList findings={part.findings} selected={null} onSelect={() => undefined} canShowInText={false} />
          : <Text type="body" color="secondary">No findings were reported for this file. This alone does not mean it passed; see the result above.</Text>)}

        {canEdit && (
          <VStack gap={2}>
            <FileInput label="Replace this file" value={null} accept={media.kind === 'video' ? 'video/*' : 'image/*'} maxSize={MAX_UPLOAD_BYTES}
              isLoading={uploading} isDisabled={saving || uploading}
              description="Upload a corrected file. It becomes a new version; the original stays in the history."
              onChange={(f) => { const file = Array.isArray(f) ? f[0] : f; if (file) void replace(file); }} />
            {canFixWithAi && part ? (
              <VStack gap={1} hAlign="start">
                <AiFixAction post={post} media={media} part={part} nowSrc={previewSrc} saving={saving} onSave={onSave} />
                <Text type="supporting" color="secondary">Optional and paid. You confirm the cost before anything is made.</Text>
              </VStack>
            ) : (
              <Text type="supporting" color="secondary">Nothing is generated while checking.</Text>
            )}
          </VStack>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------- Not assessed and summary ---------- */

/** What the check could not assess: one line per reason, naming the parts it applies to. */
function NotAssessed({ post, parts }: { post: ClientPost; parts: CheckPart[] }) {
  const nameOf = (p: CheckPart) => {
    if (p.target === 'caption') return 'the caption';
    const i = post.media.findIndex((m) => m.asset_id === p.asset_id);
    return i < 0 ? 'a file' : post.media[i].kind === 'video' ? 'the video' : post.media.length > 1 ? `image ${i + 1}` : 'the image';
  };
  const byReason = new Map<string, { reason: string; rule_id: string | null; where: string[] }>();
  for (const p of parts) {
    for (const g of p.coverage_gaps) {
      const key = `${g.rule_id ?? ''}|${g.reason}`;
      const row = byReason.get(key) ?? { reason: g.reason, rule_id: g.rule_id ?? null, where: [] };
      row.where.push(nameOf(p));
      byReason.set(key, row);
    }
  }
  const rows = [...byReason.values()];
  if (!rows.length) return null;
  return (
    <Card>
      <CardHead title="Not assessed" icon="info" />
      <CardBody>
        <List listStyle="disc" density="compact">
          {rows.map((g, i) => (
            <ListItem key={i} label={<Wrap>{g.reason}</Wrap>}
              description={<Wrap secondary>For {g.where.join(', ')}{g.rule_id ? ` · ${g.rule_id}` : ''}</Wrap>} />
          ))}
        </List>
      </CardBody>
    </Card>
  );
}

function Summary({ post, check, current, studyTitle }: { post: ClientPost; check: ClientCheck | null; current: boolean; studyTitle?: string }) {
  return (
    <Card>
      <CardHead title="Summary" icon="shield" regulatory />
      <CardBody>
        <MetadataList>
          <MetadataListItem label="Post">version {post.version}{post.change_note && <Text type="body" color="secondary"> · {post.change_note}</Text>}</MetadataListItem>
          <MetadataListItem label="Study">{studyTitle ?? 'Study not available'}</MetadataListItem>
          <MetadataListItem label="Where it goes">{formatLabel(post)} · {languageLabel(post.language)}</MetadataListItem>
          <MetadataListItem label="Check">{check ? <ExecutionBadge state={check.state} /> : <Badge>Not checked yet</Badge>}</MetadataListItem>
          <MetadataListItem label="Result">
            {!check || isInProgress(check.state) ? <Badge>No result yet</Badge>
              : current
                ? (check.outcome === 'PASS' && check.parts.some((p) => p.coverage_gaps.length)
                    ? <Badge variant="waiting">Passed what could be assessed</Badge>
                    : <OutcomeBadge outcome={check.outcome} />)
                : <HStack gap={2} vAlign="center" wrap="wrap"><Badge variant="waiting">Out of date</Badge><Text type="supporting" color="secondary">for version {check.post_version}</Text></HStack>}
          </MetadataListItem>
          {check && <MetadataListItem label="Policy rules">{check.policy_bundle_version != null ? `version ${check.policy_bundle_version}` : 'Not reported'}</MetadataListItem>}
          {check?.evaluated_at && <MetadataListItem label="Evaluated">{fmtDateTime(check.evaluated_at)}</MetadataListItem>}
          <MetadataListItem label="AI generation">
            {check ? `${check.generation_requests} requests` : 'None'}<Text type="body" color="secondary"> · checking never generates</Text>
          </MetadataListItem>
          {post.generation_requests > 0 && (
            <MetadataListItem label="Paid AI fixes">
              {post.generation_requests} {post.generation_requests === 1 ? 'request' : 'requests'}<Text type="body" color="secondary"> · chosen by you</Text>
            </MetadataListItem>
          )}
        </MetadataList>
        <List hasDividers density="compact" aria-label="Next steps">
          <ListItem label="Human approval" endContent={<Badge>Separate step</Badge>} />
          <ListItem label="Ready to publish" endContent={<Badge>Not decided here</Badge>} />
        </List>
        <Text type="supporting" color="secondary">A check is automated, not an approval. Download is offered once the current version has been checked.</Text>
      </CardBody>
    </Card>
  );
}
