import type { ReactNode } from 'react';
import { ChannelLabel } from '@/components/ui/PlatformLogo';
import { Heading, Text } from '@astryxdesign/core/Text';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Link as AxLink } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import type { PostFormat, StudySnapshot } from '@/api/session';
import { currentValidation, latestValidation, type Creative, type Versioned } from '@/api/creatives';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { GeneratedImagePreview } from '@/components/media/GeneratedImagePreview';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Overlay';
import { fmtDateTime } from '@/lib/utils';
import type { SaveState } from './useDraftEditor';

/* ---------- Labels ---------- */

const languageNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; }
})();
export const languageLabel = (code: string) => languageNames?.of(code) ?? code;

const words = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const formatLabel = (f: Pick<PostFormat, 'channel' | 'post_format'> & { aspect_ratio?: string }) =>
  `${words(f.channel)} · ${words(f.post_format)}${f.aspect_ratio ? ` (${f.aspect_ratio})` : ''}`;
export const formatKey = (f: Pick<PostFormat, 'channel' | 'post_format'>) => `${f.channel}|${f.post_format}`;

/* ---------- Step section (from the NRC Connect "Create post" studio) ---------- */

export function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <VStack gap={3}>
      {n > 1 && <Divider />}
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge>{n}</Badge>
        <Heading level={2}>{title}</Heading>
        {hint && <Text type="supporting" color="secondary">{hint}</Text>}
      </HStack>
      {children}
    </VStack>
  );
}

/* ---------- Approved study facts (read-only) ---------- */

/** Shown exactly as received from the study snapshot; never editable. */
export function StudyFacts({ study }: { study: StudySnapshot }) {
  const f = study.facts;
  const ages = f.min_age != null || f.max_age != null
    ? `${f.min_age ?? 'Any'} to ${f.max_age ?? 'any'} years`
    : null;
  const rows: [string, ReactNode][] = [
    ['Condition', f.condition],
    ['Who can take part', f.eligibility_summary],
    ...(ages ? [['Ages', ages] as [string, ReactNode]] : []),
    ...(f.sites.length ? [['Sites', f.sites.join(', ')] as [string, ReactNode]] : []),
    ...(f.compensation_statement ? [['Compensation', f.compensation_statement] as [string, ReactNode]] : []),
    ...(f.approved_claims.length ? [['Approved claims', (
      <VStack gap={1}>{f.approved_claims.map((c, i) => <Text key={i} type="body">{c}</Text>)}</VStack>
    )] as [string, ReactNode]] : []),
    ...(f.contact_url ? [['Contact', <AxLink href={f.contact_url} target="_blank">{f.contact_url}</AxLink>] as [string, ReactNode]] : []),
  ];
  return (
    <>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Icon name="lock" color="secondary" />
          <Text type="body" weight="semibold">Approved study facts</Text>
          <Text type="supporting" color="secondary">Read-only</Text>
          <StackItem size="fill">{null}</StackItem>
          {study.is_synthetic && <Badge variant="waiting">Demo study</Badge>}
          {study.recruitment_status === 'recruiting' ? <Badge variant="done">Recruiting</Badge> : <Badge>Closed</Badge>}
        </HStack>
        <MetadataList>
          {rows.map(([k, v]) => <MetadataListItem key={k} label={k}>{v}</MetadataListItem>)}
        </MetadataList>
        <Text type="supporting" color="secondary">
          Approved by {study.approved_by} on {fmtDateTime(study.approved_at)} · snapshot {study.snapshot_id} v{study.version}
        </Text>
      </VStack>
    </>
  );
}

/** Required wording from the study, shown under the caption. The user includes it; the validator checks it. */
export function RequiredWording({ texts }: { texts: string[] }) {
  if (!texts.length) return null;
  return (
    <Banner status="info" collapsible={false} icon={<Icon name="lock" />}
      title="Required wording: must appear exactly as written"
      description={<VStack gap={1}>{texts.map((t, i) => <Text key={i} type="body" wordBreak="break-word">{t}</Text>)}</VStack>} />
  );
}

/* ---------- Live preview ---------- */

/** How the post reads, before any image exists. Always a draft for review. */
export function PostPreview({ tenantName, caption, format, image, full }: {
  tenantName: string;
  caption: string;
  format?: PostFormat;
  /** The stored image, once there is one: shown through the API, with its link renewed when it expires. */
  image?: { assetId: string; alt: string; provenance?: boolean };
  /** Final preview: the caption is never shortened. */
  full?: boolean;
}) {
  const ratio = format ? format.width_px / format.height_px : 1;
  return (
    <AxCard padding={0} data-card="">
      <Section variant="transparent" padding={4}>
        <VStack gap={3}>
          <HStack gap={3} vAlign="center">
            <Avatar name={tenantName} size="sm" />
            <StackItem size="fill">
              <VStack gap={0.5}>
                <Text type="body" weight="semibold" maxLines={1}>{tenantName}</Text>
                {format
                  ? <ChannelLabel text={formatLabel(format)} supporting />
                  : <Text type="supporting" color="secondary">Post</Text>}
              </VStack>
            </StackItem>
            <Badge>Draft for review</Badge>
          </HStack>
          <Text type="body" wordBreak="break-word" color={caption.trim() ? 'primary' : 'secondary'}>
            {caption.trim() || 'The caption appears here.'}
          </Text>
        </VStack>
      </Section>
      {image
        ? <GeneratedImagePreview assetId={image.assetId} alt={image.alt} ratio={ratio} provenance={image.provenance} />
        : (
          <AspectRatio ratio={ratio} fit="cover">
            <Center axis="both" height="100%" padding={6}>
              <VStack gap={2} hAlign="center">
                <Icon name="img" size={24} color="secondary" />
                <Text type="supporting" color="secondary" justify="center">{full ? 'No image yet. The image is generated after the brief passes validation.' : 'The image is generated from the brief after it passes validation.'}</Text>
              </VStack>
            </Center>
          </AspectRatio>
        )}
    </AxCard>
  );
}

/* ---------- Save status ---------- */

export function SaveStatus({ state, version }: { state: SaveState; version?: number }) {
  const [variant, text] = ((): [Parameters<typeof Badge>[0]['variant'], string] => {
    switch (state.kind) {
      case 'unsaved': return ['neutral', 'Not saved yet'];
      case 'dirty': return ['waiting', 'Unsaved changes'];
      case 'saving': return ['brand', 'Saving'];
      case 'saved': return ['done', `Saved · version ${version}`];
      case 'failed': return ['blocked', 'Save failed'];
      case 'conflict': return ['blocked', 'Version conflict'];
      case 'readonly': return ['neutral', 'Read-only'];
    }
  })();
  return <span role="status" aria-live="polite"><Badge variant={variant}>{text}</Badge></span>;
}

/* ---------- Validation and generation readiness ---------- */

/**
 * What the backend says about the current version (CreativeRead.validation_runs).
 * Local edits make the last result out of date immediately. Generation
 * eligibility is not in the contract yet, so the UI never offers Generate.
 */
export function ReadinessCard({ creative, editing, validate }: {
  creative: Creative;
  editing: boolean;
  /** Present when this user may run validation on this draft now. */
  validate?: { onClick: () => void; busy: boolean };
}) {
  const current = currentValidation(creative);
  const latest = latestValidation(creative);
  type V = { variant: 'neutral' | 'done' | 'blocked' | 'waiting' | 'brand'; text: string; note?: string };
  const shown = current ?? latest;
  const inProgress = !!current && ['QUEUED', 'RUNNING', 'WAITING_PROVIDER'].includes(current.state);
  let validation: V;
  if (editing && (current || latest)) validation = { variant: 'waiting', text: 'Out of date', note: 'The brief changed after the last validation.' };
  else if (!current && latest) validation = { variant: 'waiting', text: 'Out of date', note: `Last validated version ${latest.creative_version}.` };
  else if (!current) validation = { variant: 'neutral', text: 'Not validated' };
  else if (['QUEUED', 'RUNNING', 'WAITING_PROVIDER'].includes(current.state)) validation = { variant: 'brand', text: 'Checking' };
  else if (current.outcome === 'PASS') validation = { variant: 'done', text: 'Passed the assessed checks', note: `For version ${current.creative_version}.` };
  else if (current.outcome === 'FAIL') validation = { variant: 'blocked', text: 'Failed', note: `For version ${current.creative_version}.` };
  else if (current.outcome === 'NEEDS_REVIEW') validation = { variant: 'waiting', text: 'Needs review', note: `For version ${current.creative_version}.` };
  else validation = { variant: 'blocked', text: 'Could not finish', note: 'Run validation again.' };

  return (
    <Card>
      <CardHead title="Validation and generation" />
      <CardBody>
        <Row label="Status"><Badge>Draft for review</Badge></Row>
        <Row label="Validation" note={validation.note}><Badge variant={validation.variant}>{validation.text}</Badge></Row>
        <Row label="Generation" note={editing ? 'Save your changes, then validate this version.' : 'Generation is not connected yet.'}>
          <Badge>Not available yet</Badge>
        </Row>
      </CardBody>
      <CardFoot>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="primary" icon="shield" disabled={!validate || editing || inProgress} loading={validate?.busy} onClick={validate?.onClick}>
            Validate version {creative.version}
          </Button>
          <Button variant="secondary" icon="img" disabled>Generate image</Button>
        </HStack>
        {shown && (
          <AxLink href={`/marketing/validation/${encodeURIComponent(creative.id)}/${encodeURIComponent(shown.validation_run_id)}`}>
            {inProgress ? 'Follow the running check' : `View results for version ${shown.creative_version}`}
          </AxLink>
        )}
        <Text type="supporting" color="secondary">
          {editing ? 'Changes save first; then validate the new version.' : 'Generation is not connected in this build yet.'}
        </Text>
      </CardFoot>
    </Card>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <VStack gap={1}>
      <HStack gap={2} hAlign="between" vAlign="center"><Text type="body" weight="semibold">{label}</Text>{children}</HStack>
      {note && <Text type="supporting" color="secondary">{note}</Text>}
    </VStack>
  );
}

/* ---------- Version conflict ---------- */

export function ConflictDialog({ open, server, mine, onClose, onUseTheirs, onSaveMine, onCopyMine }: {
  open: boolean;
  server: Versioned;
  mine: { prompt: string; caption: string };
  onClose: () => void;
  onUseTheirs: () => void;
  onSaveMine: () => void;
  onCopyMine: () => void;
}) {
  const theirs = { prompt: server.creative.current_prompt, caption: server.creative.caption ?? '' };
  const version = server.creative.version;
  const rows = (['prompt', 'caption'] as const).filter((k) => theirs[k] !== mine[k]);
  return (
    <Modal open={open} onClose={onClose} size="xl" icon="warn" title="Someone saved a newer version"
      footer={(
        <>
          <Button variant="ghost" icon="copy" onClick={onCopyMine}>Copy my text</Button>
          <StackItem size="fill">{null}</StackItem>
          <Button variant="secondary" onClick={onUseTheirs}>Use their version</Button>
          <Button variant="primary" onClick={onSaveMine}>Save mine as version {version + 1}</Button>
        </>
      )}>
      <VStack gap={4}>
        <Text type="body" wordBreak="break-word">Version {version} was saved while you were editing. Nothing has been overwritten. Choose which text to keep.</Text>
        {rows.length === 0 && <Text type="body" color="secondary">The brief and caption are the same in both versions.</Text>}
        {rows.map((k) => (
          <VStack key={k} gap={2}>
            <Text type="body" weight="semibold">{k === 'prompt' ? 'Brief' : 'Caption'}</Text>
            <Grid columns={{ minWidth: 240 }} gap={3}>
              <Compare title={`Their version ${version}`} text={theirs[k]} />
              <Compare title="Your text" text={mine[k]} mine />
            </Grid>
          </VStack>
        ))}
      </VStack>
    </Modal>
  );
}

function Compare({ title, text, mine }: { title: string; text: string; mine?: boolean }) {
  return (
    <AxCard padding={4} variant={mine ? 'blue' : 'default'}>
      <VStack gap={1}>
        <Text type="supporting" color="secondary">{title}</Text>
        <Text type="body" wordBreak="break-word" color={text ? 'primary' : 'secondary'}>{text || 'Empty'}</Text>
      </VStack>
    </AxCard>
  );
}
