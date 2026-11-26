import { z } from 'zod';
import { isApiError } from './errors';
import { http } from './http';
import * as S from './schemas.gen';
import type { Capability } from './session';

/**
 * Policy administration (NRC-20 on Firoz's NRC-4 endpoints): rulebooks
 * (policy bundles), their rules, nodes, relationships and wordings, review,
 * the lifecycle commands, policy source files and the audit trail.
 *
 * Which command is allowed in which status, and with which capability, follows
 * the backend's TRANSITIONS table (nrc-marketing-api, app/services/policy_bundles.py).
 * The screens use it only to decide which buttons to show; the API stays the
 * authority and answers 403 or 409 anyway.
 *
 * Wording (rule text, exact wording, clauses) is sent and shown exactly as typed
 * or supplied: nothing here trims or rewrites it.
 */

export type BundleState = S.BundleLifecycleState;
export type BundleCommand = S.Command;
export type PolicyBundleDetail = S.PolicyBundleDetail;
export type PolicyBundlePage = S.PolicyBundlePage;
export type PolicyRuleRecord = S.PolicyRuleRead;
export type PolicyNode = S.PolicyNodeRead;
export type PolicyEdge = S.PolicyEdgeRead;
export type PolicyWording = S.PolicyWordingRead;
export type PolicyIssue = S.PolicyIssueRead;
export type PolicyAuditEntry = S.PolicyAuditRead;
export type PolicySource = S.PolicySourceRead;
export type PolicyClause = S.PolicyClauseRead;
export type PolicyUpload = S.PolicyUploadRead;
export type ReviewDecision = S.ReviewDecisionRequest;

interface Step {
  from: readonly BundleState[];
  /** Any one of these lets the caller run the command. */
  caps: readonly Capability[];
  reason: boolean;
}

/** In button order. Mirrors the backend's TRANSITIONS. */
const STEPS: Record<BundleCommand, Step> = {
  submit: { from: ['DRAFT'], caps: ['policy:manage'], reason: false },
  approve: { from: ['REVIEW'], caps: ['policy:approve'], reason: false },
  reject: { from: ['REVIEW'], caps: ['policy:approve'], reason: true },
  return_to_draft: { from: ['REVIEW'], caps: ['policy:manage', 'policy:approve'], reason: false },
  // Queues the index build again after a failed one; the bundle stays APPROVED.
  build: { from: ['APPROVED'], caps: ['policy:activate'], reason: false },
  activate: { from: ['READY'], caps: ['policy:activate'], reason: true },
  // Only back to a bundle that was active before (activated_at set).
  rollback: { from: ['RETIRED'], caps: ['policy:activate'], reason: true },
  retire: { from: ['ACTIVE'], caps: ['policy:activate'], reason: true },
};

/**
 * The status buttons this viewer may press on a bundle in `state`.
 * `wasActive`: the bundle has been active before (its `activated_at` is set).
 */
export function commandsFor(state: BundleState, caps: readonly Capability[], wasActive: boolean): BundleCommand[] {
  return (Object.keys(STEPS) as BundleCommand[]).filter((c) => {
    const step = STEPS[c];
    if (!step.from.includes(state)) return false;
    if (c === 'rollback' && !wasActive) return false;
    return step.caps.some((cap) => caps.includes(cap));
  });
}

/**
 * Commands this status offers that another role holds: the screen says who can
 * do them, instead of leaving the viewer to wonder why there is no button.
 */
export function commandsForOthers(state: BundleState, caps: readonly Capability[], wasActive: boolean): BundleCommand[] {
  const mine = commandsFor(state, caps, wasActive);
  return (Object.keys(STEPS) as BundleCommand[]).filter(
    (c) => STEPS[c].from.includes(state) && !(c === 'rollback' && !wasActive) && !mine.includes(c),
  );
}

/** Reject, activate, rollback and retire always name a reason. */
export const needsReason = (command: BundleCommand): boolean => STEPS[command].reason;

/** Items are created and edited only in a DRAFT bundle, with policy:manage. An active bundle is never edited in place. */
export const canEditBundle = (state: BundleState, caps: readonly Capability[]): boolean =>
  state === 'DRAFT' && caps.includes('policy:manage');

export type ReviewItem =
  | { kind: 'node'; nodeType: S.PolicyNodeType }
  | { kind: 'edge' }
  | { kind: 'wording'; wordingKind: S.WordingKind };

/**
 * Who reviews an item: exceptions, disclosures and study-approved wording go to
 * the policy owner (policy:approve); everything else to the policy
 * administrator (policy:manage).
 */
export function reviewCapability(item: ReviewItem): Capability {
  if (item.kind === 'node' && (item.nodeType === 'EXCEPTION' || item.nodeType === 'DISCLOSURE')) return 'policy:approve';
  if (item.kind === 'wording' && item.wordingKind === 'STUDY_APPROVED_WORDING') return 'policy:approve';
  return 'policy:manage';
}

/** If-Match value: the quoted revision the screen showed when the change was made. */
export const ifMatch = (revision: number): string => `"${revision}"`;

const StateConflict = z.object({ state: S.BundleLifecycleState, allowed: z.array(S.BundleLifecycleState) });
const IssuesConflict = z.object({ issues: z.array(S.PolicyIssueRead) });

export type BundleConflict =
  | { kind: 'state'; state: BundleState; allowed: BundleState[] }
  | { kind: 'issues'; issues: PolicyIssue[] };

/**
 * A 409 from a bundle command: the bundle moved to another status meanwhile
 * (POLICY_BUNDLE_STATE), or checks block it (POLICY_BUNDLE_HAS_ISSUES).
 * Anything else, or details that do not match, is null.
 */
export function bundleConflict(e: unknown): BundleConflict | null {
  if (!isApiError(e) || e.status !== 409) return null;
  if (e.code === 'POLICY_BUNDLE_STATE') {
    const d = StateConflict.safeParse(e.details);
    return d.success ? { kind: 'state', ...d.data } : null;
  }
  if (e.code === 'POLICY_BUNDLE_HAS_ISSUES') {
    const d = IssuesConflict.safeParse(e.details);
    return d.success ? { kind: 'issues', issues: d.data.issues } : null;
  }
  return null;
}

/* ---------- Policy files ---------- */

/** What the API accepts for a policy source (nrc-marketing-api: POLICY_SOURCE_TYPES, policy_source_max_bytes). */
export const POLICY_FILE_TYPES = ['application/pdf', 'text/plain', 'text/markdown'] as const;
export const POLICY_FILE_MAX_BYTES = 52_428_800;

/** Why this file cannot be a policy source, or null. The API checks the same. */
export function policyFileProblem(file: { type: string; size: number }): string | null {
  if (file.size === 0) return 'The file is empty.';
  if (!(POLICY_FILE_TYPES as readonly string[]).includes(file.type)) return 'Choose a PDF, a plain text file or a Markdown file.';
  if (file.size > POLICY_FILE_MAX_BYTES) return 'The file is larger than 50 MB.';
  return null;
}

/** SHA-256 of the file in lower-case hex: the API checks the upload against it. */
export async function fileChecksum(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The largest page the policy lists return (limit ≤ 50 on /policy-bundles, /policy-sources and /audit). */
export const POLICY_PAGE_MAX = 50;

const enc = encodeURIComponent;
const bundlePath = (id: string): string => `/policy-bundles/${enc(id)}`;

export const policyAdminApi = {
  /* ---------- Rulebooks (bundles) ---------- */
  bundles: (q: { state?: BundleState; before_version?: number; limit?: number } = {}, signal?: AbortSignal): Promise<PolicyBundlePage> =>
    http.get('/policy-bundles', S.PolicyBundlePage, { query: q, signal }),
  bundle: (id: string, signal?: AbortSignal): Promise<PolicyBundleDetail> =>
    http.get(bundlePath(id), S.PolicyBundleDetail, { signal }),
  createBundle: (body: S.BundleCreate): Promise<PolicyBundleDetail> =>
    http.post('/policy-bundles', S.PolicyBundleDetail, body),
  ruleRecords: (id: string, includeProposals = true, signal?: AbortSignal): Promise<S.PolicyRuleList> =>
    http.get(`${bundlePath(id)}/rule-records`, S.PolicyRuleList, { query: { include_proposals: includeProposals }, signal }),
  nodes: (id: string, signal?: AbortSignal): Promise<S.PolicyNodeList> =>
    http.get(`${bundlePath(id)}/nodes`, S.PolicyNodeList, { signal }),
  edges: (id: string, signal?: AbortSignal): Promise<S.PolicyEdgeList> =>
    http.get(`${bundlePath(id)}/edges`, S.PolicyEdgeList, { signal }),
  checks: (id: string, signal?: AbortSignal): Promise<S.PolicyBundleChecks> =>
    http.get(`${bundlePath(id)}/checks`, S.PolicyBundleChecks, { signal }),
  audit: (id: string, q: { before?: string; limit?: number } = {}, signal?: AbortSignal): Promise<S.PolicyAuditPage> =>
    http.get(`${bundlePath(id)}/audit`, S.PolicyAuditPage, { query: q, signal }),

  /* ---------- Lifecycle and review (If-Match: the revision the screen showed) ---------- */
  transition: (id: string, revision: number, command: BundleCommand, reason?: string | null): Promise<PolicyBundleDetail> =>
    http.post(`${bundlePath(id)}/transitions`, S.PolicyBundleDetail, { command, reason: reason ?? null }, { etag: ifMatch(revision) }),
  review: (id: string, revision: number, decision: ReviewDecision): Promise<PolicyBundleDetail> =>
    http.post(`${bundlePath(id)}/review-decisions`, S.PolicyBundleDetail, decision, { etag: ifMatch(revision) }),

  /* ---------- Editing a DRAFT bundle ---------- */
  createRule: (id: string, revision: number, body: S.RuleCreate): Promise<PolicyRuleRecord> =>
    http.post(`${bundlePath(id)}/rules`, S.PolicyRuleRead, body, { etag: ifMatch(revision) }),
  updateRule: (id: string, revision: number, ruleId: string, body: S.RuleUpdate): Promise<PolicyRuleRecord> =>
    http.patch(`${bundlePath(id)}/rules/${enc(ruleId)}`, S.PolicyRuleRead, body, { etag: ifMatch(revision) }),
  addWording: (id: string, revision: number, ruleId: string, body: S.WordingCreate): Promise<PolicyWording> =>
    http.post(`${bundlePath(id)}/rules/${enc(ruleId)}/wordings`, S.PolicyWordingRead, body, { etag: ifMatch(revision) }),
  createNode: (id: string, revision: number, body: S.NodeCreate): Promise<PolicyNode> =>
    http.post(`${bundlePath(id)}/nodes`, S.PolicyNodeRead, body, { etag: ifMatch(revision) }),
  updateNode: (id: string, revision: number, nodeId: string, body: S.NodeUpdate): Promise<PolicyNode> =>
    http.patch(`${bundlePath(id)}/nodes/${enc(nodeId)}`, S.PolicyNodeRead, body, { etag: ifMatch(revision) }),
  createEdge: (id: string, revision: number, body: S.EdgeCreate): Promise<PolicyEdge> =>
    http.post(`${bundlePath(id)}/edges`, S.PolicyEdgeRead, body, { etag: ifMatch(revision) }),

  /* ---------- Policy source files ---------- */
  sources: (q: { before?: string; limit?: number } = {}, signal?: AbortSignal): Promise<S.PolicySourcePage> =>
    http.get('/policy-sources', S.PolicySourcePage, { query: q, signal }),
  source: (id: string, signal?: AbortSignal): Promise<PolicySource> =>
    http.get(`/policy-sources/${enc(id)}`, S.PolicySourceRead, { signal }),
  clauses: (id: string, signal?: AbortSignal): Promise<S.PolicyClauseList> =>
    http.get(`/policy-sources/${enc(id)}/clauses`, S.PolicyClauseList, { signal }),
  createSource: (body: S.PolicySourceCreate): Promise<PolicySource> =>
    http.post('/policy-sources', S.PolicySourceRead, body),

  /** Step 1 of an upload. Reuse `idempotencyKey` when retrying the same file. */
  startUpload: (body: S.PolicyUploadCreate, idempotencyKey: string): Promise<PolicyUpload> =>
    http.post('/policy-sources/uploads', S.PolicyUploadRead, body, { idempotencyKey }),
  /** A fresh signed address to send the file to (the first one may have expired). */
  uploadUrl: (uploadId: string): Promise<PolicyUpload> =>
    http.post(`/policy-sources/uploads/${enc(uploadId)}/upload-url`, S.PolicyUploadRead),
  /** The file is sent: the server scans it. */
  completeUpload: (uploadId: string): Promise<PolicyUpload> =>
    http.post(`/policy-sources/uploads/${enc(uploadId)}/complete`, S.PolicyUploadRead),
  upload: (uploadId: string, signal?: AbortSignal): Promise<PolicyUpload> =>
    http.get(`/policy-sources/uploads/${enc(uploadId)}`, S.PolicyUploadRead, { signal }),
};
