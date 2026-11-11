import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import type { UseQueryResult } from '@tanstack/react-query';
import { shortHash, type Asset } from '@/api/assets';
import { isApiError } from '@/api/errors';
import { failureText, isJobOutcomeUnknown, JOB_STEPS, jobProgress, type Job } from '@/api/jobs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, ProgressBar, SkeletonRows } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import type { StartProblem } from './useGeneration';

/** Name the backend gives simulated output; such an image is never live evidence. */
export const SIMULATED_PROVIDER = 'simulation';

/**
 * Step 4 of the composer: the job for this draft, as the backend reports it.
 * It shows only stored state: a stopped spinner never means a stopped job,
 * and a saved image is still a draft that needs final validation.
 */
export function GenerationStatus({ version, job, asset, problem, starting, onRetry }: {
  /** The draft version in the editor. */
  version: number;
  job: UseQueryResult<Job> | null;
  asset: UseQueryResult<Asset>;
  problem: StartProblem | null;
  starting: boolean;
  onRetry: () => void;
}) {
  return (
    <VStack gap={3}>
      {problem && (
        <Alert tone={problem.sameCommand ? 'waiting' : 'blocked'} title={problem.title}
          action={problem.sameCommand ? <Button variant="secondary" size="sm" icon="refresh" loading={starting} onClick={onRetry}>Try again</Button> : undefined}>
          {problem.detail}{problem.requestId && <> Reference <Text type="code">{problem.requestId}</Text>.</>}
        </Alert>
      )}
      {!job && !problem && (
        <Text type="body" color="secondary">The image is made from the brief once this version passes validation. Generate it from the validation and generation panel.</Text>
      )}
      {job && <JobState version={version} job={job} asset={asset} />}
    </VStack>
  );
}

function JobState({ version, job, asset }: { version: number; job: UseQueryResult<Job>; asset: UseQueryResult<Asset> }) {
  if (job.isPending) return <SkeletonRows rows={2} />;
  if (job.isError || !job.data) {
    const e = job.error;
    if (isApiError(e) && (e.kind === 'not_found' || e.kind === 'forbidden')) {
      return <Alert tone="waiting" title="This generation is not available">It does not exist, or it belongs to another organisation. Generate again from this draft.</Alert>;
    }
    return (
      <Alert tone="waiting" title="The generation status could not be loaded"
        action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => void job.refetch()}>Check again</Button>}>
        The job keeps running on the server. Checking again does not start a new image.
      </Alert>
    );
  }

  const j = job.data;
  const p = jobProgress(j);
  const stale = j.creative_version !== version;
  const forVersion = <Text type="supporting" color="secondary">For version {j.creative_version}{stale && '. The brief has changed since; generate again after validating the new version.'}</Text>;

  if (j.state === 'SUCCEEDED') {
    const a = asset.data;
    const simulated = a?.provider === SIMULATED_PROVIDER;
    return (
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge variant="done">Image saved</Badge>
          <Badge>Draft for review</Badge>
          {simulated && <Badge variant="waiting">Simulation, not a real generated image</Badge>}
        </HStack>
        {forVersion}
        {a && (
          <Text type="supporting" color="secondary">
            {a.provider ?? 'Unknown service'}{a.model && ` (${a.model})`} · {a.width_px}×{a.height_px} · {fmtDateTime(a.created_at)} · reference {shortHash(a.checksum_sha256)}
          </Text>
        )}
        {asset.isError && <Alert tone="waiting" title="The image could not be shown">It is saved. Reload the page to fetch a new link.</Alert>}
        <Text type="body" color="secondary">The image still needs its final validation before review. Generating it does not approve or publish anything.</Text>
      </VStack>
    );
  }

  if (j.state === 'FAILED') {
    return (
      <VStack gap={2}>
        <Alert tone="blocked" title="The image was not made">{failureText(j.failure_code)}</Alert>
        {forVersion}
      </VStack>
    );
  }

  if (j.state === 'CANCELLED') {
    return <Alert tone="waiting" title="This generation was cancelled">No image was saved. Generate again when the brief is ready.</Alert>;
  }

  if (isJobOutcomeUnknown(j.state)) {
    return (
      <VStack gap={2}>
        <Alert tone="waiting" title="Confirming with the image service">
          The image service did not confirm this request. It is being checked with the same request, so you are not charged twice.
          Generating again is turned off until this is settled. If it stays like this, it goes to manual review.
        </Alert>
        {forVersion}
      </VStack>
    );
  }

  const step = p.step + 1;
  return (
    <VStack gap={2}>
      <ProgressBar value={p.step} max={JOB_STEPS.length - 1} label={p.label} valueLabel={`Step ${step} of ${JOB_STEPS.length}`} ariaLabel="Image generation progress" />
      {forVersion}
      <Text type="supporting" color="secondary">You can leave this page. The image keeps being made, and this link brings you back to it.</Text>
    </VStack>
  );
}
