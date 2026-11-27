import { z } from 'zod';
import { stagingLabel } from '@/lib/utils';
import { http, requestWithMeta } from './http';

/**
 * Media, rules, approvals, publications, social accounts and team members.
 *
 * PROPOSED CONTRACTS. None of these endpoints is in contracts/openapi.json yet
 * (NRC-8, NRC-12, NRC-13/14/15 and membership are not built). The shapes here
 * are the frontend's proposal for Dinesh, documented in docs/contracts/workspace.md.
 * In simulation the fake API serves them from the local dummy data; against
 * the real API they answer 405/501 and the pages say "not available yet".
 *
 * Responses are checked against these schemas like every other response, and
 * the types come from them. When the backend publishes these endpoints, they
 * move into openapi.json and the generated schemas replace these.
 *
 * `& Record<string, unknown>` on row types: Astryx Table takes rows of that type.
 */

const newKey = (prefix: string): string => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const isoDateTime = z.iso.datetime({ offset: true });
type Row<S extends z.ZodType> = z.infer<S> & Record<string, unknown>;

/* ---------- Drafts list (dashboard and pickers) ---------- */

export const ReviewState = z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'STALE']);
export type ReviewState = z.infer<typeof ReviewState>;

const DraftSummarySchema = z.object({
  id: z.string(),
  study_id: z.string(),
  study_title: z.string().transform(stagingLabel),
  version: z.number().int(),
  prompt_preview: z.string(),
  updated_at: isoDateTime,
  created_by: z.string(),
  validation: z.enum(['NOT_RUN', 'PASS', 'FAIL', 'NEEDS_REVIEW', 'STALE', 'RUNNING']),
  review: ReviewState,
  has_image: z.boolean(),
});
export type DraftSummary = Row<typeof DraftSummarySchema>;

/* ---------- Media library (NRC-18) ---------- */

export const MediaStatus = z.enum(['AVAILABLE', 'PENDING_CHECK', 'BLOCKED', 'EXPIRED']);
export type MediaStatus = z.infer<typeof MediaStatus>;

const MediaAssetSchema = z.object({
  asset_id: z.string(),
  name: z.string(),
  kind: z.enum(['image', 'video']),
  origin: z.enum(['generated', 'uploaded', 'stock']),
  mime_type: z.string(),
  width_px: z.number().int(),
  height_px: z.number().int(),
  size_bytes: z.number().int(),
  duration_s: z.number().nullable(),
  created_at: isoDateTime,
  created_by: z.string(),
  status: MediaStatus,
  /** Why it is blocked or pending, for the person who must act. */
  status_reason: z.string().nullable(),
  rights: z.object({
    source: z.string(),
    licence: z.string(),
    expires_at: isoDateTime.nullable(),
    people_shown: z.boolean(),
    consent_on_file: z.boolean(),
  }),
  tags: z.array(z.string()),
  used_in: z.number().int(),
  /** Short-lived link to show the file; never stored. */
  preview_url: z.string().nullable(),
});
export type MediaAsset = Row<typeof MediaAssetSchema>;

export interface MediaUpload {
  name: string;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  source: string;
  licence: string;
  expires_at: string | null;
  people_shown: boolean;
  consent_on_file: boolean;
  tags: string[];
}

/* ---------- Approvals (NRC-12 / NRC-23 full scope) ---------- */

const ApprovalRequestSchema = z.object({
  approval_id: z.string(),
  creative_id: z.string(),
  creative_version: z.number().int(),
  study_title: z.string().transform(stagingLabel),
  caption: z.string(),
  prompt: z.string(),
  channel_label: z.string(),
  submitted_by: z.string(),
  submitted_at: isoDateTime,
  due_at: isoDateTime.nullable(),
  state: ReviewState,
  validation: z.object({
    outcome: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']),
    is_current: z.boolean(),
    run_id: z.string(),
    open_findings: z.number().int(),
  }),
  decided_by: z.string().nullable(),
  decided_at: isoDateTime.nullable(),
  reason: z.string().nullable(),
  /** The submitter: governance forbids approving your own work. */
  is_own: z.boolean(),
});
export type ApprovalRequest = Row<typeof ApprovalRequestSchema>;

export type Decision = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

/* ---------- Social sets and accounts (NRC-13, NRC-31; eight channels NRC-39) ---------- */

export const AccountState = z.enum(['CONNECTED', 'PERMISSION_MISSING', 'PENDING_APP_REVIEW', 'EXPIRED', 'REVOKED', 'TEST_ONLY']);
export type AccountState = z.infer<typeof AccountState>;
/** The eight networks NRC-39 covers. What each account can do comes from the backend, never from this list. */
export const SocialChannel = z.enum(['facebook', 'instagram', 'threads', 'tiktok', 'linkedin', 'youtube', 'pinterest', 'snapchat']);
export type SocialChannel = z.infer<typeof SocialChannel>;
/** Details a network needs before it accepts a post (proposed). */
export const RequiredField = z.enum(['title', 'privacy', 'ai_disclosure']);
export type RequiredField = z.infer<typeof RequiredField>;

/** A brand or region group of accounts, with who may use it and how many accounts it may hold (proposed, NRC-31). */
const SocialSetSchema = z.object({
  social_set_id: z.string(),
  name: z.string(),
  region: z.string(),
  account_limit: z.number().int(),
  account_count: z.number().int(),
  access_groups: z.array(z.string()),
});
export type SocialSet = Row<typeof SocialSetSchema>;

const SocialAccountSchema = z.object({
  account_id: z.string(),
  social_set_id: z.string(),
  channel: SocialChannel,
  name: z.string(),
  handle: z.string(),
  state: AccountState,
  state_reason: z.string().nullable(),
  permissions: z.array(z.string()),
  connected_by: z.string(),
  connected_at: isoDateTime,
  expires_at: isoDateTime.nullable(),
  /** Formats this account can post now, e.g. "Feed image", "Reel", "Short", "Pin". */
  formats: z.array(z.string()),
  /** Longest caption the network accepts, in characters; null when it has no caption. */
  caption_max: z.number().int().nullable(),
  /** API: the backend posts it. MANUAL: no publishing API, so the post is handed off to post by hand. */
  publish_mode: z.enum(['API', 'MANUAL']),
  /** Details this network needs with each post. */
  required_fields: z.array(RequiredField),
});
export type SocialAccount = Row<typeof SocialAccountSchema>;

/* ---------- Publications (NRC-14 / NRC-15) ---------- */

/** MANUAL: handed off to post by hand; never shown as published. */
export const PublicationState = z.enum(['SCHEDULED', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'BLOCKED', 'CANCELLED', 'UNKNOWN', 'MANUAL']);
export type PublicationState = z.infer<typeof PublicationState>;

const PublicationSchema = z.object({
  publication_id: z.string(),
  creative_id: z.string(),
  creative_version: z.number().int(),
  study_title: z.string().transform(stagingLabel),
  caption: z.string(),
  /** Wall time in `timezone` ("2026-11-12T09:00"), no offset: the backend resolves it, so daylight-saving changes stay right. */
  publish_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).nullable(),
  timezone: z.string(),
  state: PublicationState,
  state_reason: z.string().nullable(),
  created_by: z.string(),
  created_at: isoDateTime,
  channels: z.array(z.object({
    account_id: z.string(),
    channel: SocialChannel,
    account_name: z.string(),
    /** The format this account receives. */
    format: z.string(),
    state: PublicationState,
    permalink: z.string().nullable(),
    error: z.string().nullable(),
  })),
});
export type Publication = Row<typeof PublicationSchema>;

/** What one account receives, with the details its network needs. */
export interface PublicationTarget {
  account_id: string;
  format: string;
  title?: string;
  privacy?: 'public' | 'followers' | 'private';
  ai_disclosure?: boolean;
}

export interface PublicationRequest {
  creative_id: string;
  creative_version: number;
  targets: PublicationTarget[];
  /** null = publish now. Local wall time; the backend resolves it in `timezone`. */
  publish_at: string | null;
  timezone: string;
}

/* ---------- Team (membership:manage) ---------- */

const MemberSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(['creator', 'reviewer', 'policy_admin', 'publisher', 'admin'])),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
  mfa: z.boolean(),
  last_active_at: isoDateTime.nullable(),
});
export type Member = Row<typeof MemberSchema>;

/* ---------- Activity (dashboards) ---------- */

const ActivityItemSchema = z.object({
  id: z.string(),
  at: isoDateTime,
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  href: z.string().nullable(),
});
export type ActivityItem = Row<typeof ActivityItemSchema>;

/* ---------- Calls ---------- */

/** A 204 No Content answer. */
const NoContent = z.undefined();

/** The proposed workspace endpoints. Every response is checked against its schema. */
export interface WorkspaceApi {
  drafts(signal?: AbortSignal): Promise<DraftSummary[]>;
  activity(signal?: AbortSignal): Promise<ActivityItem[]>;
  // The media list is GET /media in api/assets.ts (in the OpenAPI); upload and remove are still proposals.
  uploadMedia(body: MediaUpload): Promise<MediaAsset>;
  archiveMedia(id: string): Promise<void>;
  approvals(signal?: AbortSignal): Promise<ApprovalRequest[]>;
  approval(id: string, signal?: AbortSignal): Promise<ApprovalRequest>;
  decide(id: string, version: number, decision: Decision, reason: string): Promise<ApprovalRequest>;
  accounts(signal?: AbortSignal): Promise<SocialAccount[]>;
  socialSets(signal?: AbortSignal): Promise<SocialSet[]>;
  connectAccount(channel: SocialAccount['channel'], name: string, socialSetId: string): Promise<SocialAccount>;
  reconnectAccount(id: string): Promise<SocialAccount>;
  disconnectAccount(id: string): Promise<void>;
  publications(signal?: AbortSignal): Promise<Publication[]>;
  schedule(body: PublicationRequest): Promise<Publication>;
  cancelPublication(id: string): Promise<Publication>;
  reschedule(id: string, publishAt: string, timezone: string): Promise<Publication>;
  members(signal?: AbortSignal): Promise<Member[]>;
  invite(body: { name: string; email: string; roles: Member['roles'] }): Promise<Member>;
  updateRoles(id: string, roles: Member['roles']): Promise<Member>;
}

const id = encodeURIComponent;

export const workspaceApi: WorkspaceApi = {
  drafts: (signal) => http.get('/creatives', z.array(DraftSummarySchema), { signal }),
  activity: (signal) => http.get('/activity', z.array(ActivityItemSchema), { signal }),

  uploadMedia: async (body) => (await requestWithMeta('POST', '/media', MediaAssetSchema, { body, idempotencyKey: newKey('media') })).data,
  archiveMedia: async (assetId) => { await http.del(`/media/${id(assetId)}`, NoContent); },


  approvals: (signal) => http.get('/approvals', z.array(ApprovalRequestSchema), { signal }),
  approval: (approvalId, signal) => http.get(`/approvals/${id(approvalId)}`, ApprovalRequestSchema, { signal }),
  decide: async (approvalId, version, decision, reason) =>
    (await requestWithMeta('POST', `/approvals/${id(approvalId)}/decision`, ApprovalRequestSchema, {
      body: { decision, reason, creative_version: version }, idempotencyKey: newKey('decision'),
    })).data,

  accounts: (signal) => http.get('/accounts', z.array(SocialAccountSchema), { signal }),
  socialSets: (signal) => http.get('/social-sets', z.array(SocialSetSchema), { signal }),
  connectAccount: async (channel, name, socialSetId) =>
    (await requestWithMeta('POST', '/accounts', SocialAccountSchema, { body: { channel, name, social_set_id: socialSetId }, idempotencyKey: newKey('account') })).data,
  reconnectAccount: (accountId) => http.post(`/accounts/${id(accountId)}/reconnect`, SocialAccountSchema),
  disconnectAccount: async (accountId) => { await http.del(`/accounts/${id(accountId)}`, NoContent); },

  publications: (signal) => http.get('/publications', z.array(PublicationSchema), { signal }),
  schedule: async (body) => (await requestWithMeta('POST', '/publications', PublicationSchema, { body, idempotencyKey: newKey('publish') })).data,
  cancelPublication: (publicationId) => http.post(`/publications/${id(publicationId)}/cancel`, PublicationSchema),
  reschedule: (publicationId, publishAt, timezone) =>
    http.post(`/publications/${id(publicationId)}/reschedule`, PublicationSchema, { publish_at: publishAt, timezone }),

  members: (signal) => http.get('/members', z.array(MemberSchema), { signal }),
  invite: async (body) => (await requestWithMeta('POST', '/members', MemberSchema, { body, idempotencyKey: newKey('invite') })).data,
  updateRoles: (userId, roles) => http.patch(`/members/${id(userId)}`, MemberSchema, { roles }),
};
