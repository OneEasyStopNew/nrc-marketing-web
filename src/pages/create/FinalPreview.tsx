import { useState, type ReactNode } from 'react';
import { ChannelLabel } from '@/components/ui/PlatformLogo';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Link as AxLink } from '@astryxdesign/core/Link';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, useSession } from '@/auth/AuthProvider';
import { assetDenied, assetsApi, manifestForDownload, useAsset } from '@/api/assets';
import { creativesApi, currentValidation, latestValidation } from '@/api/creatives';
import { http } from '@/api/http';
import { isApiError } from '@/api/errors';
import { isInProgress, passedAssessedChecks } from '@/api/validations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Alert, EmptyState, PageHeader, SkeletonRows, TwoColumn } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { AssetProvenance } from '@/components/media/GeneratedImagePreview';
import { SIMULATION_BUILD } from '@/config/env';
import { fmtDateTime } from '@/lib/utils';
import { useValidationRun } from '@/pages/validation/useValidation';
import { formatLabel, languageLabel, PostPreview } from './parts';

/**
 * /marketing/create/:creativeId/preview: the exact saved version as it would
 * be posted, with what it was checked against, and the review-draft export.
 * It stays a "Draft for review": reviewer approval is a later, separate step.
 */
export default function FinalPreview() {
  const { creativeId = '' } = useParams();
  const { context } = useSession();
  const { mode } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ['creative-preview', context.tenant.tenant_id, creativeId],
    queryFn: ({ signal }) => creativesApi.get(creativeId, signal),
    staleTime: 0,
  });
  const creative = q.data?.creative;
  const asset = useAsset(creative?.asset_id);
  // An image the API now refuses is not described from the cache either.
  const image = assetDenied(asset.error) ? undefined : asset.data;
  const latest = creative ? latestValidation(creative) : undefined;
  const run = useValidationRun(latest?.validation_run_id ?? '');
  const [exporting, setExporting] = useState(false);

  const draftLink = `/marketing/create/${encodeURIComponent(creativeId)}`;
  const crumbs = [{ label: 'Create post', to: '/marketing/create' }, { label: 'Draft', to: draftLink }, { label: 'Final preview' }];

  if (!creative) {
    const notFound = q.isError && isApiError(q.error) && (q.error.kind === 'not_found' || q.error.kind === 'forbidden');
    return (
      <VStack gap={6}>
        <PageHeader title="Final preview" crumbs={crumbs} />
        <Card>
          {notFound
            ? <EmptyState icon="search" title="Draft not found" description="It does not exist, or it is not available to you in this organisation." />
            : q.isError
              ? <><Alert tone="blocked" title="The draft could not be loaded" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>} /></>
              : <><SkeletonRows rows={5} /><VisuallyHidden><span role="status">Loading the preview</span></VisuallyHidden></>}
        </Card>
      </VStack>
    );
  }

  const study = context.studies.find((s) => s.study_id === creative.study_id);
  const format = context.post_formats.find((f) => f.channel === creative.channel && f.post_format === creative.post_format);
  const current = currentValidation(creative);
  const fullRun = latest && run.data?.validation_run_id === latest.validation_run_id ? run.data : undefined;
  const passed = !!current && !!fullRun && fullRun.is_current && passedAssessedChecks(fullRun);
  const studyChanged = !!study && study.version !== creative.study_snapshot_version;
  const imageAfterEdit = !!image && Date.parse(creative.updated_at) > Date.parse(image.created_at);

  const download = async () => {
    setExporting(true);
    try {
      const manifest = await assetsApi.exportDraft(creative.id);
      const blob = new Blob([JSON.stringify(manifestForDownload(manifest), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nrc-review-draft-${creative.id}-v${manifest.creative_version}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Review draft for version ${manifest.creative_version} downloaded`, 'done', 'It is marked DRAFT. It is not an approval.');
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.kind === 'not_implemented') toast('Export is not available yet', 'waiting', 'The export service is not connected in this build.');
      else if (e.kind === 'invalid') toast('Nothing to export yet', 'waiting', 'The draft needs an image first.');
      else toast('The review draft could not be downloaded', 'blocked', e.retryable ? 'Try again in a moment.' : e.message);
    } finally {
      setExporting(false);
    }
  };

  // Simulation only: the fake API answers the next image request this way, then the image is asked for again.
  const simulateImage = async (kind: string, done: string) => {
    await http.post('/__sim/next-image-link', { mode: kind });
    toast(done, 'waiting');
    await qc.invalidateQueries({ queryKey: ['asset', context.tenant.tenant_id, creative.asset_id] });
  };

  const validation: ReactNode = !latest
    ? <Badge>Not validated</Badge>
    : isInProgress(latest.state)
      ? <Badge variant="brand">Checking</Badge>
      : !current
        ? <HStack gap={2} vAlign="center" wrap="wrap"><Badge variant="waiting">Out of date</Badge><Text type="supporting" color="secondary">Last checked version {latest.creative_version}</Text></HStack>
        : passed
          ? <Badge variant="done">Passed the assessed checks</Badge>
          : current.outcome === 'FAIL'
            ? <Badge variant="blocked">Failed</Badge>
            : <Badge variant="waiting">{current.outcome === 'NEEDS_REVIEW' ? 'Needs review' : 'Not passed'}</Badge>;

  return (
    <VStack gap={6}>
      <PageHeader title="Final preview" crumbs={crumbs} badge={<Badge>Draft for review</Badge>}
        description={`Exactly what version ${creative.version} would post. Nothing here can be edited; change the draft to change it.`}
        actions={(
          <>
            <Button variant="secondary" href={draftLink}>Back to the draft</Button>
            <Button variant="primary" icon="dl" loading={exporting} disabled={!creative.asset_id} onClick={() => void download()}>
              Download review draft
            </Button>
          </>
        )} />

      {!creative.asset_id && (
        <Alert tone="info" title="No image yet">The review draft can be downloaded once the image is generated.</Alert>
      )}
      {studyChanged && (
        <Alert tone="waiting" title="The study facts changed">
          This draft was written against study snapshot version {creative.study_snapshot_version}; the current one is version {study!.version}. Check the brief and validate again.
        </Alert>
      )}
      {imageAfterEdit && (
        <Alert tone="waiting" title="The brief changed after the image was made">
          Editing the brief does not change the image. Generate it again if it should match.
        </Alert>
      )}

      <TwoColumn>
        <section aria-label="Post preview"><VStack gap={4}>
          {/* Provenance is in "What this preview is", so the image shows without its caption here. */}
          <PostPreview tenantName={context.tenant.name} caption={creative.caption ?? ''} format={format} full
            image={creative.asset_id ? { assetId: creative.asset_id, alt: `Image for version ${creative.version} of this draft`, provenance: false } : undefined} />
        </VStack></section>

        <VStack gap={4}>
          <Card>
            <CardHead title="What this preview is" icon="info" />
            <CardBody>
              <MetadataList>
                <Pair k="Status"><HStack gap={2} vAlign="center" wrap="wrap"><Badge>Draft for review</Badge><Text type="supporting" color="secondary">Not approved; not posted</Text></HStack></Pair>
                <Pair k="Draft version">{creative.version} · saved {fmtDateTime(creative.updated_at)}</Pair>
                <Pair k="Where it goes"><ChannelLabel text={`${formatLabel({ channel: creative.channel, post_format: creative.post_format, aspect_ratio: format?.aspect_ratio })} · ${languageLabel(creative.language)}`} /></Pair>
                <Pair k="Study">{study?.study_title ?? 'No longer available'} · snapshot version {creative.study_snapshot_version}</Pair>
                <Pair k="Validation">
                  {validation}
                  {latest && (
                    <AxLink href={`/marketing/validation/${encodeURIComponent(creative.id)}/${encodeURIComponent(latest.validation_run_id)}`}>Evidence</AxLink>
                  )}
                </Pair>
                <Pair k="Policy bundle">{fullRun?.policy_bundle_version ? <Text type="code">{fullRun.policy_bundle_version}</Text> : <Text type="body" color="secondary">Not reported</Text>}</Pair>
                <Pair k="Image">
                  {image
                    ? <AssetProvenance asset={image} />
                    : <Text type="body" color="secondary">{!creative.asset_id ? 'None yet' : asset.isPending ? 'Loading' : 'Not available'}</Text>}
                </Pair>
              </MetadataList>
            </CardBody>
          </Card>

          {study && study.facts.required_disclosures.length > 0 && (
            <Card>
              <CardHead title="Required wording" icon="lock" />
              <CardBody>
                <Text type="body" color="secondary">Must appear exactly as written. Shown in full.</Text>
                {study.facts.required_disclosures.map((t, i) => <Text key={i} type="body" wordBreak="break-word">{t}</Text>)}
              </CardBody>
            </Card>
          )}

          {SIMULATION_BUILD && mode === 'simulation' && creative.asset_id && (
            <Card>
              <CardHead title="Simulation tools" icon="warn" />
              <CardBody>
                <Button variant="ghost" size="sm" onClick={() => void simulateImage('expired', 'The image link expired')}>Expire the image link</Button>
                <Button variant="ghost" size="sm" onClick={() => void simulateImage('expired-twice', 'The image link expired, and the next one too')}>Expire the image link twice</Button>
                <Button variant="ghost" size="sm" onClick={() => void simulateImage('unavailable', 'The image link expired and storage is not answering')}>Expire the link with storage unavailable</Button>
                <Button variant="ghost" size="sm" onClick={() => void simulateImage('other-organisation', 'The image now belongs to another organisation')}>Move the image to another organisation</Button>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHead title="Approval" icon="check" />
            <CardBody>
              <Text type="body" wordBreak="break-word">Reviewer approval is a separate step and is not part of this build.</Text>
              <Text type="body" color="secondary">Passing validation does not approve a post, and downloading the review draft does not publish it.</Text>
              <div><Button size="sm" variant="ghost" onClick={() => navigate(draftLink)}>Change the draft</Button></div>
            </CardBody>
          </Card>
        </VStack>
      </TwoColumn>
    </VStack>
  );
}

function Pair({ k, children }: { k: string; children: ReactNode }) {
  return (
    <MetadataListItem label={k}>{children}</MetadataListItem>
  );
}
