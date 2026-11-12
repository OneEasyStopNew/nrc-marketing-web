import { useMemo, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ComponentProps } from 'react';

type ISODate = NonNullable<ComponentProps<typeof DateInput>['value']>;
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { useAuth } from '@/auth/AuthProvider';
import { fieldMessagesOf, isApiError } from '@/api/errors';
import { workspaceApi, type MediaAsset, type MediaStatus, type MediaUpload } from '@/api/workspace';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Alert, EmptyState, PageHeader } from '@/components/ui/Misc';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { useMedia, useWorkspaceMutation } from '@/pages/shared/queries';
import { MediaBadge, QueryState, fmtBytes, useIsSimulation } from '@/pages/shared/ui';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Center } from '@astryxdesign/core/Center';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Section } from '@astryxdesign/core/Section';
import { Timestamp } from '@astryxdesign/core/Timestamp';

type Kind = 'all' | 'image' | 'video';
type Layout = 'grid' | 'table';

// Demo switch (NRC-18, 11 Nov 2026). Owner: Firoz. Media upload and removal are not built in the backend
// yet, so the controls explain that instead of calling the API.
// Remove when the backend upload (NRC-3) and archive endpoints merge: delete this switch and the two
// "not available" messages, let Upload and Remove open their dialogs again, delete the "not available
// yet" test in e2e/workspace.spec.ts and the "media-upload" message audit in e2e/layout.spec.ts, and
// drop the fixme on "media-upload-dialog" there.
const MEDIA_WRITES_AVAILABLE = false;
const UPLOAD_NOT_AVAILABLE = ['Uploading is not available yet', 'Uploading images and videos is being built in the backend. Generated images appear here once they are made.'] as const;
const REMOVE_NOT_AVAILABLE = ['Removing media is not available yet', 'Removing files from the library is being built in the backend. Nothing was removed.'] as const;

/**
 * Media library (NRC-18): images and videos Marketing may use, with where
 * each came from, its licence and consent. Blocked or expired files cannot be
 * used in a post; the reason is always shown.
 */
export default function MediaPage() {
  const sim = useIsSimulation();
  const { can } = useAuth();
  const { toast } = useToast();
  const media = useMedia();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState<MediaStatus | 'any'>('any');
  const [layout, setLayout] = useState<Layout>('grid');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (media.data ?? []).filter((m) =>
      (kind === 'all' || m.kind === kind)
      && (status === 'any' || m.status === status)
      && (!q || `${m.name} ${m.tags.join(' ')} ${m.rights.source}`.toLowerCase().includes(q)));
  }, [media.data, search, kind, status]);
  const open = (media.data ?? []).find((m) => m.asset_id === openId);

  return (
    <VStack gap={8}>
      <PageHeader title="Media" description="Images and videos you may use, with their source, licence and consent."
        actions={can('creative:write') ? <Button variant="primary" icon="up" onClick={() => (MEDIA_WRITES_AVAILABLE ? setUploading(true) : toast(UPLOAD_NOT_AVAILABLE[0], 'info', UPLOAD_NOT_AVAILABLE[1]))}>Upload</Button> : undefined} />

      <VStack gap={4}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <SegmentedControl label="Type" value={kind} onChange={(v) => setKind(v as Kind)}>
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="image" label="Images" />
            <SegmentedControlItem value="video" label="Videos" />
          </SegmentedControl>
          <Selector label="Status" isLabelHidden value={status} onChange={(v) => setStatus((v ?? 'any') as MediaStatus | 'any')}
            options={[{ value: 'any', label: 'Any status' }, { value: 'AVAILABLE', label: 'Available' }, { value: 'PENDING_CHECK', label: 'Being checked' }, { value: 'BLOCKED', label: 'Blocked' }, { value: 'EXPIRED', label: 'Licence expired' }]} />
          <StackItem size="fill">{null}</StackItem>
          <VStack width={300} maxWidth="100%">
            <TextInput label="Search media" isLabelHidden type="search" placeholder="Search by name, tag or source" value={search} onChange={setSearch} hasClear
              startIcon={<Icon name="search" />} />
          </VStack>
          <SegmentedControl label="Layout" value={layout} onChange={(v) => setLayout(v as Layout)}>
            <SegmentedControlItem value="grid" label="Grid" />
            <SegmentedControlItem value="table" label="Table" />
          </SegmentedControl>
        </HStack>
        <QueryState query={media} what="the media library">
          {() => !rows.length
            ? <EmptyState icon="img" title={search || kind !== 'all' || status !== 'any' ? 'No files match' : 'No media yet'} description={search ? 'Try another search or clear the filters.' : 'Upload images or generate them from a brief.'} />
            : layout === 'grid'
              ? (
                <Grid columns={{ minWidth: 220, repeat: 'fill' }} gap={4}>
                  {rows.map((m) => <MediaTile key={m.asset_id} m={m} onOpen={() => setOpenId(m.asset_id)} />)}
                </Grid>
              )
              : <Table<MediaAsset> data={rows} columns={mediaColumns((m) => setOpenId(m.asset_id))} idKey="asset_id" density="balanced" dividers="rows" hasHover />}
        </QueryState>
        <Text type="supporting" color="secondary">{rows.length} of {media.data?.length ?? 0} files{sim ? ' · Simulation: pictures are placeholders.' : ''}</Text>
      </VStack>

      {open && <MediaDrawer m={open} onClose={() => setOpenId(null)} />}
      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
    </VStack>
  );
}

/** One file in the grid: the Astryx card-grid tile (picture, then name and status). */
function MediaTile({ m, onOpen }: { m: MediaAsset; onOpen: () => void }) {
  return (
    <ClickableCard label={`${m.name}, ${m.status.toLowerCase().replace('_', ' ')}. Open details`} onClick={onOpen} padding={0}>
      <AspectRatio ratio={4 / 3} fit="cover">
        {m.preview_url
          ? <img src={m.preview_url} alt="" />
          : <Center axis="both" height="100%"><Icon name={m.kind === 'video' ? 'video' : 'img'} size={24} color="secondary" /></Center>}
      </AspectRatio>
      <Section variant="transparent" padding={4}>
        <VStack gap={2}>
          <Text type="body" weight="semibold" maxLines={1}>{m.name}</Text>
          <HStack gap={2} hAlign="between" vAlign="center">
            <MediaBadge value={m.status} />
            <Text type="supporting" color="secondary">
              {m.kind === 'video' && m.duration_s != null ? `${m.duration_s}s · ` : ''}<Timestamp value={m.created_at} format="relative" type="supporting" color="secondary" />
            </Text>
          </HStack>
        </VStack>
      </Section>
    </ClickableCard>
  );
}

function mediaColumns(onOpen: (m: MediaAsset) => void): TableColumn<MediaAsset>[] {
  return [
    { key: 'name', header: 'File', width: proportional(3, { minWidth: 220 }), renderCell: (m) => <Link onClick={() => onOpen(m)}>{m.name}</Link> },
    { key: 'kind', header: 'Type', width: pixel(110), renderCell: (m) => (m.kind === 'video' ? 'Video' : 'Image') },
    { key: 'origin', header: 'Origin', width: pixel(120), renderCell: (m) => ({ generated: 'Generated', uploaded: 'Uploaded', stock: 'Stock' })[m.origin] },
    { key: 'size_bytes', header: 'Size', width: pixel(100), renderCell: (m) => fmtBytes(m.size_bytes) },
    { key: 'status', header: 'Status', width: pixel(160), renderCell: (m) => <MediaBadge value={m.status} /> },
    { key: 'used_in', header: 'Used in', width: pixel(100), renderCell: (m) => `${m.used_in} draft${m.used_in === 1 ? '' : 's'}` },
  ];
}

function MediaDrawer({ m, onClose }: { m: MediaAsset; onClose: () => void }) {
  const { can } = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const archive = useWorkspaceMutation((id: string) => workspaceApi.archiveMedia(id), ['media']);
  return (
    <Drawer open onClose={onClose} title={m.name} subtitle={`${m.kind === 'video' ? 'Video' : 'Image'} · ${m.width_px}×${m.height_px} · ${fmtBytes(m.size_bytes)}`} badge={<MediaBadge value={m.status} />}
      footer={can('creative:write') ? <Button variant="danger-outline" onClick={() => (MEDIA_WRITES_AVAILABLE ? setConfirm(true) : toast(REMOVE_NOT_AVAILABLE[0], 'info', REMOVE_NOT_AVAILABLE[1]))}>Remove from library</Button> : undefined}>
      <VStack gap={5}>
        {m.status_reason && <Alert tone={m.status === 'BLOCKED' ? 'blocked' : m.status === 'EXPIRED' ? 'waiting' : 'info'} title={m.status_reason} />}
        {m.preview_url
          ? <AspectRatio ratio={m.width_px / m.height_px} fit="contain"><img src={m.preview_url} alt={`Preview of ${m.name}`} /></AspectRatio>
          : <EmptyState icon="video" title="Preview not available" />}
        <MetadataList title="Rights">
          <MetadataListItem label="Source">{m.rights.source}</MetadataListItem>
          <MetadataListItem label="Licence">{m.rights.licence}</MetadataListItem>
          <MetadataListItem label="Licence ends">{m.rights.expires_at ? fmtDateTime(m.rights.expires_at) : 'Does not expire'}</MetadataListItem>
          <MetadataListItem label="People shown">{m.rights.people_shown ? 'Yes' : 'No'}</MetadataListItem>
          <MetadataListItem label="Signed release">{m.rights.people_shown ? (m.rights.consent_on_file ? 'On file' : 'Missing') : 'Not needed'}</MetadataListItem>
        </MetadataList>
        <MetadataList title="File">
          <MetadataListItem label="Origin">{({ generated: 'Generated', uploaded: 'Uploaded', stock: 'Stock library' })[m.origin]}</MetadataListItem>
          <MetadataListItem label="Added">{m.created_by} · {fmtDateTime(m.created_at)}</MetadataListItem>
          <MetadataListItem label="Used in">{m.used_in} draft{m.used_in === 1 ? '' : 's'}</MetadataListItem>
          <MetadataListItem label="Tags">
            {m.tags.length ? <HStack gap={1} wrap="wrap">{m.tags.map((t) => <Token key={t} label={t} size="sm" />)}</HStack> : '—'}
          </MetadataListItem>
        </MetadataList>
      </VStack>
      <AlertDialog isOpen={confirm} onOpenChange={setConfirm} title="Remove this file?"
        description={m.used_in > 0 ? 'It is used in a draft, so it cannot be removed until it is taken out of that draft.' : 'It will no longer be available for new posts.'}
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
  const upload = useWorkspaceMutation((body: MediaUpload) => workspaceApi.uploadMedia(body), ['media']);

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
