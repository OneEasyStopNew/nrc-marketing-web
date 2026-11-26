import { useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { useAuth, useSession } from '@/auth/AuthProvider';
import {
  CLIENT_CAPTION_MAX, MAX_IMAGES, MAX_UPLOAD_BYTES, clientPostsApi, newClientKey, type ClientMedia, type ClientPostSetup,
} from '@/api/clientPosts';
import { fieldErrorsOf } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardFoot } from '@/components/ui/Card';
import { Select, Textarea } from '@/components/ui/Form';
import { Alert, EmptyState } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { charCount } from '@/lib/utils';
import { fmtBytes } from '@/pages/shared/ui';
import { StudyFacts, Step, formatKey, formatLabel, languageLabel } from '../parts';
import { MoveButtons, moveItem } from './order';
import { Wrap } from './Wrap';
import { postKey } from './useClientPost';

/** One file the user chose: uploading, or as the server answered. */
interface Picked {
  localId: string;
  name: string;
  uploading: boolean;
  media?: ClientMedia;
  error?: string;
}

type Errors = Partial<Record<'study_id' | 'caption' | 'files' | 'post_format' | 'language', string>>;

/**
 * Checking a post the client already made (NRC-41): the caption and the
 * existing images or video, the study it is for and where it will go. No
 * brief, no generation and no social account are needed. Saving creates
 * version 1 and starts the combined check.
 */
export function NewClientPost(): ReactElement {
  const { context } = useSession();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const recruiting = context.studies.filter((s) => s.recruitment_status === 'recruiting');
  const [studyId, setStudyId] = useState(recruiting[0]?.study_id ?? '');
  const study = recruiting.find((s) => s.study_id === studyId) ?? null;
  const first = context.post_formats[0];
  const [setup, setSetup] = useState<Omit<ClientPostSetup, 'study_id'>>({
    language: context.languages[0] ?? 'en', channel: first?.channel ?? 'facebook', post_format: first?.post_format ?? 'feed_image',
  });
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  /** Same key when the same post is saved again after a lost answer. */
  const pendingCreate = useRef<{ body: string; key: string } | null>(null);

  if (!recruiting.length) {
    return (
      <Card>
        <EmptyState icon="clock" title="No study is recruiting right now"
          description="A post is checked against a recruiting study's approved facts. Checking opens again when a study is recruiting." />
      </Card>
    );
  }

  const ready = files.flatMap((f) => (f.media?.state === 'READY' ? [f.media] : []));
  const uploading = files.some((f) => f.uploading);
  const problems = files.filter((f) => f.error || (f.media && f.media.state !== 'READY'));
  const videos = ready.filter((m) => m.kind === 'video').length;

  const upload = async (list: File[]) => {
    const added = list.map((file) => ({ localId: crypto.randomUUID(), name: file.name, uploading: true }));
    setFiles((fs) => [...fs, ...added]);
    setErrors((e) => ({ ...e, files: undefined }));
    await Promise.all(list.map(async (file, i) => {
      const localId = added[i].localId;
      try {
        const media = await clientPostsApi.upload(file, newClientKey('upload'));
        setFiles((fs) => fs.map((f) => (f.localId === localId ? { ...f, uploading: false, media } : f)));
      } catch (e) {
        const msg = isApiError(e) ? e.message : 'The upload did not finish.';
        setFiles((fs) => fs.map((f) => (f.localId === localId ? { ...f, uploading: false, error: msg } : f)));
      }
    }));
  };

  /** Obvious completeness and limits; the backend stays authoritative. */
  const localErrors = (): Errors => {
    const e: Errors = {};
    if (!studyId) e.study_id = 'Choose the study this post is for.';
    if (charCount(caption) > CLIENT_CAPTION_MAX) e.caption = `Shorten the caption to ${CLIENT_CAPTION_MAX} characters.`;
    if (!caption.trim() && !ready.length) e.caption = 'Add the caption, the files, or both.';
    if (uploading) e.files = 'Wait for the uploads to finish.';
    else if (problems.length) e.files = 'Remove the files that could not be used.';
    else if (videos && ready.length > 1) e.files = 'A post holds images or one video, not both. Remove the extra files.';
    else if (ready.length > MAX_IMAGES) e.files = `A carousel holds up to ${MAX_IMAGES} images.`;
    return e;
  };

  const save = async () => {
    const e = localErrors();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { study_id: studyId, ...setup, caption, asset_ids: ready.map((m) => m.asset_id) };
    const sig = JSON.stringify(body);
    if (pendingCreate.current?.body !== sig) pendingCreate.current = { body: sig, key: newClientKey('client_post') };
    setSaving(true);
    try {
      const created = await clientPostsApi.create(body, pendingCreate.current.key);
      pendingCreate.current = null;
      qc.setQueryData(postKey(context.tenant.tenant_id, created.post.id), created);
      // The check starts from the saved version. If it cannot start now, the post's
      // page says "Not checked yet" and offers the check again.
      await clientPostsApi.startCheck(created.post.id, created.post.version, newClientKey('check')).catch(() => undefined);
      navigate(`/marketing/create/check/${encodeURIComponent(created.post.id)}`);
    } catch (err) {
      if (!isApiError(err)) throw err;
      const fields = fieldErrorsOf(err) as Errors;
      if (Object.keys(fields).length) setErrors(fields);
      else toast('The post could not be saved', 'blocked', err.retryable ? 'Try again in a moment.' : err.message);
      if (!err.retryable) pendingCreate.current = null;
    } finally {
      setSaving(false);
    }
  };

  const fileState = (f: Picked) => {
    if (f.uploading) return <Badge variant="brand">Uploading</Badge>;
    if (f.error) return <Badge variant="blocked">Upload failed</Badge>;
    if (f.media?.state === 'READY') return <Badge variant="done">Ready</Badge>;
    if (f.media?.state === 'SCANNING') return <Badge variant="waiting">Being checked for safety</Badge>;
    return <Badge variant="blocked">Rejected</Badge>;
  };

  return (
    <Card>
      <Alert tone="info" icon="shield" title="Checking only, nothing is generated">
        The caption and files are checked against the study's approved facts and the policy rules. No AI image or video is made, so there is no generation cost.
      </Alert>

      <Step n={1} title="Study">
        <VStack gap={3}>
          <Select label="Study" required value={studyId} error={errors.study_id} onChange={(e) => setStudyId(e.target.value)}
            help="The post is checked against this study's approved facts.">
            <option value="" disabled>Choose a study</option>
            {recruiting.map((s) => <option key={s.study_id} value={s.study_id}>{s.study_title}</option>)}
          </Select>
          {study && <StudyFacts study={study} />}
        </VStack>
      </Step>

      <Step n={2} title="Where it goes">
        <Grid columns={{ minWidth: 220 }} gap={4}>
          <Select label="Post format" value={formatKey(setup)} error={errors.post_format}
            onChange={(e) => {
              const f = context.post_formats.find((x) => formatKey(x) === e.target.value);
              if (f) setSetup((s) => ({ ...s, channel: f.channel, post_format: f.post_format }));
            }}>
            {context.post_formats.map((f) => <option key={formatKey(f)} value={formatKey(f)}>{formatLabel(f)}</option>)}
          </Select>
          <Select label="Language" value={setup.language} error={errors.language}
            onChange={(e) => { const l = context.languages.find((x) => x === e.target.value); if (l) setSetup((s) => ({ ...s, language: l })); }}>
            {context.languages.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
          </Select>
        </Grid>
      </Step>

      <Step n={3} title="The post as it is">
        <VStack gap={4}>
          <Textarea label="Caption" rows={5} value={caption} limit={CLIENT_CAPTION_MAX} error={errors.caption}
            help="Paste the caption exactly as it would be posted."
            onChange={(e) => { setCaption(e.target.value); setErrors((x) => ({ ...x, caption: undefined })); }} />
          <VStack gap={2}>
            <FileInput label="Images or video" mode="dropzone" isMultiple accept="image/*,video/*" value={[]} maxSize={MAX_UPLOAD_BYTES}
              description={`Up to ${MAX_IMAGES} images for a carousel, or one video. The order below is the order they are posted in. Files are checked for safety when they arrive.`}
              status={errors.files ? { type: 'error', message: errors.files } : undefined} statusVariant="detached"
              onChange={(picked) => { const list = Array.isArray(picked) ? picked : picked ? [picked] : []; if (list.length) void upload(list); }} />
            {files.length > 0 && (
              <List hasDividers aria-label="Chosen files">
                {files.map((f, i) => (
                  <ListItem key={f.localId}
                    label={<HStack gap={2} vAlign="center" wrap="wrap"><Text type="body" weight="semibold" wordBreak="break-word">{i + 1}. {f.name}</Text>{fileState(f)}</HStack>}
                    description={f.error ?? f.media?.state_reason
                      ? <Wrap secondary>{f.error ?? f.media?.state_reason}</Wrap>
                      : f.media
                        ? `${f.media.kind === 'video' ? `Video, ${f.media.duration_s ?? '?'} s` : 'Image'} · ${f.media.width_px}×${f.media.height_px} · ${fmtBytes(f.media.size_bytes)}`
                        : undefined}
                    endContent={(
                      <HStack gap={1} vAlign="center">
                        {files.length > 1 && (
                          <MoveButtons index={i} count={files.length} name={f.name} disabled={saving}
                            onMove={(from, to) => setFiles((fs) => moveItem(fs, from, to))} />
                        )}
                        <Button variant="ghost" size="sm" icon="x" aria-label={`Remove ${f.name}`} disabled={f.uploading}
                          onClick={() => setFiles((fs) => fs.filter((x) => x.localId !== f.localId))}>Remove</Button>
                      </HStack>
                    )} />
                ))}
              </List>
            )}
          </VStack>
        </VStack>
      </Step>

      <CardFoot>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Button variant="primary" icon="shield" loading={saving} disabled={!can('creative:write') || uploading} onClick={() => void save()}>
            Save and check
          </Button>
          <Text type="supporting" color="secondary">
            {can('creative:write') ? 'This is an automated check, not an approval.' : 'Your role cannot add posts here.'}
          </Text>
        </HStack>
      </CardFoot>
    </Card>
  );
}
