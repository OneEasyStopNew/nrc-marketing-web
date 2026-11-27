import type { Capability, Language, PostFormat, StudySnapshot, TenantMembership } from '@/api/session';
import type { CreativeVersion } from '@/api/creatives';
import type { Schemas } from '@/api/schemas.gen';
import type { Creative } from '@/api/creatives';
import type { ClientCheck, ClientMedia, ClientPost } from '@/api/clientPosts';
import type { Attempt, Balance, PriceList } from '@/api/usage';
import type { GenerationModel } from '@/api/generationModels';
import type { ActivityItem, ApprovalRequest, MediaAsset, Member, Publication, SocialAccount, SocialChannel, SocialSet } from '@/api/workspace';

/**
 * Shape of the local dummy data file `src/mocks/data.ts`.
 *
 * data.ts itself is git-ignored: each developer keeps their own dummy data
 * for local testing, and it never reaches the shared repository. Only these
 * types are committed, so the fake API (mocks/api.ts) and data.ts agree.
 */

export interface Grant {
  roles: Schemas['Role'][];
  capabilities: Capability[];
}

export interface DummyUser {
  /** Picked on the simulation sign-in screen. */
  id: string;
  label: string;
  sub: string;
  user_id: string;
  /** Goes in the simulated ID token (the API never returns it). */
  display_name: string;
  email: string;
  /** Roles and capabilities per tenant id. No entry = not a member. */
  grants: Record<string, Grant>;
  /** The identity provider refuses this account at sign-in (it never reaches the API). */
  signInError?: 'disabled' | 'mfa_required';
}

/** A stored draft plus the tenant that owns it (the API never returns tenant_id in the body). */
export interface MockCreative extends Creative {
  tenant_id: string;
  /** Earlier versions, oldest first (served by GET /creatives/{id}/versions). */
  history?: CreativeVersion[];
}

/**
 * A pretend validation rule for simulation. The fake validator applies these
 * to the brief; they are placeholders, never the real IPB or study rules.
 * - `phrases`: each phrase found is a FAIL finding with its text span.
 * - `min_words`: fewer words than `min_words` → UNABLE_TO_ASSESS.
 */
export interface MockRule {
  rule_id: string;
  rule_version: number;
  gate: Schemas['Gate'];
  mandatory: boolean;
  severity: Schemas['Severity'];
  check: { kind: 'phrases'; phrases: string[] } | { kind: 'min_words'; min_words: number };
  explanation: string;
  /** Why the rule could not be assessed (min_words only). */
  unassessed_reason?: string;
  suggested_correction?: string;
  needs_human_decision?: boolean;
  source: Schemas['SourceReference'];
}

/** A stored image. The fake API serves a labelled placeholder picture as its download link. */
export interface MockAsset extends Omit<Schemas['AssetRead'], 'download_url' | 'download_url_expires_at'> {
  tenant_id: string;
}

/** A stored run plus what the API keeps internally. */
export interface MockValidationRun {
  tenant_id: string;
  creative_id: string;
  /** Epoch ms the run started; the fake API moves it from QUEUED to RUNNING to done over a few seconds. */
  started_ms: number;
  /** The run as it reads once finished. */
  final: Schemas['ValidationRunRead'];
}

/** A pretend generation job. The fake API walks it from queued to done over a few seconds. */
export interface MockJob {
  job_id: string;
  tenant_id: string;
  creative_id: string;
  creative_version: number;
  /** Epoch ms the job started. */
  started_ms: number;
  /** The placeholder picture it ends with. */
  asset: MockAsset;
}

/** A client's own post (NRC-41, proposed contract in api/clientPosts.ts) plus what the API keeps internally. */
export interface MockClientPost extends Omit<ClientPost, 'media' | 'generation_requests'> {
  tenant_id: string;
  /** Paid AI fix requests made for this post; missing in posts saved before AI fixes existed. */
  generation_requests?: number;
  /** Asset ids in posting order; the files themselves are in the uploads store. */
  asset_ids: string[];
  /** Who saved the current version (the creator for version 1). */
  updated_by?: string;
  /** Earlier versions, oldest first. */
  history: { version: number; caption: string | null; asset_ids: string[]; change_note: string | null; created_by?: string; created_at?: string }[];
}

/** An uploaded client file, or the new picture from an AI fix. */
export interface MockClientMedia extends Omit<ClientMedia, 'preview_url'> {
  tenant_id: string;
  origin?: 'ai_fix';
}

/** A combined check of one client post version. */
export interface MockClientCheck {
  tenant_id: string;
  post_id: string;
  started_ms: number;
  /** The check as it reads once finished. */
  final: ClientCheck;
}

/** A paid AI fix of one client image. */
export interface MockAiFix {
  tenant_id: string;
  fix_id: string;
  post_id: string;
  post_version: number;
  asset_id: string;
  instructions: string | null;
  started_ms: number;
  created_by: string;
  /** The new picture, filed in the uploads store when the fix finishes. */
  result: MockClientMedia;
}

/** What data.ts must export. Later tickets add their collections here. */
export interface MockData {
  TENANTS: Record<string, TenantMembership>;
  USERS: DummyUser[];
  /** Study snapshots per tenant id. Missing or [] = no studies configured. */
  STUDIES: Record<string, StudySnapshot[]>;
  /** Language codes accepted for new drafts. */
  LANGUAGES: Language[];
  POST_FORMATS: PostFormat[];
  /** Drafts that exist when the page loads (e.g. one already validated, one for a closed study). */
  CREATIVES: MockCreative[];
  /** Placeholder rules the fake validator applies (NRC-19). */
  VALIDATION_RULES: MockRule[];
  /** Runs that exist when the page loads (e.g. the seeded draft's PASS). */
  VALIDATION_RUNS: MockValidationRun[];
  /** Images that exist when the page loads (NRC-23 final preview). */
  ASSETS: MockAsset[];
  /**
   * Workspace collections per tenant id (NRC-18/20/12/13/14 and team), in the
   * proposed shapes from src/api/workspace.ts. Missing tenant = empty.
   */
  WORKSPACE: Record<string, MockWorkspace>;
  /** Policy bundle version the fake validator reports. */
  POLICY_BUNDLE_VERSION: number;
  /**
   * Tenant ids with no active policy (NRC-20 "Policy setup required"). For these,
   * GET /context reports active_policy: null and GET /policies/active answers
   * 404 NOT_FOUND. Optional so data.ts files without it still compile.
   */
  NO_ACTIVE_POLICY_TENANTS?: readonly string[];
  /**
   * Generation usage per tenant id (NRC-44, proposed contract in api/usage.ts).
   * Missing tenant = balance unavailable and no attempts. Optional so data.ts
   * files without it still compile.
   */
  USAGE?: Record<string, MockUsage>;
  /** The provider price list (NRC-44). */
  PRICES?: PriceList;
  /**
   * What a newly connected account of each network can do in simulation
   * (NRC-39). The real capabilities come from the backend per account.
   */
  /** Image models offered for generation (NRC-21). Missing = no model choice: the default is used. */
  GENERATION_MODELS?: GenerationModel[];
  /** Figures each network reported per account (NRC-46); a missing account reports none. */
  SOCIAL_METRICS?: Record<string, { impressions: number | null; engagements: number | null; video_views: number | null }>;
  CHANNEL_CAPABILITIES?: Record<SocialChannel, Pick<SocialAccount, 'formats' | 'caption_max' | 'publish_mode' | 'required_fields' | 'permissions'>>;
}

/** One organisation's generation usage. Amounts are visibly fake simulation values. */
export interface MockUsage {
  balance: Balance;
  attempts: OmitKnown<Attempt, never>[];
}

/**
 * Omit for row types that also extend Record<string, unknown> (Astryx Table
 * rows): plain Omit would keep only the index signature and lose every field.
 */
type OmitKnown<T, K extends PropertyKey> = { [P in keyof T as string extends P ? never : P extends K ? never : P]: T[P] };

/** One organisation's dummy workspace. Every name is visibly fake. */
export interface MockWorkspace {
  media: OmitKnown<MediaAsset, 'preview_url'>[];
  /** No longer read (the old /rules screen is gone). Optional so older data.ts files still compile. */
  rules?: unknown[];
  approvals: OmitKnown<ApprovalRequest, 'is_own'>[];
  /** Brand or region groups of accounts (NRC-31/NRC-39). */
  social_sets: SocialSet[];
  accounts: SocialAccount[];
  publications: Publication[];
  members: Member[];
  activity: ActivityItem[];
  /**
   * Rulebook versions for policy administration (NRC-20 on the NRC-4 contract,
   * api/policyAdmin.ts). Optional so data.ts files without it still compile.
   */
  policy_bundles?: MockPolicyBundle[];
  /** Policy source files and the clauses read from them (NRC-20 on NRC-4). Optional. */
  policy_sources?: MockPolicySource[];
  /** Policy file uploads in progress or done. Filled by the fake API; not seeded. */
  policy_uploads?: Schemas['PolicyUploadRead'][];
}

export interface MockPolicySource {
  source: Schemas['PolicySourceRead'];
  clauses: Schemas['PolicyClauseRead'][];
}

/** One rulebook version with everything its detail screens read. */
export interface MockPolicyBundle {
  detail: Schemas['PolicyBundleDetail'];
  rules: Schemas['PolicyRuleRead'][];
  /** Nodes that are not a rule's own node (exceptions, disclosures, clauses…). */
  nodes: Schemas['PolicyNodeRead'][];
  edges: Schemas['PolicyEdgeRead'][];
  /** What GET /checks answers: problems that block approval or activation. */
  issues: Schemas['PolicyIssueRead'][];
  /** Newest first. */
  audit: Schemas['PolicyAuditRead'][];
}
