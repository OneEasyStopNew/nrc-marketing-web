import { useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { useSession } from '@/auth/AuthProvider';
import {
  AI_FIX_INSTRUCTIONS_MAX, clientPostsApi, newClientKey, type CheckPart, type ClientMedia, type ClientPost,
} from '@/api/clientPosts';
import { isApiError } from '@/api/errors';
import { isInProgress } from '@/api/validations';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Form';
import { Alert, SkeletonRows } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { charCount } from '@/lib/utils';
import { postKey, useAiFix } from './useClientPost';
import { Wrap } from './Wrap';

type SaveVersion = (body: { asset_ids: string[]; change_note: string }) => Promise<boolean>;

/**
 * The optional, paid AI fix of one flagged image (NRC-41). Nothing is
 * generated until the user confirms the cost. The new picture never replaces
 * the original by itself: "Use the new image" saves a new version, which must
 * be checked again.
 */
export function AiFixAction({ post, media, part, nowSrc, saving, onSave }: {
  post: ClientPost;
  media: ClientMedia;
  /** The current check's result for this image; it must have findings. */
  part: CheckPart;
  /** What the image looks like now. */
  nowSrc: string | null;
  saving: boolean;
  onSave: SaveVersion;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [fixId, setFixId] = useState<string | null>(null);
  const fix = useAiFix(post.id, fixId);
  const working = !!fix.data && isInProgress(fix.data.state);
  const ready = fix.data?.state === 'SUCCEEDED' && !!fix.data.result;

  return (
    <>
      <Button variant="secondary" icon="spark" onClick={() => setOpen(true)}>
        {ready ? 'See the AI fixed image' : working ? 'AI fix in progress' : 'Fix with AI (paid)'}
      </Button>
      {open && (
        <AiFixDialog post={post} media={media} part={part} nowSrc={nowSrc} saving={saving} onSave={onSave}
          fixId={fixId} onStarted={setFixId} onReset={() => setFixId(null)} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function AiFixDialog({ post, media, part, nowSrc, saving, onSave, fixId, onStarted, onReset, onClose }: {
  post: ClientPost;
  media: ClientMedia;
  part: CheckPart;
  nowSrc: string | null;
  saving: boolean;
  onSave: SaveVersion;
  fixId: string | null;
  onStarted: (fixId: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { context } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fix = useAiFix(post.id, fixId);
  const [instructions, setInstructions] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Same key when the same request is sent again after a lost answer. */
  const pending = useRef<{ body: string; key: string } | null>(null);
  const tooLong = charCount(instructions) > AI_FIX_INSTRUCTIONS_MAX;

  const start = async () => {
    const body = { post_version: post.version, asset_id: media.asset_id, instructions: instructions.trim() || null };
    const sig = JSON.stringify(body);
    if (pending.current?.body !== sig) pending.current = { body: sig, key: newClientKey('ai_fix') };
    setStarting(true);
    try {
      const started = await clientPostsApi.startAiFix(post.id, body, pending.current.key);
      pending.current = null;
      qc.setQueryData(['client-ai-fix', context.tenant.tenant_id, post.id, started.fix_id], started);
      onStarted(started.fix_id);
      // The post's count of paid requests went up.
      void qc.invalidateQueries({ queryKey: postKey(context.tenant.tenant_id, post.id) });
    } catch (e) {
      if (!isApiError(e)) throw e;
      if (e.kind === 'forbidden') toast('Your role cannot make AI requests', 'blocked');
      else if (e.code === 'VERSION_CONFLICT') toast('The post changed', 'waiting', 'Reload it and check the latest version before fixing with AI.');
      else toast('The AI fix could not start', 'blocked', e.retryable ? 'Try again in a moment.' : e.message);
      if (!e.retryable) pending.current = null;
    } finally {
      setStarting(false);
    }
  };

  const use = async () => {
    const result = fix.data?.result;
    if (!result) return;
    const ok = await onSave({
      asset_ids: post.media.map((m) => (m.asset_id === media.asset_id ? result.asset_id : m.asset_id)),
      change_note: `Used the AI fixed image for ${media.file_name}`,
    });
    if (ok) onClose();
  };

  const state = fix.data?.state;
  const result = fix.data?.result ?? null;

  // Finished: the original and the new picture side by side.
  if (state === 'SUCCEEDED' && result) {
    return (
      <Modal open onClose={onClose} size="xl" icon="spark" title="The AI fixed image"
        footer={<Button variant="primary" loading={saving} onClick={() => void use()}>Use it as version {post.version + 1}</Button>}>
        <VStack gap={4}>
          <Alert tone="waiting" title="The new image has not been checked">
            Using it saves version {post.version + 1}. Check that version before the post is used. Your original stays in the version history.
          </Alert>
          <Grid columns={{ minWidth: 240 }} gap={3}>
            <Picture title={`Now (version ${post.version})`} src={nowSrc} alt={`${media.file_name}, as it is now`} ratio={media} />
            <Picture title="AI fixed, not checked yet" src={result.preview_url} alt="The AI fixed image" ratio={result} />
          </Grid>
          <Text type="supporting" color="secondary">This fix made {fix.data?.generation_requests ?? 1} paid AI request.</Text>
          {/* In the scrolling body, so keyboard users can reach and scroll it on small screens. */}
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="body">Not what you wanted?</Text>
            <Button variant="secondary" onClick={() => { onReset(); onClose(); }}>Discard the new image</Button>
          </HStack>
        </VStack>
      </Modal>
    );
  }

  // Failed: say so; trying again is a new paid request.
  if (state === 'FAILED' || state === 'CANCELLED') {
    return (
      <Modal open onClose={onClose} size="md" icon="spark" title="The AI fix did not finish"
        footer={(
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setAgreed(false); onReset(); }}>Try again</Button>
          </>
        )}>
        <Alert tone="blocked" title="No new image was made">
          {fix.data?.error ?? 'Try again, or replace the file yourself.'} Trying again is a new paid request. The post did not change.
        </Alert>
      </Modal>
    );
  }

  // Running.
  if (fixId) {
    return (
      <Modal open onClose={onClose} size="md" icon="spark" title="Making the new image"
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <VStack gap={3}>
          <VisuallyHidden><span role="status">Making the new image</span></VisuallyHidden>
          {fix.isError
            ? <Alert tone="waiting" title="The progress could not be loaded">The request is still running. Close this and open it again in a moment.</Alert>
            : <SkeletonRows rows={3} />}
          <Text type="body" color="secondary">This can take a minute. You can close this window; the request continues and the result appears here.</Text>
        </VStack>
      </Modal>
    );
  }

  // Confirm the cost first.
  return (
    <Modal open onClose={onClose} size="lg" icon="spark" title={`Fix ${media.file_name} with AI`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="spark" loading={starting} disabled={!agreed || tooLong} onClick={() => void start()}>
            Make 1 paid request
          </Button>
        </>
      )}>
      <VStack gap={4}>
        <Alert tone="waiting" icon="dollar" title="This is a paid AI request">
          It makes 1 AI image generation request, charged to your organisation. Checking a post never makes one.
        </Alert>
        <VStack gap={2}>
          <Heading level={3}>What happens</Heading>
          <List listStyle="decimal" density="compact">
            <ListItem label={<Wrap>A new image is made from this one, aimed at the findings below.</Wrap>} />
            <ListItem label={<Wrap>Your original image does not change.</Wrap>} />
            <ListItem label={<Wrap>You choose whether to use the new image. Using it saves version {post.version + 1}, which must be checked again.</Wrap>} />
          </List>
        </VStack>
        <VStack gap={2}>
          <Heading level={3}>Findings to fix</Heading>
          <List listStyle="disc" density="compact">
            {part.findings.map((f, i) => <ListItem key={i} label={<Wrap>{f.explanation}</Wrap>} description={f.rule_id} />)}
          </List>
        </VStack>
        <Textarea label="Instructions for the AI (optional)" rows={3} value={instructions} limit={AI_FIX_INSTRUCTIONS_MAX}
          help="For example: keep the colours and the people; remove the words on the banner."
          onChange={(e) => setInstructions(e.target.value)} />
        <CheckboxInput label="I understand this makes 1 paid request" value={agreed} onChange={setAgreed} />
      </VStack>
    </Modal>
  );
}

function Picture({ title, src, alt, ratio }: { title: string; src: string | null; alt: string; ratio: Pick<ClientMedia, 'width_px' | 'height_px'> }) {
  const r = ratio.width_px && ratio.height_px ? ratio.width_px / ratio.height_px : 1;
  return (
    <AxCard padding={3}>
      <VStack gap={2}>
        <Text type="body" weight="semibold">{title}</Text>
        {src
          ? <AspectRatio ratio={r} fit="contain"><img src={src} alt={alt} decoding="async" /></AspectRatio>
          : <Text type="body" color="secondary">No preview available.</Text>}
      </VStack>
    </AxCard>
  );
}
