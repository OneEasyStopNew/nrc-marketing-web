import { z } from 'zod';
import { http, requestWithMeta } from './http';
import * as S from './schemas.gen';
import { ChannelOption, LanguageOption, type Channel, type Language, type PostFormatKind } from './session';

/**
 * Checking an existing client post without generating anything (NRC-41, backend NRC-40).
 *
 * PROPOSED CONTRACT. These endpoints are not in the backend's OpenAPI yet; the
 * shapes below are the frontend's proposal for Dinesh (NRC-40) and Firoz
 * (uploads NRC-3, validators NRC-7/8/9) to confirm or change. Until they exist
 * the feature is gated (config/inDevelopment.ts, validationOnly) and only the
 * simulation answers them.
 *
 * A client post is the client's own caption plus existing images or a video.
 * It is versioned like a draft (If-Match on edits), is marked
 * origin=CLIENT_UPLOAD and workflow_mode=VALIDATION_ONLY, and never starts a
 * Higgsfield job: a check reports how many generation requests it made, and
 * that number must be 0.
 */

/** Backend limits, in characters (Unicode code points). */
export const CLIENT_CAPTION_MAX = 2200;
/** A carousel holds up to this many images; a video post holds one video. */
export const MAX_IMAGES = 10;
export const MAX_UPLOAD_BYTES = 200_000_000;

const isoDateTime = z.iso.datetime({ offset: true });

/** One uploaded file, after the server inspected it. Only READY files can be checked. */
export const UploadState = z.enum(['SCANNING', 'READY', 'REJECTED']);
export type UploadState = z.infer<typeof UploadState>;

const ClientMediaSchema = z.object({
  asset_id: z.string(),
  kind: z.enum(['image', 'video']),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  width_px: z.number().int().nullable(),
  height_px: z.number().int().nullable(),
  duration_s: z.number().nullable(),
  state: UploadState,
  /** Why a file was rejected, written for the user. */
  state_reason: z.string().nullable(),
  /** Short-lived preview link; renewed by reading the post again. */
  preview_url: z.string().nullable(),
});
export type ClientMedia = z.infer<typeof ClientMediaSchema>;

const ClientPostSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  study_id: z.string(),
  language: LanguageOption,
  channel: ChannelOption,
  post_format: S.PostFormat,
  origin: z.literal('CLIENT_UPLOAD'),
  workflow_mode: z.literal('VALIDATION_ONLY'),
  caption: z.string().nullable(),
  /** In posting order (the carousel order). */
  media: z.array(ClientMediaSchema),
  created_by: z.string(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  /** What changed in this version, e.g. "Caption: accepted the suggested fix for R-104". */
  change_note: z.string().nullable(),
  /**
   * Paid AI generation requests made for this post so far, all from AI fixes
   * the user chose (proposed). Checking never adds to it.
   */
  generation_requests: z.number().int(),
});
export type ClientPost = z.infer<typeof ClientPostSchema>;

/** Where in a video a finding is, in seconds (NRC-9; proposed). */
const TimeRange = z.object({ start_s: z.number().min(0), end_s: z.number().min(0) });
const PartFindingSchema = S.Finding.extend({
  time_range: TimeRange.nullable().optional(),
  /**
   * The exact words to put in place of the flagged span, when the correction
   * service (NRC-11) can propose them (proposed). `suggested_correction` stays
   * advice for a person; only this field is applied as an edit.
   */
  replacement_text: z.string().nullable().optional(),
});
export type PartFinding = z.infer<typeof PartFindingSchema>;

/** The result for one part of the post: the caption, or one file. */
const CheckPartSchema = z.object({
  target: z.enum(['caption', 'image', 'video']),
  /** The file this part checked; null for the caption. */
  asset_id: z.string().nullable(),
  state: S.ExecutionState,
  outcome: S.Outcome.nullable(),
  gates: z.array(S.GateResult),
  rule_results: z.array(S.RuleResult),
  findings: z.array(PartFindingSchema),
  coverage_gaps: z.array(S.CoverageGap),
});
export type CheckPart = z.infer<typeof CheckPartSchema>;

/**
 * One combined check of a post version: caption, on-image text, audio and
 * scenes together. The overall outcome waits for every part; a part that
 * could not be assessed keeps the post from passing.
 */
const ClientCheckSchema = z.object({
  check_id: z.string(),
  post_id: z.string(),
  post_version: z.number().int(),
  state: S.ExecutionState,
  outcome: S.Outcome.nullable(),
  is_current: z.boolean(),
  evaluated_at: isoDateTime.nullable(),
  study_snapshot_version: z.number().int(),
  policy_bundle_version: z.number().int().nullable(),
  parts: z.array(CheckPartSchema),
  /** Paid generation requests this check made. Always 0 for validation only. */
  generation_requests: z.number().int(),
});
export type ClientCheck = z.infer<typeof ClientCheckSchema>;

const CheckAcceptedSchema = z.object({ check_id: z.string(), state: S.ExecutionState });

/** The latest check of one version, in short (proposed). */
const VersionCheckSchema = z.object({
  check_id: z.string(),
  state: S.ExecutionState,
  outcome: S.Outcome.nullable(),
  /** True when some part was not assessed, so a PASS is only a pass of what was assessed. */
  has_coverage_gaps: z.boolean(),
  evaluated_at: isoDateTime.nullable(),
});

/** One saved version of a post, as it was. Versions never change (proposed). */
const ClientPostVersionSchema = z.object({
  version: z.number().int(),
  caption: z.string().nullable(),
  media: z.array(ClientMediaSchema),
  change_note: z.string().nullable(),
  created_by: z.string(),
  created_by_name: z.string().nullable(),
  created_at: isoDateTime,
  /** The latest check of this exact version; null when it was never checked. */
  check: VersionCheckSchema.nullable(),
});
export type ClientPostVersion = z.infer<typeof ClientPostVersionSchema>;

const ClientPostVersionsSchema = z.object({ items: z.array(ClientPostVersionSchema) });

/** Longest instructions a user can give an AI fix, in characters. */
export const AI_FIX_INSTRUCTIONS_MAX = 500;

/**
 * One paid AI fix of a flagged image (proposed; generation is Firoz's, NRC-5).
 * Only started by an explicit, confirmed user action. It makes a new picture
 * and never changes the post: the user chooses whether to use it, which saves
 * a new version that must be checked again.
 */
const AiFixSchema = z.object({
  fix_id: z.string(),
  post_id: z.string(),
  /** The version whose check flagged the image. */
  post_version: z.number().int(),
  /** The image being fixed. */
  asset_id: z.string(),
  state: S.ExecutionState,
  /** The new picture, once the fix succeeded. */
  result: ClientMediaSchema.nullable(),
  /** Why it failed, written for the user. */
  error: z.string().nullable(),
  /** Paid requests this fix made: 1. */
  generation_requests: z.number().int(),
  created_at: isoDateTime,
});
export type AiFix = z.infer<typeof AiFixSchema>;

export interface ClientPostSetup {
  study_id: string;
  language: Language;
  channel: Channel;
  post_format: PostFormatKind;
}

/** A versioned post and the ETag to send as If-Match on the next edit. */
export interface VersionedPost {
  post: ClientPost;
  etag: string;
}

const versioned = (r: { data: ClientPost; etag: string | null }): VersionedPost => ({ post: r.data, etag: r.etag ?? `"${r.data.version}"` });

/** A new key per intended request; the same key when retrying the same request. */
export const newClientKey = (what: string): string => `${what}_${crypto.randomUUID().replace(/-/g, '')}`;

const id = encodeURIComponent;

/**
 * The files this tab uploaded, kept in memory only (never in storage or a URL),
 * so the user sees their own file at once instead of waiting for the server's
 * preview. Gone on reload; the screens then use the server's preview_url.
 */
const localPreviews = new Map<string, string>();

/** A preview of the file as this tab uploaded it, or null. */
export const localPreview = (assetId: string): string | null => localPreviews.get(assetId) ?? null;

export const clientPostsApi = {
  /**
   * Registers one file and returns it as the server sees it. In the real flow
   * (NRC-3) this is POST /assets/uploads, a direct upload to storage, then
   * completion; the proposal keeps one call so the screens can be built.
   */
  upload: async (file: File, idempotencyKey: string): Promise<ClientMedia> => {
    const media = (await requestWithMeta('POST', '/client-uploads', ClientMediaSchema, {
      body: { file_name: file.name, mime_type: file.type, size_bytes: file.size },
      idempotencyKey,
    })).data;
    if (media.state === 'READY' && !localPreviews.has(media.asset_id)) localPreviews.set(media.asset_id, URL.createObjectURL(file));
    return media;
  },

  /** Only from an explicit "Save and check" action. */
  create: async (body: ClientPostSetup & { caption: string; asset_ids: string[] }, idempotencyKey: string): Promise<VersionedPost> =>
    versioned(await requestWithMeta('POST', '/client-posts', ClientPostSchema, {
      body: { ...body, caption: body.caption.trim() ? body.caption : null },
      idempotencyKey,
    })),

  get: async (postId: string, signal?: AbortSignal): Promise<VersionedPost> =>
    versioned(await requestWithMeta('GET', `/client-posts/${id(postId)}`, ClientPostSchema, { signal })),

  /** Saves a new version (accepted fix or replaced file); 412 VERSION_CONFLICT when `etag` is no longer current. */
  update: async (postId: string, etag: string, body: { caption?: string | null; asset_ids?: string[]; change_note: string }): Promise<VersionedPost> =>
    versioned(await requestWithMeta('PATCH', `/client-posts/${id(postId)}`, ClientPostSchema, { body, etag })),

  /** Every saved version, newest first, each with its latest check. */
  versions: async (postId: string, signal?: AbortSignal): Promise<ClientPostVersion[]> =>
    (await http.get(`/client-posts/${id(postId)}/versions`, ClientPostVersionsSchema, { signal })).items,

  /** Starts a combined check of one saved version. Never generates anything. */
  startCheck: async (postId: string, version: number, idempotencyKey: string): Promise<z.infer<typeof CheckAcceptedSchema>> =>
    (await requestWithMeta('POST', `/client-posts/${id(postId)}/checks`, CheckAcceptedSchema, { body: { post_version: version }, idempotencyKey })).data,

  /**
   * Starts one paid AI fix of a flagged image. 409 AI_FIX_NOT_ELIGIBLE when the
   * version's check is not current or did not flag that image.
   */
  startAiFix: async (postId: string, body: { post_version: number; asset_id: string; instructions: string | null }, idempotencyKey: string): Promise<AiFix> =>
    (await requestWithMeta('POST', `/client-posts/${id(postId)}/ai-fixes`, AiFixSchema, { body, idempotencyKey })).data,

  getAiFix: (postId: string, fixId: string, signal?: AbortSignal): Promise<AiFix> =>
    http.get(`/client-posts/${id(postId)}/ai-fixes/${id(fixId)}`, AiFixSchema, { signal }),

  /** The latest check of a post, if any (404 when it was never checked). */
  latestCheck: (postId: string, signal?: AbortSignal): Promise<ClientCheck> =>
    http.get(`/client-posts/${id(postId)}/checks/latest`, ClientCheckSchema, { signal }),
};

/**
 * The caption with a finding's proposed replacement applied: the flagged
 * words (code-point span) replaced by `replacement_text`. Null when the
 * finding has no span or no replacement, so nothing is applied by guesswork.
 */
export function applySuggestion(caption: string, f: Pick<PartFinding, 'text_span' | 'replacement_text'>): string | null {
  if (!f.text_span || f.replacement_text == null) return null;
  const chars = [...caption];
  if (f.text_span.end > chars.length || f.text_span.start > f.text_span.end) return null;
  return [...chars.slice(0, f.text_span.start), f.replacement_text, ...chars.slice(f.text_span.end)].join('');
}

/** True when the check is for the post's current version and still current. */
export const checkIsCurrent = (post: ClientPost, check: ClientCheck | undefined): boolean =>
  !!check && check.is_current && check.post_version === post.version;
