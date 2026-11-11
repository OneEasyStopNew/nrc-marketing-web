import type { Capability, Language, PostFormat, StudySnapshot, TenantMembership } from '@/api/session';
import type { components } from '@/api/schema';
import type { Creative } from '@/api/creatives';
import type { ActivityItem, ApprovalRequest, MediaAsset, Member, PolicyRule, Publication, SocialAccount } from '@/api/workspace';

/**
 * Shape of the local dummy data file `src/mocks/data.ts`.
 *
 * data.ts itself is git-ignored: each developer keeps their own dummy data
 * for local testing, and it never reaches the shared repository. Only these
 * types are committed, so the fake API (mocks/api.ts) and data.ts agree.
 */

export interface Grant {
  roles: components['schemas']['Role'][];
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
  history?: components['schemas']['CreativeVersionRead'][];
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
  gate: components['schemas']['Gate'];
  mandatory: boolean;
  severity: components['schemas']['Severity'];
  check: { kind: 'phrases'; phrases: string[] } | { kind: 'min_words'; min_words: number };
  explanation: string;
  /** Why the rule could not be assessed (min_words only). */
  unassessed_reason?: string;
  suggested_correction?: string;
  needs_human_decision?: boolean;
  source: components['schemas']['SourceReference'];
}

/** A stored image. The fake API serves a labelled placeholder picture as its download link. */
export interface MockAsset extends Omit<components['schemas']['AssetRead'], 'download_url' | 'download_url_expires_at'> {
  tenant_id: string;
}

/** A stored run plus what the API keeps internally. */
export interface MockValidationRun {
  tenant_id: string;
  creative_id: string;
  /** Epoch ms the run started; the fake API moves it from QUEUED to RUNNING to done over a few seconds. */
  started_ms: number;
  /** The run as it reads once finished. */
  final: components['schemas']['ValidationRunRead'];
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
  POLICY_BUNDLE_VERSION: string;
}

/**
 * Omit for row types that also extend Record<string, unknown> (Astryx Table
 * rows): plain Omit would keep only the index signature and lose every field.
 */
type OmitKnown<T, K extends PropertyKey> = { [P in keyof T as string extends P ? never : P extends K ? never : P]: T[P] };

/** One organisation's dummy workspace. Every name is visibly fake. */
export interface MockWorkspace {
  media: OmitKnown<MediaAsset, 'preview_url'>[];
  rules: PolicyRule[];
  approvals: OmitKnown<ApprovalRequest, 'is_own'>[];
  accounts: SocialAccount[];
  publications: Publication[];
  members: Member[];
  activity: ActivityItem[];
}
