import { http, requestWithMeta } from './http';
import { isApiError } from './errors';
import type { components } from './schema';
import type { Channel, Language, PostFormatKind } from './session';

/**
 * Creative briefs (drafts), per the backend's NRC-2 contract. Types come from
 * src/api/schema.d.ts, generated from the backend's contracts/openapi.json.
 */

/** Backend limits, in characters (Unicode code points). */
export const PROMPT_MAX = 4000;
export const CAPTION_MAX = 2200;

type Schemas = components['schemas'];

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
 * runs for this draft (NRC-7, not built yet); a run with is_current=false is
 * out of date. Generation eligibility is not in the contract yet.
 */
export type Creative = Schemas['CreativeRead'];
export type ValidationRunSummary = Schemas['ValidationRunSummary'];
export type CreativeVersionPage = Schemas['CreativeVersionPage'];

/** The validation run that applies to the current version, if any. */
export const currentValidation = (c: Creative): ValidationRunSummary | undefined =>
  (c.validation_runs ?? []).find((r) => r.is_current && r.creative_version === c.version);

/** The newest run for an earlier version, shown as "out of date". */
export const latestValidation = (c: Creative): ValidationRunSummary | undefined =>
  [...(c.validation_runs ?? [])].sort((x, y) => y.creative_version - x.creative_version)[0];

/** Draft list entry. GET /creatives is not in the contract yet; shape to confirm. */
export interface CreativeSummary {
  id: string;
  study_id: string;
  version: number;
  prompt_preview: string;
  updated_at: string;
}

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
export const newIdempotencyKey = () => `create_${crypto.randomUUID().replace(/-/g, '')}`;

export const creativesApi = {
  list: (signal?: AbortSignal) => http.get<CreativeSummary[]>('/creatives', undefined, { signal }),

  get: async (id: string, signal?: AbortSignal) =>
    versioned(await requestWithMeta<Creative>('GET', `/creatives/${encodeURIComponent(id)}`, { signal })),

  /** Only ever called from an explicit "Create draft" action. */
  create: async (body: DraftSetup & { study_id: string } & BriefText, idempotencyKey: string) =>
    versioned(await requestWithMeta<Creative>('POST', '/creatives', {
      idempotencyKey,
      body: {
        study_id: body.study_id, language: body.language, channel: body.channel, post_format: body.post_format,
        prompt: body.prompt, ...(body.caption.trim() ? { caption: body.caption } : {}),
      },
    })),

  /** History, newest first. Pass `next_cursor` back as `cursor` for older versions. */
  versions: (id: string, opts: { cursor?: number; limit?: number; signal?: AbortSignal } = {}) =>
    http.get<CreativeVersionPage>(`/creatives/${encodeURIComponent(id)}/versions`,
      { ...(opts.cursor != null ? { cursor: String(opts.cursor) } : {}), limit: String(opts.limit ?? 50) }, { signal: opts.signal }),

  /** One version's text: the current one directly, older ones from the history. */
  async versionText(creative: Creative, version: number, signal?: AbortSignal): Promise<BriefText | null> {
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
  update: async (id: string, etag: string, text: BriefText) =>
    versioned(await requestWithMeta<Creative>('PATCH', `/creatives/${encodeURIComponent(id)}`, {
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
    const last = [...(f.loc ?? [])].reverse().find((x) => typeof x === 'string') as string | undefined;
    const key = last === 'current_prompt' ? 'prompt' : last;
    if (key && ['prompt', 'caption', 'study_id', 'language', 'channel', 'post_format'].includes(key)) {
      out[key as keyof FieldErrors] ??= f.msg ?? 'Check this field.';
    }
  }
  return out;
}
