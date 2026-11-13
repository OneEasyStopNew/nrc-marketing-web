import { useReducer, useState, type ReactElement } from 'react';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Center } from '@astryxdesign/core/Center';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Section } from '@astryxdesign/core/Section';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { assetDenied, isPlaceholderImage, shortHash, useAsset, type Asset } from '@/api/assets';
import { isApiError } from '@/api/errors';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Overlay';
import { fmtDateTime } from '@/lib/utils';
import { initialRenewal, renewalStep } from './imageRenewal';

/**
 * A stored image (generated or uploaded), loaded through `useAsset` so only
 * images the API lets this user see are shown. The short-lived signed link is
 * used as the <img> src and nowhere else: never in a link, storage or a log.
 * When the browser cannot draw it (usually an expired link) it fetches a fresh
 * link once; see imageRenewal.ts.
 */
export function GeneratedImagePreview({
  assetId,
  alt,
  ratio = 1,
  provenance = true,
}: {
  assetId: string;
  /** What the image shows, e.g. from `imageAltForBrief`; never where it came from. */
  alt: string;
  /** Width / height of the frame; the image is cropped to fill it. */
  ratio?: number;
  /** Show origin, provider, size, time and checksum under the image. Off where the page shows them already. */
  provenance?: boolean;
}): ReactElement {
  // A new asset starts from scratch: no error or renewal state carries over.
  return <ImagePreview key={assetId} assetId={assetId} alt={alt} ratio={ratio} provenance={provenance} />;
}

function ImagePreview({
  assetId,
  alt,
  ratio,
  provenance,
}: {
  assetId: string;
  alt: string;
  ratio: number;
  provenance: boolean;
}): ReactElement {
  const asset = useAsset(assetId);
  const [renewal, dispatch] = useReducer(renewalStep, initialRenewal);
  const [fullSize, setFullSize] = useState(false);
  const { refetch } = asset;

  // Renewal runs in the event that needs it. The reducer ignores late answers, and the
  // component is keyed by assetId, so an answer for another image cannot land here.
  const renew = async (event: 'load_failed' | 'retry'): Promise<void> => {
    const next = renewalStep(renewal, { type: event });
    dispatch({ type: event });
    if (next.phase !== 'renewing') return;
    let renewed = false;
    try {
      renewed = !(await refetch()).isError;
    } catch {
      // refetch reports errors in its result; anything thrown still ends in the "Try again" state, never a rejection.
    }
    dispatch({ type: renewed ? 'renewed' : 'renew_failed' });
  };

  const denied = assetDenied(asset.error);
  const data = denied ? undefined : asset.data;
  const fullAlt = data && isPlaceholderImage(data) ? `${alt} (placeholder picture)` : alt;
  const unavailable = isApiError(asset.error) && asset.error.kind === 'unavailable';
  const tryAgain = (): void => {
    if (renewal.phase === 'failed') void renew('retry');
    else void refetch();
  };

  const drawing = !!data?.download_url && !asset.isPending && (renewal.phase === 'loading' || renewal.phase === 'shown');
  let frame;
  if (denied) {
    frame = (
      <Notice icon="lock" title="Image not available" text="It does not exist, or it is not available to you in this organisation." />
    );
  } else if (asset.isPending || renewal.phase === 'renewing') {
    frame = (
      <div aria-hidden data-loading="">
        <Skeleton height="100%" radius="none" />
      </div>
    );
  } else if (renewal.phase === 'failed' || !data?.download_url) {
    frame = unavailable ? (
      <Notice
        icon="warn"
        title="The image is temporarily unavailable"
        text="Image storage did not answer. Try again in a minute; the rest of the draft is unchanged."
        action={tryAgain}
      />
    ) : (
      <Notice
        icon="warn"
        title="The image could not be shown"
        text="Its link could not be renewed. Try again; the rest of the draft is unchanged."
        action={tryAgain}
      />
    );
  } else {
    // The attempt key draws a fresh <img> for every renewed link, even when the link text is unchanged.
    frame = (
      <img
        key={renewal.attempt}
        src={data.download_url}
        alt={fullAlt}
        onLoad={() => dispatch({ type: 'loaded' })}
        onError={() => void renew('load_failed')}
      />
    );
  }

  // One region, mounted for the component's life: a live region that appears already filled is not announced.
  const status = denied
    ? 'Image not available'
    : asset.isPending
      ? 'Loading the image'
      : renewal.phase === 'renewing'
        ? 'Renewing the image link'
        : renewal.phase === 'failed' || !data?.download_url
          ? unavailable
            ? 'The image is temporarily unavailable'
            : 'The image could not be shown'
          : '';

  return (
    <>
      <VisuallyHidden>
        <span role="status" aria-live="polite" data-image-status="">
          {status}
        </span>
      </VisuallyHidden>
      <AspectRatio ratio={ratio} fit={drawing ? 'cover' : undefined}>
        {frame}
      </AspectRatio>
      {data && drawing && renewal.phase === 'shown' && (
        <Section variant="transparent" padding={4}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">{provenance ? <AssetProvenance asset={data} /> : null}</StackItem>
            <Button variant="ghost" size="sm" icon="eye" onClick={() => setFullSize(true)}>
              Open full size
            </Button>
          </HStack>
        </Section>
      )}
      {data?.download_url && (
        <Modal open={fullSize} onClose={() => setFullSize(false)} size="xl" icon="img" title="Image at full size">
          <AspectRatio ratio={data.width_px / data.height_px} fit="contain">
            <img src={data.download_url} alt={fullAlt} />
          </AspectRatio>
        </Modal>
      )}
    </>
  );
}

/** Where the image came from, its size and time, and a short checksum. Always a draft for review. */
export function AssetProvenance({ asset }: { asset: Asset }): ReactElement {
  const placeholder = isPlaceholderImage(asset);
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge>Draft for review</Badge>
        {placeholder ? (
          <Badge variant="waiting">Placeholder picture, not a generated image</Badge>
        ) : (
          <Text type="body">
            {asset.origin === 'generated' ? 'Generated' : 'Uploaded'}
            {asset.provider && (
              <>
                {' '}
                by {asset.provider}
                {asset.model && ` (${asset.model})`}
              </>
            )}
          </Text>
        )}
      </HStack>
      <Text type="supporting" color="secondary">
        {placeholder && `${asset.origin === 'generated' ? 'Generated' : 'Uploaded'} · `}
        {asset.width_px}×{asset.height_px} · {fmtDateTime(asset.created_at)} · Checksum {shortHash(asset.checksum_sha256)}
      </Text>
    </VStack>
  );
}

function Notice({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: () => void }): ReactElement {
  return (
    <Center axis="both" height="100%" padding={6}>
      <VStack gap={2} hAlign="center">
        <Icon name={icon} size={24} color="secondary" />
        <Text type="body" weight="semibold" justify="center">
          {title}
        </Text>
        <Text type="supporting" color="secondary" justify="center">
          {text}
        </Text>
        {action && (
          <Button variant="secondary" size="sm" icon="refresh" onClick={action}>
            Try again
          </Button>
        )}
      </VStack>
    </Center>
  );
}
