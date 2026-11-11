import { http, requestWithMeta } from './http';

/**
 * Media, rules, approvals, publications, social accounts and team members.
 *
 * PROPOSED CONTRACTS. None of these endpoints is in contracts/openapi.json yet
 * (NRC-8, NRC-12, NRC-13/14/15 and membership are not built). The shapes here
 * are the frontend's proposal for Dinesh, documented in docs/contracts/workspace.md.
 * In simulation the fake API serves them from the local dummy data; against
 * the real API they answer 405/501 and the pages say "not available yet".
 */

const newKey = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

/* ---------- Drafts list (dashboard and pickers) ---------- */

export type ReviewState = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'STALE';

export interface DraftSummary extends Record<string, unknown> {
  id: string;
  study_id: string;
  study_title: string;
  version: number;
  prompt_preview: string;
  updated_at: string;
  created_by: string;
  validation: 'NOT_RUN' | 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'STALE' | 'RUNNING';
  review: ReviewState;
  has_image: boolean;
}

/* ---------- Media library (NRC-18) ---------- */

export type MediaStatus = 'AVAILABLE' | 'PENDING_CHECK' | 'BLOCKED' | 'EXPIRED';

export interface MediaAsset extends Record<string, unknown> {
  asset_id: string;
  name: string;
  kind: 'image' | 'video';
  origin: 'generated' | 'uploaded' | 'stock';
  mime_type: string;
  width_px: number;
  height_px: number;
  size_bytes: number;
  duration_s: number | null;
  created_at: string;
  created_by: string;
  status: MediaStatus;
  /** Why it is blocked or pending, for the person who must act. */
  status_reason: string | null;
  rights: {
    source: string;
    licence: string;
    expires_at: string | null;
    people_shown: boolean;
    consent_on_file: boolean;
  };
  tags: string[];
  used_in: number;
  /** Short-lived link to show the file; never stored. */
  preview_url: string | null;
}

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

/* ---------- Policy rules (NRC-20) ---------- */

export type RuleStatus = 'ACTIVE' | 'DRAFT' | 'RETIRED';
export type RuleGate = 'completeness' | 'study_facts' | 'policy' | 'media';

export interface PolicyRule extends Record<string, unknown> {
  rule_id: string;
  version: number;
  title: string;
  description: string;
  gate: RuleGate;
  severity: 'critical' | 'major' | 'minor';
  mandatory: boolean;
  status: RuleStatus;
  applies_to: ('brief' | 'caption' | 'image' | 'video')[];
  source: { document: string; clause: string; excerpt: string };
  suggested_correction: string | null;
  updated_by: string;
  updated_at: string;
  /** Validation runs in the last 30 days where this rule failed. */
  fail_count_30d: number;
  unable_count_30d: number;
}

export interface RuleDraft {
  title: string;
  description: string;
  gate: RuleGate;
  severity: PolicyRule['severity'];
  mandatory: boolean;
  applies_to: PolicyRule['applies_to'];
  source: PolicyRule['source'];
  suggested_correction: string | null;
}

/* ---------- Approvals (NRC-12 / NRC-23 full scope) ---------- */

export interface ApprovalRequest extends Record<string, unknown> {
  approval_id: string;
  creative_id: string;
  creative_version: number;
  study_title: string;
  caption: string;
  prompt: string;
  channel_label: string;
  submitted_by: string;
  submitted_at: string;
  due_at: string | null;
  state: ReviewState;
  validation: { outcome: 'PASS' | 'FAIL' | 'NEEDS_REVIEW'; is_current: boolean; run_id: string; open_findings: number };
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
  /** The submitter: governance forbids approving your own work. */
  is_own: boolean;
}

export type Decision = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

/* ---------- Social accounts (NRC-13) ---------- */

export type AccountState = 'CONNECTED' | 'PERMISSION_MISSING' | 'PENDING_APP_REVIEW' | 'EXPIRED' | 'REVOKED' | 'TEST_ONLY';

export interface SocialAccount extends Record<string, unknown> {
  account_id: string;
  channel: 'facebook' | 'instagram';
  name: string;
  handle: string;
  state: AccountState;
  state_reason: string | null;
  permissions: string[];
  connected_by: string;
  connected_at: string;
  expires_at: string | null;
  formats: string[];
}

/* ---------- Publications (NRC-14 / NRC-15) ---------- */

export type PublicationState = 'SCHEDULED' | 'QUEUED' | 'PROCESSING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'UNKNOWN';

export interface Publication extends Record<string, unknown> {
  publication_id: string;
  creative_id: string;
  creative_version: number;
  study_title: string;
  caption: string;
  publish_at: string | null;
  timezone: string;
  state: PublicationState;
  state_reason: string | null;
  created_by: string;
  created_at: string;
  channels: { account_id: string; channel: 'facebook' | 'instagram'; account_name: string; state: PublicationState; permalink: string | null; error: string | null }[];
}

export interface PublicationRequest {
  creative_id: string;
  creative_version: number;
  account_ids: string[];
  /** null = publish now. Local wall time; the backend resolves it in `timezone`. */
  publish_at: string | null;
  timezone: string;
}

/* ---------- Team (membership:manage) ---------- */

export interface Member extends Record<string, unknown> {
  user_id: string;
  name: string;
  email: string;
  roles: ('creator' | 'reviewer' | 'policy_admin' | 'publisher' | 'admin')[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  mfa: boolean;
  last_active_at: string | null;
}

/* ---------- Activity (dashboards) ---------- */

export interface ActivityItem extends Record<string, unknown> {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  href: string | null;
}

/* ---------- Calls ---------- */

export const workspaceApi = {
  drafts: (signal?: AbortSignal) => http.get<DraftSummary[]>('/creatives', undefined, { signal }),
  activity: (signal?: AbortSignal) => http.get<ActivityItem[]>('/activity', undefined, { signal }),

  media: (signal?: AbortSignal) => http.get<MediaAsset[]>('/media', undefined, { signal }),
  uploadMedia: async (body: MediaUpload) => (await requestWithMeta<MediaAsset>('POST', '/media', { body, idempotencyKey: newKey('media') })).data,
  archiveMedia: (id: string) => http.del<void>(`/media/${encodeURIComponent(id)}`),

  rules: (signal?: AbortSignal) => http.get<PolicyRule[]>('/rules', undefined, { signal }),
  createRule: async (body: RuleDraft) => (await requestWithMeta<PolicyRule>('POST', '/rules', { body, idempotencyKey: newKey('rule') })).data,
  updateRule: async (id: string, version: number, body: Partial<RuleDraft> & { status?: RuleStatus }) =>
    (await requestWithMeta<PolicyRule>('PATCH', `/rules/${encodeURIComponent(id)}`, { body, etag: `"${version}"` })).data,

  approvals: (signal?: AbortSignal) => http.get<ApprovalRequest[]>('/approvals', undefined, { signal }),
  approval: (id: string, signal?: AbortSignal) => http.get<ApprovalRequest>(`/approvals/${encodeURIComponent(id)}`, undefined, { signal }),
  decide: async (id: string, version: number, decision: Decision, reason: string) =>
    (await requestWithMeta<ApprovalRequest>('POST', `/approvals/${encodeURIComponent(id)}/decision`, {
      body: { decision, reason, creative_version: version }, idempotencyKey: newKey('decision'),
    })).data,

  accounts: (signal?: AbortSignal) => http.get<SocialAccount[]>('/accounts', undefined, { signal }),
  connectAccount: async (channel: SocialAccount['channel'], name: string) =>
    (await requestWithMeta<SocialAccount>('POST', '/accounts', { body: { channel, name }, idempotencyKey: newKey('account') })).data,
  reconnectAccount: (id: string) => http.post<SocialAccount>(`/accounts/${encodeURIComponent(id)}/reconnect`),
  disconnectAccount: (id: string) => http.del<void>(`/accounts/${encodeURIComponent(id)}`),

  publications: (signal?: AbortSignal) => http.get<Publication[]>('/publications', undefined, { signal }),
  schedule: async (body: PublicationRequest) => (await requestWithMeta<Publication>('POST', '/publications', { body, idempotencyKey: newKey('publish') })).data,
  cancelPublication: (id: string) => http.post<Publication>(`/publications/${encodeURIComponent(id)}/cancel`),

  members: (signal?: AbortSignal) => http.get<Member[]>('/members', undefined, { signal }),
  invite: async (body: { name: string; email: string; roles: Member['roles'] }) =>
    (await requestWithMeta<Member>('POST', '/members', { body, idempotencyKey: newKey('invite') })).data,
  updateRoles: (id: string, roles: Member['roles']) => http.patch<Member>(`/members/${encodeURIComponent(id)}`, { roles }),
};
