import type { ReactElement } from 'react';
import type { BundleState, PolicyAuditEntry, PolicyIssue, PolicyNode, PolicyWording } from '@/api/policyAdmin';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

/**
 * Words for the rulebook screens (NRC-20). Status is always a word plus a
 * colour, never colour alone. A built or approved rulebook is never worded as
 * if it were in use: only ACTIVE says so.
 */

export const STATE_WORD: Record<BundleState, [BadgeVariant, string]> = {
  DRAFT: ['neutral', 'Draft'],
  REVIEW: ['waiting', 'In review'],
  APPROVED: ['brand', 'Approved'],
  BUILDING: ['brand', 'Building'],
  READY: ['brand', 'Ready to activate'],
  ACTIVE: ['done', 'Active'],
  REJECTED: ['blocked', 'Rejected'],
  RETIRED: ['neutral', 'Retired'],
};

/** What the status means for the people using it, in one sentence. */
export const STATE_HINT: Record<BundleState, string> = {
  DRAFT: 'Not in use. A draft can be edited, then sent for review.',
  REVIEW: 'Not in use. Waiting for the policy owner to approve or reject it.',
  APPROVED: 'Approved, not in use yet. The search index is being prepared before it can be activated.',
  BUILDING: 'Approved, not in use yet. The search index is being built.',
  READY: 'Built and ready, but not in use until someone activates it.',
  ACTIVE: 'In use now. Every brief, caption and image is checked against it. It cannot be edited; changes go into a new draft.',
  REJECTED: 'Not in use. The policy owner rejected it; the reason is in the history.',
  RETIRED: 'Not in use. Kept as a record of what was checked before.',
};

export function BundleStateBadge({ state }: { state: BundleState }): ReactElement {
  const [variant, text] = STATE_WORD[state];
  return <Badge variant={variant}>{text}</Badge>;
}

type ReviewState = PolicyNode['review_state'];
const REVIEW_WORD: Record<ReviewState, [BadgeVariant, string]> = {
  PROPOSED: ['waiting', 'Not reviewed'],
  APPROVED: ['done', 'Reviewed'],
  REJECTED: ['blocked', 'Rejected'],
};

export function ReviewBadge({ state }: { state: ReviewState }): ReactElement {
  const [variant, text] = REVIEW_WORD[state];
  return <Badge variant={variant}>{text}</Badge>;
}

export const ORIGIN_WORD: Record<PolicyNode['origin'], string> = {
  HUMAN: 'Written by a person',
  IMPORT: 'Imported',
  LLM_SIMULATED: 'Suggested by AI (simulated)',
  LLM: 'Suggested by AI',
};

export const NODE_TYPE_WORD: Record<PolicyNode['node_type'], string> = {
  RULE: 'Rule',
  CLAUSE: 'Source clause',
  DISCLOSURE: 'Disclosure',
  EXCEPTION: 'Exception',
  INTERPRETATION: 'Interpretation',
  EXAMPLE: 'Example',
};

export const WORDING_KIND_WORD: Record<PolicyWording['kind'], string> = {
  EXACT_WORDING: 'Exact wording to use',
  PROHIBITED_PHRASE: 'Phrase not allowed',
  STUDY_APPROVED_WORDING: "The study's approved wording",
};

/** A short title for each problem the server's checks can report; the API's own message follows it. */
export const ISSUE_WORD: Record<PolicyIssue['code'], string> = {
  EMPTY_BUNDLE: 'No rules yet',
  UNREVIEWED_ITEM: 'Not reviewed yet',
  MISSING_PROVENANCE: 'Source missing',
  EDGE_TO_UNAPPROVED_NODE: 'Linked to an item that is not approved',
  SUPERSEDES_CYCLE: 'Rules replace each other in a loop',
  SUPERSEDES_CONFLICT: 'Conflicting replacements',
  CONTRADICTORY_WORDING: 'Wordings contradict each other',
  UNRESOLVED_EXCEPTION: 'Exception not resolved',
  UNSUPPORTED_LANGUAGE: 'Language not supported',
  DUPLICATE_OBLIGATION: 'Same requirement twice',
  EXACT_WORDING_NOT_IN_SOURCE: 'Exact wording not found in the source',
  INDEX_STALE: 'Search index out of date',
};

export const BUILD_FAILURE_WORD: Record<NonNullable<import('@/api/policyAdmin').PolicyBundleDetail['last_error_code']>, string> = {
  POLICY_BUILD_ABANDONED: 'The build was stopped before it finished.',
  NO_APPROVED_NODES: 'There are no approved items to build from.',
  INDEX_CONTENT_CHANGED: 'The content changed while the index was being built.',
  POLICY_INDEX_REFUSED: 'The search index refused the content.',
  EMBEDDING_UNAVAILABLE: 'The text search service was not available.',
  EMBEDDING_FAILED: 'The text search service failed.',
};

export const AUDIT_WORD: Record<PolicyAuditEntry['action'], string> = {
  CREATE: 'Created',
  EDIT: 'Edited',
  SUBMIT: 'Sent for review',
  REVIEW: 'Reviewed an item',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN_TO_DRAFT: 'Returned to draft',
  BUILD_STARTED: 'Build started',
  BUILD_READY: 'Build finished',
  BUILD_FAILED: 'Build failed',
  ACTIVATE: 'Activated',
  ROLLBACK: 'Rolled back to this version',
  RETIRE: 'Retired',
};

type ExtractionState = import('@/api/policyAdmin').PolicySource['extraction_state'];
export const EXTRACTION_WORD: Record<ExtractionState, [BadgeVariant, string]> = {
  PENDING: ['waiting', 'Waiting to be read'],
  EXTRACTING: ['brand', 'Being read'],
  EXTRACTED: ['done', 'Clauses read'],
  FAILED: ['blocked', 'Could not be read'],
};

export function ExtractionBadge({ state }: { state: ExtractionState }): ReactElement {
  const [variant, text] = EXTRACTION_WORD[state];
  return <Badge variant={variant}>{text}</Badge>;
}
