import type { ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import type { UseQueryResult } from '@tanstack/react-query';
import { isPlaceholderImage, type Asset } from '@/api/assets';
import type { Creative, GenerationEligibility } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { failureText, JOB_STEPS, jobProgress, type Job } from '@/api/jobs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, ProgressBar } from '@/components/ui/Misc';
import { generationAnnouncement } from './generationRules';

/**
 * Step 4 of the composer: generate the image for the current version.
 *
 * The button follows the server's eligibility answer for this exact version;
 * a passed badge from an earlier version never enables it. Generation
 * finishing says nothing about validation or approval of the image.
 */
export function GenerationStep({ creative, editing, canGenerate, eligibility, job, active, unsettled, pollingStopped, checking, onCheckAgain, starting, onGenerate, image }: {
  creative: Creative;
  /** Unsaved or saving edits: the saved version is about to change. */
  editing: boolean;
  /** The role may generate and the draft is not read-only. */
  canGenerate: boolean;
  eligibility: UseQueryResult<GenerationEligibility>;
  job: Job | undefined;
  /** The job is still working. */
  active: boolean;
  /** The job waits on reconciliation or a person: Generate stays off. */
  unsettled: boolean;
  /** Automatic checking stopped for an unfinished job past its polling window. */
  pollingStopped: boolean;
  checking: boolean;
  onCheckAgain: () => void;
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
  const progress = job ? jobProgress(job) : undefined;
  const checkAgain = (
    <Button variant="secondary" size="sm" icon="refresh" loading={checking} onClick={onCheckAgain}>Check again</Button>
  );

  return (
    <VStack gap={3}>
      {/* Mounted for the step's whole life, so screen readers hear each change of its text (JS-82). */}
      <VisuallyHidden><span role="status" aria-live="polite">{generationAnnouncement({ job, starting, pollingStopped })}</span></VisuallyHidden>

      {image && !active && (
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Badge variant="done">Image ready</Badge>
            <Text type="supporting" color="secondary">
              For version {creative.version} · {image.width_px}×{image.height_px}
              {image.provider && ` · ${image.provider}${image.model ? ` (${image.model})` : ''}`}
              {isPlaceholderImage(image) && ' · placeholder picture from the demo service, not a generated image'}
            </Text>
          </HStack>
          <Text type="supporting" color="secondary">The image still needs its final validation before review. Generating it does not approve or publish anything.</Text>
        </VStack>
      )}

      {active && progress && (
        <VStack gap={2}>
          <ProgressBar value={progress.step} max={JOB_STEPS.length - 1} label={progress.label}
            valueLabel={`Step ${progress.step + 1} of ${JOB_STEPS.length}`} ariaLabel="Image generation progress" />
          <Text type="supporting" color="secondary">You can keep this page open or come back; the job continues.</Text>
        </VStack>
      )}

      {pollingStopped && (
        <Alert tone="waiting" title="Automatic checking has stopped" action={checkAgain}>
          This generation has taken longer than expected, so the page no longer checks it by itself. Checking again does not start a new image.
        </Alert>
      )}

      {!active && job?.state === 'FAILED' && (
        <Alert tone="blocked" title="The image could not be generated">
          {failureText(job.failure_code, job.failure_message)} Nothing was saved.
        </Alert>
      )}
      {job?.state === 'UNKNOWN' && (
        <Alert tone="waiting" title="The result is being confirmed">
          The image service did not confirm whether an image was made. It is being checked with the same request, so you are not charged twice.
          Generating again is turned off until this is settled. Job reference <Text type="code">{job.job_id}</Text>.
        </Alert>
      )}
      {job?.state === 'NEEDS_REVIEW' && (
        <Alert tone="waiting" title="A person is reviewing this generation">
          The image service&apos;s answer could not be settled automatically. Generating again is turned off until the review is finished.
          Job reference <Text type="code">{job.job_id}</Text>.
        </Alert>
      )}
      {!active && job?.state === 'CANCELLED' && <Alert tone="info">Generation was cancelled. No image was made.</Alert>}

      {!active && !unsettled && <Text type="body" color="secondary">{image && eligible ? 'Editing the brief does not change this image. Generate again if it should match a new brief.' : why}</Text>}

      {canGenerate && (
        <HStack>
          <Button variant={image ? 'secondary' : 'primary'} icon="img" loading={starting}
            disabled={!eligible || active || unsettled} onClick={onGenerate}>
            {image ? 'Generate a new image' : 'Generate image'}
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
