import type { ReactElement } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { useSession } from '@/auth/AuthProvider';
import { IMAGE_TEXT_MAX, generationModelsApi, type GenerationModel, type RequestProblem } from '@/api/generationModels';
import type { ImageChoice } from '@/api/jobs';
import { fmtUsd } from '@/api/usage';
import { Textarea } from '@/components/ui/Form';
import { Alert, SkeletonRows } from '@/components/ui/Misc';
import { charCount } from '@/lib/utils';

/** What the creator has chosen so far. `text` is null until they answer the text question. */
export interface ModelChoiceValue {
  text: boolean | null;
  model: string;
  imageText: string;
}

export const EMPTY_CHOICE: ModelChoiceValue = { text: null, model: '', imageText: '' };

/** The job request for a complete choice, or null while something is missing. */
export function choiceToRequest(v: ModelChoiceValue, models: GenerationModel[] | undefined): ImageChoice | null {
  if (v.text == null || !models) return null;
  const model = v.text ? models.find((m) => m.text_in_image) : models.find((m) => m.model === v.model && !m.text_in_image);
  if (!model) return null;
  if (!v.text) return { model: model.model };
  const t = v.imageText.trim();
  if (!t || charCount(v.imageText) > IMAGE_TEXT_MAX) return null;
  return { model: model.model, image_text: v.imageText };
}

export function useGenerationModels(enabled: boolean): UseQueryResult<GenerationModel[]> {
  const { context } = useSession();
  return useQuery({ queryKey: ['generation-models', context.tenant.tenant_id], queryFn: ({ signal }) => generationModelsApi.list(signal), enabled, staleTime: 5 * 60_000 });
}

const price = (m: GenerationModel | undefined) => (m?.price_usd ? `${fmtUsd(m.price_usd)} an image` : 'price not reported');

/**
 * NRC-21: whether the image shows text comes first, and decides the models.
 * No text: the default model or another one, and no image text is sent at all.
 * Text: the exact lines, required and capped, and the text-in-image model only.
 */
export function ModelChoice({ value, onChange, brief, problem, disabled }: {
  value: ModelChoiceValue;
  onChange: (v: ModelChoiceValue) => void;
  /** The saved brief, to count what the chosen model leaves. */
  brief: string;
  problem: RequestProblem | null;
  disabled: boolean;
}): ReactElement {
  const q = useGenerationModels(true);
  if (q.isPending) return <SkeletonRows rows={2} />;
  if (q.isError) return <Alert tone="waiting" title="The image models could not be loaded">Reload the page to try again. Nothing is generated without a model.</Alert>;

  const models = q.data;
  const plain = models.filter((m) => !m.text_in_image);
  const textModel = models.find((m) => m.text_in_image);
  const defaultModel = plain.find((m) => m.is_default) ?? plain[0];
  const chosen = value.text == null ? undefined : value.text ? textModel : plain.find((m) => m.model === value.model);
  const used = charCount(brief) + (value.text ? charCount(value.imageText) : 0);
  const left = chosen ? chosen.max_brief_chars - used : null;
  const set = (p: Partial<ModelChoiceValue>) => onChange({ ...value, ...p });

  return (
    <VStack gap={3}>
      <RadioList label="Will the image show text?" isRequired orientation="horizontal" isDisabled={disabled}
        description="Answer this first: it decides which models can make the image."
        value={value.text == null ? '' : value.text ? 'yes' : 'no'}
        onChange={(v) => set(v === 'yes' ? { text: true, model: textModel?.model ?? '' } : { text: false, model: defaultModel?.model ?? '' })}>
        <RadioListItem value="no" label="No" />
        <RadioListItem value="yes" label="Yes, words in the picture" isDisabled={!textModel} />
      </RadioList>

      {value.text === false && (
        <Selector label="Image model" isRequired width="100%" value={value.model || undefined} isDisabled={disabled}
          options={plain.map((m) => ({ value: m.model, label: `${m.label}${m.is_default ? ' (default)' : ''}`, description: price(m) }))}
          onChange={(v) => v && set({ model: v })}
          status={problem?.field === 'model' ? { type: 'error', message: problem.message } : undefined} statusVariant="detached" />
      )}

      {value.text === true && textModel && (
        <VStack gap={2}>
          <Textarea label="Text in the image" required rows={3} value={value.imageText} limit={IMAGE_TEXT_MAX} disabled={disabled}
            help="Exactly the words to show, one line per line. They are checked against the rules like the caption."
            error={problem?.field === 'image_text' ? problem.message : !value.imageText.trim() ? undefined : charCount(value.imageText) > IMAGE_TEXT_MAX ? `Shorten it to ${IMAGE_TEXT_MAX} characters.` : undefined}
            onChange={(e) => set({ imageText: e.target.value })} />
          <Text type="supporting" color="secondary">
            Model: {textModel.label}, the only one that writes text in images · {price(textModel)}
            {defaultModel?.price_usd ? `, compared with ${fmtUsd(defaultModel.price_usd)} for ${defaultModel.label}` : ''}.
          </Text>
          {problem?.field === 'model' && <Alert tone="blocked" title={problem.message} />}
        </VStack>
      )}

      {chosen && left != null && (
        left >= 0
          ? <Text type="supporting" color="secondary">{left} characters left for the brief{value.text ? ' and the image text together' : ''} with {chosen.label}.</Text>
          : <Alert tone="blocked" title={`${-left} characters too long for ${chosen.label}`}>Shorten the {value.text ? 'brief or the image text' : 'brief'}, validate it again, then generate.</Alert>
      )}
      {problem?.field === 'brief' && <Alert tone="blocked" title={problem.message} />}
    </VStack>
  );
}
