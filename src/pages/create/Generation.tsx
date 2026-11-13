import type { ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type { UseQueryResult } from '@tanstack/react-query';
import { isPlaceholderImage, type Asset } from '@/api/assets';
import type { Creative, GenerationEligibility } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import type { Job } from '@/api/jobs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, Spinner } from '@/components/ui/Misc';

/** What the job is doing, in plain words. The API's `stage` is used when it is one we know. */
function progressLabel(job: Job) {
  if (job.state === 'QUEUED') return 'Waiting to start';
  if (job.stage === 'submitting') return 'Sending the brief to the image service';
  if (job.stage === 'generating' || job.state === 'WAITING_PROVIDER') return 'The image is being generated';
  if (job.stage === 'storing' || job.stage === 'stored') return 'Saving the image';
  return 'Working on the image';
}

/**
 * Step 4 of the composer: generate the image for the current version.
 *
 * The button follows the server's eligibility answer for this exact version;
 * a passed badge from an earlier version never enables it. Generation
 * finishing says nothing about validation or approval of the image.
 */
export function GenerationStep({ creative, editing, canGenerate, eligibility, job, active, starting, onGenerate, image }: {
  creative: Creative;
  /** Unsaved or saving edits: the saved version is about to change. */
  editing: boolean;
  /** The role may generate and the draft is not read-only. */
  canGenerate: boolean;
  eligibility: UseQueryResult<GenerationEligibility>;
  job: Job | undefined;
  active: boolean;
  starting: boolean;
  onGenerate: () => void;
  image: Asset | undefined;
}): ReactElement {
  const e = eligibility.data;
  const notConnected = isApiError(eligibility.error) && eligibility.error.kind === 'not_implemented';
  const why = editing
    ? 'Save your changes, then validate this version. The image is generated from a validated brief.'
    : notConnected
      ? 'Image generation is not connected in this build yet.'
      : eligibility.isError
        ? 'Could not check whether this version can be generated. Reload the page to try again.'
        : !e
          ? 'Checking whether this version can be generated.'
          : e.message;
  const eligible = !editing && !!e?.eligible;

  return (
    <VStack gap={3}>
      {image && !active && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge variant="done">Image ready</Badge>
          <Text type="supporting" color="secondary">
            For version {creative.version} · {image.width_px}×{image.height_px}
            {isPlaceholderImage(image) && ' · placeholder picture from the demo service, not a generated image'}
          </Text>
        </HStack>
      )}

      {active && job && (
        <HStack gap={3} vAlign="center">
          <Spinner size="sm" />
          <span role="status" aria-live="polite"><Text type="body">{progressLabel(job)}. You can keep this page open or come back; the job continues.</Text></span>
        </HStack>
      )}

      {!active && job?.state === 'FAILED' && (
        <Alert tone="blocked" title="The image could not be generated">
          {job.failure_message ?? 'The image service reported a failure.'} Nothing was saved. You can try again.
        </Alert>
      )}
      {!active && job && (job.state === 'UNKNOWN' || job.state === 'NEEDS_REVIEW') && (
        <Alert tone="waiting" title="The result is not confirmed">
          The image service did not confirm whether an image was made. Do not start again until this job is checked. Job reference <Text type="code">{job.job_id}</Text>.
        </Alert>
      )}
      {!active && job?.state === 'CANCELLED' && <Alert tone="info">Generation was cancelled. No image was made.</Alert>}

      {!active && <Text type="body" color="secondary">{image && eligible ? 'Editing the brief does not change this image. Generate again if it should match a new brief.' : why}</Text>}

      {canGenerate && (
        <HStack>
          <Button variant={image ? 'secondary' : 'primary'} icon="img" loading={starting}
            disabled={!eligible || active || job?.state === 'UNKNOWN'} onClick={onGenerate}>
            {image ? 'Generate a new image' : 'Generate image'}
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
