import { z } from 'zod';
import { http } from './http';
import { isApiError } from './errors';

/**
 * Image models the organisation may generate with (NRC-21; Firoz's API:
 * GET /generation-models, POST /creative-jobs `model`; Dinesh's `image_text`).
 *
 * PROPOSED until Firoz's PR is merged: the fields follow his message of 17 Nov
 * (model, is_default, text_in_image, aspect_ratios, max_brief_chars). The
 * label and price are a frontend proposal so the cost can be shown before
 * generating. Gated by config/inDevelopment.ts (modelChoice).
 */

const Money = z.string().regex(/^\d+(\.\d{1,6})?$/);

const GenerationModelSchema = z.object({
  model: z.string(),
  label: z.string(),
  is_default: z.boolean(),
  /** Renders text written in the image; the only kind offered when the image shows text. */
  text_in_image: z.boolean(),
  aspect_ratios: z.array(z.string()),
  /** Longest brief this model takes. For a text-in-image model the brief and the image text share it. */
  max_brief_chars: z.number().int(),
  /** Price of one image in USD, when known. */
  price_usd: Money.nullable(),
});
export type GenerationModel = z.infer<typeof GenerationModelSchema>;

/** Hard cap on the text written in the image, in characters (proposed to Dinesh). */
export const IMAGE_TEXT_MAX = 300;

export const generationModelsApi = {
  list: async (signal?: AbortSignal): Promise<GenerationModel[]> =>
    (await http.get('/generation-models', z.object({ items: z.array(GenerationModelSchema) }), { signal })).items,
};

/** Which field a refused generation request is about (422 GENERATION_REQUEST_INVALID). */
export interface RequestProblem {
  field: 'model' | 'image_text' | 'brief';
  message: string;
}

/** The field-level reason behind a 422 GENERATION_REQUEST_INVALID, or null for any other error. */
export function requestProblemOf(e: unknown): RequestProblem | null {
  if (!isApiError(e) || e.code !== 'GENERATION_REQUEST_INVALID') return null;
  const d = (e.details ?? {}) as { reason?: string; max_brief_chars?: number };
  switch (d.reason) {
    case 'MODEL_NOT_ENABLED':
      return { field: 'model', message: 'This model is not enabled for your organisation. Choose another.' };
    case 'IMAGE_TEXT_REQUIRED':
      return { field: 'image_text', message: 'Write the text the image should show.' };
    case 'BRIEF_TOO_LONG':
      return { field: 'brief', message: `The brief is too long for this model${d.max_brief_chars ? ` (${d.max_brief_chars} characters at most)` : ''}. Shorten it, validate it again, then generate.` };
    default:
      return { field: 'model', message: e.message };
  }
}
