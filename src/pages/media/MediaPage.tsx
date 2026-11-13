import { useMemo, useState, type ReactElement } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ComponentProps } from 'react';

type ISODate = NonNullable<ComponentProps<typeof DateInput>['value']>;
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAuth } from '@/auth/AuthProvider';
import { useMediaLibrary, type MediaItem } from '@/api/assets';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type MediaUpload } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useWorkspaceMutation } from '@/pages/shared/queries';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { InDevelopment, InDevelopmentDialog, QueryState, fmtBytes, useIsSimulation } from '@/pages/shared/ui';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Center } from '@astryxdesign/core/Center';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Section } from '@astryxdesign/core/Section';
import { Timestamp } from '@astryxdesign/core/Timestamp';

type Kind = 'all' | 'image' | 'video';
type Layout = 'grid' | 'table';

const ORIGIN: Record<MediaItem['origin'], string> = { generated: 'Generated', uploaded: 'Uploaded' };
const author = (m: MediaItem): string => m.created_by_name ?? m.created_by;
const draftHref = (m: MediaItem): string => `/marketing/create/${encodeURIComponent(m.creative_id)}`;
const shortId = (id: string): string => id.slice(0, 8);
/** A readable name: the API gives an image no file name, only the draft it was made for. */
const nameOf = (m: MediaItem): string => `Draft ${shortId(m.creative_id)} · version ${m.creative_version}`;

/**
 * Media library (NRC-18): the finished generated images of this organisation,
 * newest first (GET /media). Uploading, removing and video come later; they
 * show the in-development screen (config/inDevelopment.ts).
 */
export default function MediaPage(): ReactElement {
  const sim = useIsSimulation();
  const { can } = useAuth();
  const media = useMediaLibrary();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [layout, setLayout] = useState<Layout>('grid');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const all = useMemo(() => media.data?.pages.flatMap((p) => p.items) ?? [], [media.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((m) => !q || `${nameOf(m)} ${author(m)} ${m.creative_id}`.toLowerCase().includes(q));
  }, [all, search]);
  const open = all.find((m) => m.asset_id === openId);

  return (
    <VStack gap={8}>
      <PageHeader title="Media" description="Images generated from your drafts, newest first."
        actions={can('creative:write') ? <Button variant="primary" icon="up" onClick={() => setUploading(true)}>Upload</Button> : undefined} />

      <VStack gap={4}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <SegmentedControl label="Type" value={kind} onChange={(v) => setKind(v as Kind)}>
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="image" label="Images" />
            <SegmentedControlItem value="video" label="Videos" />
          </SegmentedControl>
          <StackItem size="fill">{null}</StackItem>
          <VStack width={300} maxWidth="100%">
            <TextInput label="Search media" isLabelHidden type="search" placeholder="Search by draft or person" value={search} onChange={setSearch} hasClear
              startIcon={<Icon name="search" />} />
          </VStack>
          <SegmentedControl label="Layout" value={layout} onChange={(v) => setLayout(v as Layout)}>
            <SegmentedControlItem value="grid" label="Grid" />
            <SegmentedControlItem value="table" label="Table" />
          </SegmentedControl>
        </HStack>
        {kind === 'video' && IN_DEVELOPMENT.mediaVideo
          ? <InDevelopment feature="Video" description="Videos in the media library are being built and will be available soon. Images are ready now." />
          : (
        <QueryState query={media} what="the media library">
          {() => !rows.length
            ? <EmptyState icon="img" title={search ? 'No files match' : 'No media yet'} description={search ? 'Try another search.' : 'Images generated from a brief appear here.'} />
            : layout === 'grid'
              ? (
                <Grid columns={{ minWidth: 220, repeat: 'fill' }} gap={4}>
                  {rows.map((m) => <MediaTile key={m.asset_id} m={m} onOpen={() => setOpenId(m.asset_id)} />)}
                </Grid>
              )
              : <Table<MediaItem> data={rows} columns={mediaColumns((m) => setOpenId(m.asset_id))} idKey="asset_id" density="balanced" dividers="rows" hasHover />}
        </QueryState>
          )}
        {!(kind === 'video' && IN_DEVELOPMENT.mediaVideo) && media.isSuccess && (
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Text type="supporting" color="secondary">{rows.length} of {all.length} files{media.hasNextPage ? ' loaded' : ''}{sim ? ' · Simulation: pictures are placeholders.' : ''}</Text>
            {media.hasNextPage && (
              <Button size="sm" variant="secondary" loading={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>Show older images</Button>
            )}
          </HStack>
        )}
      </VStack>

      {open && <MediaDrawer m={open} onClose={() => setOpenId(null)} />}
      {uploading && (IN_DEVELOPMENT.mediaUpload
        ? <InDevelopmentDialog feature="Upload media" description="Uploading images and videos is being built and will be available soon. Images generated from a brief are ready now." onClose={() => setUploading(false)} />
        : <UploadDialog onClose={() => setUploading(false)} />)}
    </VStack>
  );
}

/** One file in the grid: the Astryx card-grid tile (picture, then name, person and date). */
function MediaTile({ m, onOpen }: { m: MediaItem; onOpen: () => void }) {
  return (
    <ClickableCard label={`${nameOf(m)}. Open details`} onClick={onOpen} padding={0}>
      <AspectRatio ratio={4 / 3} fit="cover">
        {m.download_url
          ? <img src={m.download_url} alt="" />
          : <Center axis="both" height="100%"><Icon name="img" size={24} color="secondary" /></Center>}
      </AspectRatio>
      <Section variant="transparent" padding={4}>
        <VStack gap={1}>
          <Text type="body" weight="semibold" maxLines={1}>{nameOf(m)}</Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {author(m)} · <Timestamp value={m.created_at} format="relative" type="supporting" color="secondary" />
          </Text>
        </VStack>
      </Section>
    </ClickableCard>
  );
}

function mediaColumns(onOpen: (m: MediaItem) => void): TableColumn<MediaItem>[] {
  return [
    { key: 'asset_id', header: 'File', width: proportional(3, { minWidth: 220 }), renderCell: (m) => <Link onClick={() => onOpen(m)}>{nameOf(m)}</Link> },
    { key: 'origin', header: 'Origin', width: pixel(120), renderCell: (m) => ORIGIN[m.origin] },
    { key: 'width_px', header: 'Size', width: pixel(160), renderCell: (m) => `${m.width_px}×${m.height_px} · ${fmtBytes(m.size_bytes)}` },
    { key: 'created_by', header: 'Made by', width: pixel(180), renderCell: (m) => author(m) },
    { key: 'created_at', header: 'Made', width: pixel(160), renderCell: (m) => <Timestamp value={m.created_at} format="relative" /> },
  ];
}

function MediaDrawer({ m, onClose }: { m: MediaItem; onClose: () => void }) {
  const { can } = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const archive = useWorkspaceMutation((id: string) => workspaceApi.archiveMedia(id), ['media-library']);
  return (
    <Drawer open onClose={onClose} title={nameOf(m)} subtitle={`Image · ${m.width_px}×${m.height_px} · ${fmtBytes(m.size_bytes)}`}
      footer={can('creative:write') ? <Button variant="danger-outline" onClick={() => setConfirm(true)}>Remove from library</Button> : undefined}>
      <VStack gap={5}>
        {m.download_url
          ? <AspectRatio ratio={m.width_px / m.height_px} fit="contain"><img src={m.download_url} alt={`Generated for ${nameOf(m)}`} /></AspectRatio>
          : <EmptyState icon="img" title="Preview not available" description="The link to this image could not be made. Open the draft to see it." />}
        <MetadataList title="File">
          <MetadataListItem label="Origin">{ORIGIN[m.origin]}</MetadataListItem>
          <MetadataListItem label="Type">{m.mime_type}</MetadataListItem>
          <MetadataListItem label="Made">{author(m)} · {fmtDateTime(m.created_at)}</MetadataListItem>
          <MetadataListItem label="From">
            <Link href={draftHref(m)}>Draft {shortId(m.creative_id)}, version {m.creative_version}</Link>
          </MetadataListItem>
        </MetadataList>
      </VStack>
      {confirm && IN_DEVELOPMENT.mediaUpload && (
        <InDevelopmentDialog feature="Remove from library" description="Removing files from the library is being built and will be available soon." onClose={() => setConfirm(false)} />
      )}
      <AlertDialog isOpen={confirm && !IN_DEVELOPMENT.mediaUpload} onOpenChange={setConfirm} title="Remove this file?"
        description="It will no longer be available for new posts."
        actionLabel="Remove" isActionLoading={archive.isPending}
        onAction={async () => {
          try { await archive.mutateAsync([m.asset_id]); setConfirm(false); onClose(); toast('File removed', 'done'); }
          catch (e) { setConfirm(false); toast(isApiError(e) ? e.message : 'Could not remove the file', 'blocked'); }
        }} />
    </Drawer>
  );
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const sim = useIsSimulation();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [licence, setLicence] = useState('');
  const [expires, setExpires] = useState<ISODate | undefined>();
  const [people, setPeople] = useState(false);
  const [consent, setConsent] = useState(false);
  const [tags, setTags] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upload = useWorkspaceMutation((body: MediaUpload) => workspaceApi.uploadMedia(body), ['media-library']);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!file) e.name = 'Choose a file to upload.';
    if (!source.trim()) e.source = 'Say where the file comes from.';
    if (!licence.trim()) e.licence = 'Say what licence covers it.';
    setErrors(e);
    if (Object.keys(e).length || !file) return;
    try {
      const asset = await upload.mutateAsync([{
        name: file.name, kind: file.type.startsWith('video/') ? 'video' : 'image', mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
        source: source.trim(), licence: licence.trim(), expires_at: expires ? `${expires}T23:59:00Z` : null,
        people_shown: people, consent_on_file: consent, tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }]);
      toast(asset.status === 'BLOCKED' ? 'Uploaded, but blocked' : 'Uploaded', asset.status === 'BLOCKED' ? 'waiting' : 'done', asset.status_reason ?? undefined);
      onClose();
    } catch (err) {
      const f = fieldMessagesOf(err);
      if (Object.keys(f).length) setErrors(f);
      else toast(isApiError(err) ? err.message : 'The upload failed', 'blocked');
    }
  };

  const status = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);
  return (
    <Modal open onClose={onClose} title="Upload media" size="lg"
      footer={(<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={upload.isPending} onClick={() => void submit()}>Upload</Button></>)}>
      <VStack gap={5}>
        <FileInput label="File" mode="dropzone" accept="image/jpeg,image/png,image/webp,video/mp4" maxSize={50_000_000} isRequired
          value={file} onChange={(f) => { setFile(Array.isArray(f) ? f[0] ?? null : f); setErrors((x) => ({ ...x, name: '' })); }}
          description={`JPEG, PNG, WebP or MP4, up to 50 MB.${sim ? ' In simulation the file is not sent anywhere.' : ''}`} status={status('name')} statusVariant="detached" />
        <Grid columns={{ minWidth: 220 }} gap={4}>
          <TextInput label="Source" isRequired value={source} onChange={(v) => { setSource(v); setErrors((x) => ({ ...x, source: '' })); }} placeholder="Photographer, agency or library" width="100%" status={status('source')} statusVariant="detached" />
          <TextInput label="Licence" isRequired value={licence} onChange={(v) => { setLicence(v); setErrors((x) => ({ ...x, licence: '' })); }} placeholder="Owned, standard stock, editorial…" width="100%" status={status('licence')} statusVariant="detached" />
        </Grid>
        <DateInput label="Licence ends" isOptional value={expires} onChange={(v) => setExpires(v ?? undefined)} description="Leave empty if it does not expire." />
        <Switch label="People can be identified in it" value={people} onChange={setPeople} description="Photos or video of identifiable people need a signed release." />
        {people && (
          <CheckboxInput label="A signed release is on file for everyone shown" value={consent} onChange={setConsent}
            description="Without it the file is blocked and cannot be used in a post." />
        )}
        <TextInput label="Tags" isOptional value={tags} onChange={setTags} placeholder="clinic, interior" description="Separate tags with commas." width="100%" />
      </VStack>
    </Modal>
  );
}
