import { z } from 'zod';
import { http, requestWithMeta } from './http';
import { isApiError } from './errors';
import * as S from './schemas.gen';
import { ChannelOption, LanguageOption, type Channel, type Language, type PostFormatKind } from './session';

/**
 * Creative briefs (drafts), per the backend's NRC-2 contract. Responses are
 * checked against the generated schemas (src/api/schemas.gen.ts) and the
 * types come from them. Language and channel also allow the proposed values
 * the simulation offers (see session.ts).
 */

/** Backend limits, in characters (Unicode code points). */
export const PROMPT_MAX = 4000;
export const CAPTION_MAX = 2200;

/** Chosen when the draft is created; fixed afterwards. */
export interface DraftSetup {
  language: Language;
  channel: Channel;
  post_format: PostFormatKind;
}

/** What the user edits on an existing draft. */
export interface BriefText {
  prompt: string;
  /** '' means no caption (sent as null). */
  caption: string;
}

/**
 * CreativeRead. `version` goes back as If-Match. `validation_runs` lists the
 * runs for this draft when the API fills it; a run with is_current=false is
 * out of date. Whether the image may be generated comes from
 * GET /creatives/{id}/generation-eligibility, never from a local badge.
 */
const CreativeSchema = S.CreativeRead.extend({ language: LanguageOption, channel: ChannelOption });
const CreativeVersionSchema = S.CreativeVersionRead.extend({ language: LanguageOption, channel: ChannelOption });
const VersionPageSchema = S.CreativeVersionPage.extend({ items: z.array(CreativeVersionSchema) });
export type CreativeVersion = z.infer<typeof CreativeVersionSchema>;
export type Creative = z.infer<typeof CreativeSchema>;
export type ValidationRunSummary = S.ValidationRunSummary;
export type ValidationKind = S.ValidationInputKind;
export type CreativeVersionPage = z.infer<typeof VersionPageSchema>;
export type GenerationEligibility = S.GenerationEligibility;

const ofKind = (c: Creative, kind?: ValidationKind) =>
  (c.validation_runs ?? []).filter((r) => !kind || r.input_kind === kind);

/** The validation run that applies to the current version, if any (optionally of one kind). */
export const currentValidation = (c: Creative, kind?: ValidationKind): ValidationRunSummary | undefined =>
  ofKind(c, kind).find((r) => r.is_current && r.creative_version === c.version);

/** The newest run for an earlier version, shown as "out of date". */
export const latestValidation = (c: Creative, kind?: ValidationKind): ValidationRunSummary | undefined =>
  [...ofKind(c, kind)].sort((x, y) => y.creative_version - x.creative_version)[0];

/**
 * Draft list entry. GET /creatives is not in the contract (config/inDevelopment.ts,
 * draftList), so this shape is a proposal and the app does not call it today.
 */
const CreativeSummarySchema = z.object({
  id: z.string(),
  study_id: z.string(),
  version: z.number().int(),
  prompt_preview: z.string(),
  updated_at: z.iso.datetime({ offset: true }),
});
export type CreativeSummary = z.infer<typeof CreativeSummarySchema>;

/** A creative and the ETag to send as If-Match on the next edit, e.g. "3" with quotes. */
export interface Versioned {
  creative: Creative;
  etag: string;
}

/** Field name → the fix, written for the user. */
export type FieldErrors = Partial<Record<'prompt' | 'caption' | 'study_id' | 'language' | 'channel' | 'post_format', string>>;

const versioned = (r: { data: Creative; etag: string | null }): Versioned => ({
  creative: r.data,
  etag: r.etag ?? `"${r.data.version}"`,
});

export const textOf = (c: Creative): BriefText => ({ prompt: c.current_prompt, caption: c.caption ?? '' });

/** A new key per intended save; the same key when retrying the same save. 8–128 of [A-Za-z0-9_-]. */
export const newIdempotencyKey = (): string => `create_${crypto.randomUUID().replace(/-/g, '')}`;

/** The Creatives endpoints. Every response is checked against its schema. */
export interface CreativesApi {
  list(signal?: AbortSignal): Promise<CreativeSummary[]>;
  get(id: string, signal?: AbortSignal): Promise<Versioned>;
  generationEligibility(id: string, signal?: AbortSignal): Promise<GenerationEligibility>;
  create(body: DraftSetup & { study_id: string } & BriefText, idempotencyKey: string): Promise<Versioned>;
  versions(id: string, opts?: { cursor?: number; limit?: number; signal?: AbortSignal }): Promise<CreativeVersionPage>;
  versionText(creative: Creative, version: number, signal?: AbortSignal): Promise<BriefText | null>;
  update(id: string, etag: string, text: BriefText): Promise<Versioned>;
}

export const creativesApi: CreativesApi = {
  list: (signal) => http.get('/creatives', z.array(CreativeSummarySchema), { signal }),

  get: async (id, signal) =>
    versioned(await requestWithMeta('GET', `/creatives/${encodeURIComponent(id)}`, CreativeSchema, { signal })),

  /** May the image be generated for the current version, and if not, why (the server applies the same check). */
  generationEligibility: (id, signal) =>
    http.get(`/creatives/${encodeURIComponent(id)}/generation-eligibility`, S.GenerationEligibility, { signal }),

  /** Only ever called from an explicit "Create draft" action. */
  create: async (body, idempotencyKey) =>
    versioned(await requestWithMeta('POST', '/creatives', CreativeSchema, {
      idempotencyKey,
      body: {
        study_id: body.study_id, language: body.language, channel: body.channel, post_format: body.post_format,
        prompt: body.prompt, ...(body.caption.trim() ? { caption: body.caption } : {}),
      },
    })),

  /** History, newest first. Pass `next_cursor` back as `cursor` for older versions. */
  versions: (id, opts = {}) =>
    http.get(`/creatives/${encodeURIComponent(id)}/versions`, VersionPageSchema, {
      query: { ...(opts.cursor != null ? { cursor: String(opts.cursor) } : {}), limit: String(opts.limit ?? 50) },
      signal: opts.signal,
    }),

  /** One version's text: the current one directly, older ones from the history. */
  async versionText(creative, version, signal) {
    if (creative.version === version) return textOf(creative);
    let cursor: number | undefined;
    for (let page = 0; page < 10; page++) {
      const p = await creativesApi.versions(creative.id, { cursor, signal });
      const hit = p.items.find((v) => v.version === version);
      if (hit) return { prompt: hit.current_prompt, caption: hit.caption ?? '' };
      if (p.next_cursor == null) return null;
      cursor = p.next_cursor;
    }
    return null;
  },

  /** Saves a new version; 412 VERSION_CONFLICT when `etag` is no longer current. */
  update: async (id, etag, text) =>
    versioned(await requestWithMeta('PATCH', `/creatives/${encodeURIComponent(id)}`, CreativeSchema, {
      etag,
      body: { current_prompt: text.prompt, caption: text.caption.trim() ? text.caption : null },
    })),
};

/**
 * 422 details.fields is a list of { loc, msg, type } (loc like ["body", "current_prompt"]).
 * Maps each to the screen's field names.
 */
export function fieldErrorsOf(e: unknown): FieldErrors {
  if (!isApiError(e)) return {};
  const raw = (e.details as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(raw)) return {};
  const out: FieldErrors = {};
  for (const f of raw as { loc?: unknown[]; msg?: string }[]) {
    const last = [...(f.loc ?? [])].reverse().find((x): x is string => typeof x === 'string');
    const key = last === 'current_prompt' ? 'prompt' : last;
    if (key && ['prompt', 'caption', 'study_id', 'language', 'channel', 'post_format'].includes(key)) {
      out[key as keyof FieldErrors] ??= f.msg ?? 'Check this field.';
    }
  }
  return out;
}
