import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, isApiError } from './errors';
import { configureHttp } from './http';
import {
  activePolicyQuery,
  ActivePolicySchema,
  isNoActivePolicy,
  MAX_POLICY_RULES,
  policyApi,
  policyKeys,
  ruleLookup,
  type PolicyBundle,
} from './policy';

// Visibly fake values only: no real policy wording.
const rule = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  rule_id: 'SYN-01',
  rule_version: 1,
  title: '[SYNTHETIC] Rule one',
  requirement: '[SYNTHETIC]  Requirement one, spacing kept. ',
  gate: 'policy',
  severity: 'critical',
  mandatory: true,
  applies_to: ['brief', 'text'],
  source: { source_id: 'synthetic:doc', clause: 'Clause 1', excerpt: null },
  ...extra,
});

const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  policy_bundle_id: '00000000-0000-4000-8000-0000000000a1',
  version: 3,
  name: '[SYNTHETIC] Demo bundle',
  source_ref: 'synthetic:bundle',
  is_synthetic: true,
  approved_by: 'Test Approver',
  approved_at: '2026-11-11T09:30:00+05:30',
  rules: [rule(), rule({ rule_id: 'SYN-02', source: { source_id: 'study-snapshot', clause: 'facts', excerpt: 'quoted words' } })],
  ...extra,
});

const without = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

const ok = (b: unknown): boolean => ActivePolicySchema.safeParse(b).success;

describe('ActivePolicySchema: valid bodies', () => {
  it('parses a valid body with the wording untouched', () => {
    const r = ActivePolicySchema.safeParse(body());
    expect(r.success).toBe(true);
    expect(r.data?.rules[0]?.requirement).toBe('[SYNTHETIC]  Requirement one, spacing kept. ');
  });

  it('accepts an upper-case UUID, a missing excerpt and exactly MAX_POLICY_RULES rules', () => {
    expect(ok(body({ policy_bundle_id: '00000000-0000-4000-8000-0000000000AB' }))).toBe(true);
    expect(ok(body({ rules: [rule({ source: { source_id: 's', clause: 'c' } })] }))).toBe(true);
    const many = Array.from({ length: MAX_POLICY_RULES }, (_, i) => rule({ rule_id: `SYN-${i + 1}` }));
    expect(ok(body({ rules: many }))).toBe(true);
    expect(ok(body({ rules: [] }))).toBe(true);
  });

  it('drops unknown fields', () => {
    const r = ActivePolicySchema.safeParse(body({ extra: 'x' }));
    expect(r.success && 'extra' in r.data).toBe(false);
  });
});

// Regression (PR #4, JS-14): is_synthetic is the only thing that shows the synthetic warning.
describe('ActivePolicySchema: is_synthetic', () => {
  it('rejects a missing, renamed or string is_synthetic', () => {
    expect(ok(without(body(), 'is_synthetic'))).toBe(false);
    expect(ok({ ...without(body(), 'is_synthetic'), isSynthetic: true })).toBe(false);
    expect(ok(body({ is_synthetic: 'true' }))).toBe(false);
    expect(ok(body({ is_synthetic: false }))).toBe(true);
  });
});

describe('ActivePolicySchema: checks beyond the contract', () => {
  it('rejects a bundle id that is not a UUID', () => {
    expect(ok(body({ policy_bundle_id: 'sim-policy-bundle' }))).toBe(false);
  });

  it('rejects more than MAX_POLICY_RULES rules', () => {
    const many = Array.from({ length: MAX_POLICY_RULES + 1 }, (_, i) => rule({ rule_id: `SYN-${i + 1}` }));
    expect(ok(body({ rules: many }))).toBe(false);
  });

  it('rejects a bad rule_id and an empty applies_to', () => {
    expect(ok(body({ rules: [rule({ rule_id: 'syn-01' })] }))).toBe(false);
    expect(ok(body({ rules: [rule({ rule_id: 'S' })] }))).toBe(false);
    expect(ok(body({ rules: [rule({ applies_to: [] })] }))).toBe(false);
  });

  it('names fields, never server values, in its issues', () => {
    const r = ActivePolicySchema.safeParse(body({ policy_bundle_id: 'SECRET-VALUE' }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues.map((i) => i.message))).not.toContain('SECRET-VALUE');
  });
});

describe('ActivePolicySchema: contract', () => {
  it('rejects missing rules, a bad datetime, an unknown severity, gate or input', () => {
    expect(ok(without(body(), 'rules'))).toBe(false);
    expect(ok(body({ approved_at: '2026-11-11T09:30:00' }))).toBe(false);
    expect(ok(body({ rules: [rule({ severity: 'blocker' })] }))).toBe(false);
    // Decided 13 Nov (Firoz): follow the contract; a newer gate or input needs a regenerated schema.
    expect(ok(body({ rules: [rule({ gate: 'tone' })] }))).toBe(false);
    expect(ok(body({ rules: [rule({ applies_to: ['video'] })] }))).toBe(false);
  });

  it('rejects a non-object body', () => {
    for (const b of [null, 'x', 1, []]) expect(ok(b)).toBe(false);
  });
});

describe('policyApi.active', () => {
  const answer =
    (status: number, json: unknown): typeof fetch =>
    () =>
      Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
  afterEach(() => configureHttp({ baseUrl: '', fetch: globalThis.fetch }));

  it('fails as a contract mismatch, never returning rules, when is_synthetic is missing', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, without(body(), 'is_synthetic')), tokens: null });
    const err: unknown = await policyApi.active().catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('CONTRACT_MISMATCH');
  });

  it('returns the parsed policy', async () => {
    configureHttp({ baseUrl: '', fetch: answer(200, body()), tokens: null });
    expect((await policyApi.active()).rules.map((r) => r.rule_id)).toEqual(['SYN-01', 'SYN-02']);
  });
});

describe('keys, options and helpers', () => {
  it('policyKeys.active is scoped to the tenant and used by activePolicyQuery', () => {
    expect(policyKeys.active('t1')).toEqual(['ws', 't1', 'policy', 'active']);
    expect(activePolicyQuery('t1').queryKey).toEqual(['ws', 't1', 'policy', 'active']);
  });

  it('isNoActivePolicy is true only for a 404 ApiError', () => {
    expect(isNoActivePolicy(new ApiError(404))).toBe(true);
    expect(isNoActivePolicy(new ApiError(500))).toBe(false);
    expect(isNoActivePolicy(new Error('x'))).toBe(false);
  });

  it('ruleLookup finds a rule by id and version', () => {
    const r = ActivePolicySchema.safeParse(body());
    const p: PolicyBundle | undefined = r.success ? r.data : undefined;
    expect(ruleLookup(p)('SYN-02', 1)?.source.clause).toBe('facts');
    expect(ruleLookup(p)('SYN-02', 2)).toBeUndefined();
    expect(ruleLookup(undefined)('SYN-01', 1)).toBeUndefined();
  });
});
