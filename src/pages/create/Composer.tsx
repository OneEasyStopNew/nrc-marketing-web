import { SIMULATION_BUILD } from '@/config/env';
import { ChannelLabel } from '@/components/ui/PlatformLogo';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import { Grid } from '@astryxdesign/core/Grid';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useSession } from '@/auth/AuthProvider';
import type { StudySnapshot } from '@/api/session';
import { CAPTION_MAX, PROMPT_MAX, type DraftSetup, type FieldErrors, type Versioned } from '@/api/creatives';
import { http } from '@/api/http';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Select, Textarea } from '@/components/ui/Form';
import { Alert, TwoColumn } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { UnsavedChangesPrompt } from '@/components/UnsavedChangesPrompt';
import { imageAltForBrief } from '@/components/media/imageAlt';
import { charCount, fmtDateTime } from '@/lib/utils';
import {
  ConflictDialog, formatKey, formatLabel, languageLabel, PostPreview, ReadinessCard,
  RequiredWording, SaveStatus, Step, StudyFacts,
} from './parts';
import { useDraftEditor } from './useDraftEditor';
import { FindingsToFix, VersionHistory } from './revisions';
import { useStartValidation } from '@/pages/validation/useValidation';

/**
 * The brief editor, laid out like the NRC Connect "Create post" studio: four
 * numbered steps beside a live preview. A new brief exists only in the browser
 * until "Create draft"; an existing draft autosaves its brief and caption as
 * new versions. Language and format are chosen once, at creation.
 */
export function Composer({ study, initial, readOnly, readOnlyReason, studyPicker, studyId }: {
  /** The study shown in step 1; null while none is chosen. */
  study: StudySnapshot | null;
  initial: Versioned | null;
  readOnly?: boolean;
  readOnlyReason?: string;
  /** New briefs only: the study chooser for step 1. */
  studyPicker?: ReactNode;
  /** New briefs only: the chosen study ('' = not chosen yet). */
  studyId?: string;
}) {
  const { context } = useSession();
  const { mode, can } = useAuth();
  const validation = useStartValidation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ed = useDraftEditor({ initial, readOnly });
  const creative = ed.base?.creative;

  const firstFormat = context.post_formats[0];
  const [setup, setSetup] = useState<DraftSetup>(() => creative
    ? { language: creative.language, channel: creative.channel, post_format: creative.post_format }
    // The backend always lists at least one language and format; if not, Create draft fails with field errors.
    : { language: context.languages[0] ?? 'en', channel: firstFormat?.channel ?? 'facebook', post_format: firstFormat?.post_format ?? 'feed_image' });
  const format = context.post_formats.find((f) => f.channel === setup.channel && f.post_format === setup.post_format);

  const [createdId, setCreatedId] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const disabled = ed.state.kind === 'readonly';

  // Move to the draft's own address once it exists (after the render that cleared "unsaved").
  useEffect(() => {
    if (!createdId || !ed.base) return;
    navigate(`/marketing/create/${encodeURIComponent(createdId)}`, { state: { versioned: ed.base } });
  }, [createdId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ed.state.kind === 'conflict') setConflictOpen(true); }, [ed.state.kind]);

  // Focus the first field the server (or the local check) rejected.
  useEffect(() => {
    if (ed.errors.prompt) promptRef.current?.focus();
    else if (ed.errors.caption) captionRef.current?.focus();
  }, [ed.errors]);

  /** Obvious completeness and limits; the backend stays authoritative. */
  const localErrors = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!ed.text.prompt.trim()) e.prompt = 'Describe the post you want.';
    else if (charCount(ed.text.prompt) > PROMPT_MAX) e.prompt = `Shorten the brief to ${PROMPT_MAX} characters.`;
    if (charCount(ed.text.caption) > CAPTION_MAX) e.caption = `Shorten the caption to ${CAPTION_MAX} characters.`;
    return e;
  };

  const createDraft = async () => {
    if (!studyId) { toast('Choose a study first', 'waiting'); return; }
    const e = localErrors();
    if (Object.keys(e).length) { ed.setErrors(e); return; }
    const created = await ed.create(studyId, setup);
    if (created) {
      void qc.invalidateQueries({ queryKey: ['creatives'] });
      setCreatedId(created.creative.id);
    }
  };

  const copyMine = async () => {
    try {
      await navigator.clipboard.writeText(`${ed.text.prompt}\n\n${ed.text.caption}`);
      toast('Your text is copied', 'done');
    } catch {
      toast('Copy did not work in this browser', 'waiting', 'Select the text in the fields and copy it by hand.');
    }
  };

  const simulate = async (path: string, done: string) => {
    await http.post(path);
    toast(done, 'waiting');
  };

  const unsaved = !disabled && (ed.dirty || ed.state.kind === 'saving' || ed.state.kind === 'failed' || ed.state.kind === 'conflict');

  return (
    <TwoColumn>
      <Card>
        {(readOnly || ed.state.kind === 'failed' || (ed.state.kind === 'conflict' && !conflictOpen)) && (
          <VStack gap={3}>
            {readOnly && <Alert tone="waiting">{readOnlyReason}</Alert>}
            {ed.state.kind === 'failed' && (
              <Alert tone="blocked" title={ed.state.message}
                action={creative && ed.state.retryable ? <Button variant="secondary" size="sm" icon="refresh" onClick={() => void ed.save()}>Try again</Button> : undefined}>
                Your text is still here.{ed.state.requestId && <> Reference <Text type="code">{ed.state.requestId}</Text>.</>}
              </Alert>
            )}
            {ed.state.kind === 'conflict' && !conflictOpen && (
              <Alert tone="blocked" title="Someone saved a newer version"
                action={<Button variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>Resolve</Button>}>
                Autosave is paused until you choose which text to keep.
              </Alert>
            )}
          </VStack>
        )}

        <Step n={1} title="Study">
          <VStack gap={3}>
            {studyPicker}
            {study ? <StudyFacts study={study} /> : <Text type="body" color="secondary">Choose a study to see its approved facts.</Text>}
          </VStack>
        </Step>

        <Step n={2} title="Where it goes" hint={creative ? 'Fixed after the draft is created' : undefined}>
          {creative ? (
            <ChannelLabel text={`${formatLabel({ ...setup, aspect_ratio: format?.aspect_ratio })} · ${languageLabel(setup.language)}`} />
          ) : (
            <Grid columns={{ minWidth: 220 }} gap={4}>
              <Select label="Post format" value={formatKey(setup)} error={ed.errors.post_format}
                onChange={(e) => {
                  const f = context.post_formats.find((x) => formatKey(x) === e.target.value);
                  if (f) setSetup((s) => ({ ...s, channel: f.channel, post_format: f.post_format }));
                }}>
                {context.post_formats.map((f) => <option key={formatKey(f)} value={formatKey(f)}>{formatLabel(f)}</option>)}
              </Select>
              <Select label="Language" value={setup.language} error={ed.errors.language}
                onChange={(e) => { const l = context.languages.find((x) => x === e.target.value); if (l) setSetup((s) => ({ ...s, language: l })); }}>
                {context.languages.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
              </Select>
            </Grid>
          )}
        </Step>

        <Step n={3} title="Write the post">
          <VStack gap={4}>
            <Textarea ref={promptRef} label="Brief" required rows={5} value={ed.text.prompt} disabled={disabled}
              help="Describe the image and message you want. It is checked against the study facts and rules before anything is generated."
              limit={PROMPT_MAX} error={ed.errors.prompt}
              onChange={(e) => ed.setField('prompt', e.target.value)} />
            <Textarea ref={captionRef} label="Caption" rows={4} value={ed.text.caption} disabled={disabled}
              help="The text posted with the image. Optional until you validate."
              limit={CAPTION_MAX} error={ed.errors.caption}
              onChange={(e) => ed.setField('caption', e.target.value)} />
            {study && <RequiredWording texts={study.facts.required_disclosures} />}
            {creative && !disabled && <FindingsToFix creative={creative} editing={ed.dirty} />}
          </VStack>
        </Step>

        <Step n={4} title="Image">
          <Text type="body" color="secondary">The image is generated from the brief after the brief passes validation. Generation is added in the next step of this build.</Text>
        </Step>

        {!disabled && (
          <CardFoot>
            <Text type="supporting" color="secondary">
              {creative
                ? <>Version {creative.version} · saved {fmtDateTime(creative.updated_at)} · changes save automatically</>
                : 'Nothing is saved until you create the draft.'}
            </Text>
            <StackItem size="fill">{null}</StackItem>
            {creative
              ? <Button variant="secondary" size="sm" onClick={() => void ed.save()} disabled={!ed.dirty || ed.state.kind === 'saving' || ed.state.kind === 'conflict'}>Save now</Button>
              : <Button variant="primary" loading={ed.state.kind === 'saving'} onClick={() => void createDraft()}>Create draft</Button>}
          </CardFoot>
        )}
      </Card>

      <VStack gap={4}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={2}>Preview</Heading>
          <StackItem size="fill">{null}</StackItem>
          <SaveStatus state={ed.state} version={creative?.version} />
        </HStack>
        <PostPreview tenantName={context.tenant.name} caption={ed.text.caption} format={format}
          image={creative?.asset_id ? { assetId: creative.asset_id, alt: imageAltForBrief(creative.current_prompt) } : undefined} />
        {creative && (
          <Button variant="secondary" block href={`/marketing/create/${encodeURIComponent(creative.id)}/preview`}
            onClick={(e) => { if (ed.dirty) { e.preventDefault(); toast('Save your changes first', 'waiting', 'The final preview shows saved versions only.'); } }}>
            Open final preview
          </Button>
        )}
        {creative && (
          <ReadinessCard creative={creative} editing={ed.dirty || ed.state.kind === 'saving'}
            validate={can('validation:run') && !disabled && ed.state.kind === 'saved'
              ? { onClick: () => void validation.start(creative), busy: validation.starting }
              : undefined} />
        )}
        {creative && (
          <VersionHistory creative={creative} current={ed.text} readOnly={disabled || ed.state.kind === 'conflict'}
            onRestore={(v) => {
              ed.setField('prompt', v.current_prompt);
              ed.setField('caption', v.caption ?? '');
              toast(`Version ${v.version} text is in the editor`, 'done', 'It saves as a new version; nothing earlier is changed.');
              // After the dialog has closed and returned focus to its trigger.
              requestAnimationFrame(() => promptRef.current?.focus());
            }} />
        )}
        {SIMULATION_BUILD && mode === 'simulation' && creative && !disabled && (
          <Card>
            <CardHead title="Simulation tools" icon="warn" />
            <CardBody>
              <Button variant="ghost" size="sm" onClick={() => void simulate(`/__sim/creatives/${creative.id}/concurrent-edit`, 'A colleague saved a newer version')}>Someone else saves a newer version</Button>
              <Button variant="ghost" size="sm" onClick={() => void simulate('/__sim/fail-next-save', 'The next save will fail')}>Make the next save fail</Button>
            </CardBody>
          </Card>
        )}
      </VStack>

      {ed.state.kind === 'conflict' && (
        <ConflictDialog open={conflictOpen} server={ed.state.server} mine={ed.text}
          onClose={() => setConflictOpen(false)}
          onUseTheirs={ed.takeServerVersion}
          onSaveMine={ed.saveMineOnTop}
          onCopyMine={() => void copyMine()} />
      )}

      <UnsavedChangesPrompt when={unsaved}
        message={creative ? 'Your latest changes are not saved yet. If you leave now they are lost.' : 'This brief is not saved. Create the draft first, or your text is lost.'} />
    </TwoColumn>
  );
}
