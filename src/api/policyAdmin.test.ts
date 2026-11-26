import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, isApiError } from './errors';
import { configureHttp } from './http';
import type { Capability } from './session';
import {
  bundleConflict,
  canEditBundle,
  commandsFor,
  commandsForOthers,
  fileChecksum,
  POLICY_FILE_MAX_BYTES,
  policyFileProblem,
  ifMatch,
  needsReason,
  policyAdminApi,
  reviewCapability,
  type BundleCommand,
  type BundleState,
} from './policyAdmin';

// Visibly fake values only: no real policy wording.
const BUNDLE_ID = '00000000-0000-4000-8000-0000000000b1';
const detail = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: BUNDLE_ID,
  version: 2,
  name: '[SYNTHETIC] Demo rulebook',
  source_ref: 'synthetic:bundle',
  is_synthetic: true,
  lifecycle_state: 'DRAFT',
  revision: 3,
  based_on_bundle_id: null,
  approved_by: null,
  approved_at: null,
  activated_by: null,
  activated_at: null,
  last_error_code: null,
  created_at: '2026-11-26T09:00:00Z',
  updated_at: '2026-11-26T09:05:00Z',
  rule_count: 4,
  ...extra,
});

const ADMIN: Capability[] = ['creative:read', 'policy:manage', 'policy:activate'];
const APPROVER: Capability[] = ['creative:read', 'policy:approve'];
const CREATOR: Capability[] = ['creative:read', 'creative:write', 'validation:run'];

describe('commandsFor: which status buttons a role sees', () => {
  const cases: [BundleState, Capability[], boolean, BundleCommand[]][] = [
    ['DRAFT', ADMIN, false, ['submit']],
    ['DRAFT', APPROVER, false, []],
    ['REVIEW', APPROVER, false, ['approve', 'reject', 'return_to_draft']],
    ['REVIEW', ADMIN, false, ['return_to_draft']],
    ['APPROVED', ADMIN, false, ['build']],
    ['BUILDING', ADMIN, false, []],
    ['READY', ADMIN, false, ['activate']],
    ['READY', APPROVER, false, []],
    ['ACTIVE', ADMIN, true, ['retire']],
    ['RETIRED', ADMIN, true, ['rollback']],
    ['RETIRED', ADMIN, false, []],
    ['REJECTED', ADMIN, false, []],
  ];
  it.each(cases)('%s with %j (was active: %s) → %j', (state, caps, wasActive, expected) => {
    expect(commandsFor(state, caps, wasActive)).toEqual(expected);
  });

  it('gives a creator no buttons in any status', () => {
    for (const s of ['DRAFT', 'REVIEW', 'APPROVED', 'BUILDING', 'READY', 'ACTIVE', 'REJECTED', 'RETIRED'] as BundleState[]) {
      expect(commandsFor(s, CREATOR, true)).toEqual([]);
    }
  });
});

describe('commandsForOthers: buttons this status has, held by another role', () => {
  it('tells a policy administrator that approving a rulebook in review is for the policy owner', () => {
    expect(commandsForOthers('REVIEW', ADMIN, false)).toEqual(['approve', 'reject']);
  });
  it('tells a policy owner that activating is for the policy administrator', () => {
    expect(commandsForOthers('READY', APPROVER, false)).toEqual(['activate']);
  });
  it('is empty when the viewer holds every button of the status', () => {
    expect(commandsForOthers('DRAFT', ADMIN, false)).toEqual([]);
  });
});

describe('needsReason', () => {
  it('asks for a reason on reject, activate, rollback and retire only', () => {
    expect((['submit', 'return_to_draft', 'approve', 'reject', 'build', 'activate', 'rollback', 'retire'] as BundleCommand[]).filter(needsReason))
      .toEqual(['reject', 'activate', 'rollback', 'retire']);
  });
});

describe('canEditBundle', () => {
  it('allows edits in DRAFT only, never in an active or approved bundle', () => {
    expect(canEditBundle('DRAFT', ADMIN)).toBe(true);
    expect(canEditBundle('REVIEW', ADMIN)).toBe(false);
    expect(canEditBundle('ACTIVE', ADMIN)).toBe(false);
    expect(canEditBundle('DRAFT', APPROVER)).toBe(false);
  });
});

describe('reviewCapability: who reviews which item', () => {
  it('sends exceptions, disclosures and study wording to the policy owner', () => {
    expect(reviewCapability({ kind: 'node', nodeType: 'EXCEPTION' })).toBe('policy:approve');
    expect(reviewCapability({ kind: 'node', nodeType: 'DISCLOSURE' })).toBe('policy:approve');
    expect(reviewCapability({ kind: 'wording', wordingKind: 'STUDY_APPROVED_WORDING' })).toBe('policy:approve');
  });
  it('leaves every other item with the policy administrator', () => {
    expect(reviewCapability({ kind: 'node', nodeType: 'RULE' })).toBe('policy:manage');
    expect(reviewCapability({ kind: 'node', nodeType: 'CLAUSE' })).toBe('policy:manage');
    expect(reviewCapability({ kind: 'wording', wordingKind: 'EXACT_WORDING' })).toBe('policy:manage');
    expect(reviewCapability({ kind: 'edge' })).toBe('policy:manage');
  });
});

describe('ifMatch', () => {
  it('quotes the revision the screen edited', () => {
    expect(ifMatch(3)).toBe('"3"');
  });
});

describe('bundleConflict: reading a 409 answer', () => {
  it('reads a wrong-status answer with the allowed statuses', () => {
    const e = new ApiError(409, { code: 'POLICY_BUNDLE_STATE', message: 'x', details: { state: 'DRAFT', allowed: ['READY'] } });
    expect(bundleConflict(e)).toEqual({ kind: 'state', state: 'DRAFT', allowed: ['READY'] });
  });
  it('reads the blocking issues', () => {
    const issue = { code: 'UNREVIEWED_ITEM', subject: 'rule:SYN-01', message: '[SYNTHETIC] Not reviewed.' };
    const e = new ApiError(409, { code: 'POLICY_BUNDLE_HAS_ISSUES', message: 'x', details: { issues: [issue] } });
    expect(bundleConflict(e)).toEqual({ kind: 'issues', issues: [issue] });
  });
  it('ignores other errors and malformed details', () => {
    expect(bundleConflict(new ApiError(409, { code: 'OTHER', message: 'x' }))).toBeNull();
    expect(bundleConflict(new ApiError(409, { code: 'POLICY_BUNDLE_STATE', message: 'x', details: 'nope' }))).toBeNull();
    expect(bundleConflict(new Error('x'))).toBeNull();
  });
});

describe('policyAdminApi: what goes over the wire', () => {
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const answer =
    (status: number, json: unknown): typeof fetch =>
    (input, init) => {
      calls.push({
        method: init?.method ?? 'GET',
        // The app calls fetch with a string address and a JSON string body.
        url: input as string,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
    };
  afterEach(() => {
    calls.length = 0;
    configureHttp({ baseUrl: '', fetch: globalThis.fetch });
  });

  it('sends a status change with the edited revision and the reason', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, detail({ lifecycle_state: 'ACTIVE', revision: 4 })), tokens: null });
    const out = await policyAdminApi.transition(BUNDLE_ID, 3, 'activate', '[SYNTHETIC] Reason');
    expect(out.lifecycle_state).toBe('ACTIVE');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/policy-bundles/${BUNDLE_ID}/transitions`,
      headers: { 'If-Match': '"3"' },
      body: { command: 'activate', reason: '[SYNTHETIC] Reason' },
    });
  });

  it('sends a review decision for one item', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, detail({ revision: 4 })), tokens: null });
    await policyAdminApi.review(BUNDLE_ID, 3, { item_kind: 'node', item_id: 'n1', decision: 'APPROVED', note: null });
    expect(calls[0]).toMatchObject({
      url: `/policy-bundles/${BUNDLE_ID}/review-decisions`,
      headers: { 'If-Match': '"3"' },
      body: { item_kind: 'node', item_id: 'n1', decision: 'APPROVED' },
    });
  });

  it('lists bundles with the status filter in the query', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, { items: [detail()], next_cursor: null }), tokens: null });
    const page = await policyAdminApi.bundles({ state: 'DRAFT', limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(calls[0]?.url).toBe('/policy-bundles?state=DRAFT&limit=20');
  });

  it('starts a policy file upload with an idempotency key', async () => {
    const upload = {
      upload_id: 'u1', purpose: 'policy_source', status: 'PENDING_UPLOAD', reason: null, name: 'synthetic.pdf',
      mime_type: 'application/pdf', size_bytes: 10, checksum_sha256: 'a'.repeat(64), scan: null,
      created_by: 'dev-admin', created_at: '2026-11-26T09:00:00Z', completed_at: null, upload: null,
    };
    configureHttp({ baseUrl: '', fetch: answer(201, upload), tokens: null });
    await policyAdminApi.startUpload({ name: 'synthetic.pdf', mime_type: 'application/pdf', size_bytes: 10, checksum_sha256: 'a'.repeat(64) }, 'key-1');
    expect(calls[0]).toMatchObject({ url: '/policy-sources/uploads', headers: { 'Idempotency-Key': 'key-1' } });
  });

  it('refuses a bundle the contract does not describe', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, detail({ lifecycle_state: 'SOMETHING_ELSE' })), tokens: null });
    const err: unknown = await policyAdminApi.bundle(BUNDLE_ID).catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('CONTRACT_MISMATCH');
  });
});

describe('policy files', () => {
  it('takes the SHA-256 fingerprint the API asks for, in lower-case hex', async () => {
    expect(await fileChecksum(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('accepts PDF, plain text and Markdown up to 50 MB only', () => {
    expect(policyFileProblem({ type: 'application/pdf', size: 10 })).toBeNull();
    expect(policyFileProblem({ type: 'text/markdown', size: 10 })).toBeNull();
    expect(policyFileProblem({ type: 'image/png', size: 10 })).toMatch(/PDF/);
    expect(policyFileProblem({ type: 'application/pdf', size: POLICY_FILE_MAX_BYTES + 1 })).toMatch(/50 MB/);
    expect(policyFileProblem({ type: 'text/plain', size: 0 })).toMatch(/empty/);
  });
});
