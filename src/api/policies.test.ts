import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import {
  activePolicyQuery,
  isNoActivePolicy,
  MAX_POLICY_RULES,
  parseActivePolicy,
  policyKeys,
  type ActivePolicy,
  type ActivePolicyRule,
} from './policies';

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

// Everything but the named key, so a test can say "missing X" without a cast.
const without = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

function expectInvalid(input: unknown): void {
  let thrown: unknown;
  try {
    parseActivePolicy(input);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ApiError);
  if (!(thrown instanceof ApiError)) return;
  expect(thrown.code).toBe('INVALID_RESPONSE');
  expect(thrown.retryable).toBe(false);
  expect(thrown.status).toBe(500);
}

const EXPECTED_RULES: ActivePolicyRule[] = [
  {
    rule_id: 'SYN-01',
    rule_version: 1,
    title: '[SYNTHETIC] Rule one',
    requirement: '[SYNTHETIC]  Requirement one, spacing kept. ',
    gate: 'policy',
    severity: 'critical',
    mandatory: true,
    applies_to: ['brief', 'text'],
    source: { source_id: 'synthetic:doc', clause: 'Clause 1', excerpt: null },
  },
  {
    rule_id: 'SYN-02',
    rule_version: 1,
    title: '[SYNTHETIC] Rule one',
    requirement: '[SYNTHETIC]  Requirement one, spacing kept. ',
    gate: 'policy',
    severity: 'critical',
    mandatory: true,
    applies_to: ['brief', 'text'],
    source: { source_id: 'study-snapshot', clause: 'facts', excerpt: 'quoted words' },
  },
];

const EXPECTED: ActivePolicy = {
  policy_bundle_id: '00000000-0000-4000-8000-0000000000a1',
  version: 3,
  name: '[SYNTHETIC] Demo bundle',
  source_ref: 'synthetic:bundle',
  is_synthetic: true,
  approved_by: 'Test Approver',
  approved_at: '2026-11-11T09:30:00+05:30',
  rules: EXPECTED_RULES,
};

describe('parseActivePolicy: valid bodies', () => {
  it('parses a valid body into the expected object, wording untouched', () => {
    expect(parseActivePolicy(body())).toEqual(EXPECTED);
  });

  it('accepts Z and fractional-second datetimes and an upper-case UUID', () => {
    const parsed = parseActivePolicy(
      body({ approved_at: '2026-11-11T04:00:00.123Z', policy_bundle_id: '00000000-0000-4000-8000-0000000000A1' }),
    );
    expect(parsed.approved_at).toBe('2026-11-11T04:00:00.123Z');
    expect(parsed.policy_bundle_id).toBe('00000000-0000-4000-8000-0000000000A1');
  });

  it('accepts an empty rules list and exactly MAX_POLICY_RULES rules', () => {
    expect(parseActivePolicy(body({ rules: [] })).rules).toEqual([]);
    expect(parseActivePolicy(body({ rules: Array.from({ length: MAX_POLICY_RULES }, () => rule()) })).rules).toHaveLength(
      MAX_POLICY_RULES,
    );
  });

  it('passes an unknown gate and an unknown input through as sent', () => {
    const [r] = parseActivePolicy(body({ rules: [rule({ gate: 'tone', applies_to: ['brief', 'video'] })] })).rules;
    expect(r.gate).toBe('tone');
    expect(r.applies_to).toEqual(['brief', 'video']);
  });

  it('drops unknown fields and returns a new object', () => {
    const inputRule = rule({ extra_rule: 1, source: { source_id: 's', clause: 'c', excerpt: 'e', extra_source: true } });
    const input = body({ extra_top: 'x', rules: [inputRule] });
    const parsed = parseActivePolicy(input);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(parsed.rules[0]).sort()).toEqual(Object.keys(EXPECTED_RULES[0]).sort());
    expect(Object.keys(parsed.rules[0].source).sort()).toEqual(['clause', 'excerpt', 'source_id']);
    expect(parsed).not.toBe(input);
    expect(parsed.rules[0]).not.toBe(inputRule);
  });
});

describe('parseActivePolicy: is_synthetic', () => {
  it('rejects a missing is_synthetic', () => {
    expectInvalid(without(body(), 'is_synthetic'));
  });

  it('rejects a renamed isSynthetic', () => {
    expectInvalid({ ...without(body(), 'is_synthetic'), isSynthetic: true });
  });

  it('rejects a string "true"', () => {
    expectInvalid(body({ is_synthetic: 'true' }));
  });

  it('accepts false', () => {
    expect(parseActivePolicy(body({ is_synthetic: false })).is_synthetic).toBe(false);
  });
});

describe('parseActivePolicy: top level', () => {
  it('rejects a missing or non-array rules', () => {
    expectInvalid(without(body(), 'rules'));
    expectInvalid(body({ rules: 'none' }));
    expectInvalid(body({ rules: null }));
  });

  it('rejects more than MAX_POLICY_RULES rules (201)', () => {
    expectInvalid(body({ rules: Array.from({ length: MAX_POLICY_RULES + 1 }, () => rule()) }));
  });

  it('rejects an approved_at without an offset, or not a datetime', () => {
    expectInvalid(body({ approved_at: '2026-11-11T09:30:00' }));
    expectInvalid(body({ approved_at: '2026-11-11' }));
    expectInvalid(body({ approved_at: '2026-13-45T99:99:99Z' }));
    expectInvalid(body({ approved_at: 1762853400 }));
  });

  it('rejects a bundle id that is not a UUID', () => {
    expectInvalid(body({ policy_bundle_id: 'not-a-uuid' }));
    expectInvalid(body({ policy_bundle_id: '../00000000-0000-4000-8000-0000000000a1' }));
    expectInvalid(body({ policy_bundle_id: 7 }));
  });

  it('rejects a bad version, name, source_ref or approved_by', () => {
    expectInvalid(body({ version: 0 }));
    expectInvalid(body({ version: 1.5 }));
    expectInvalid(body({ version: '1' }));
    expectInvalid(without(body(), 'name'));
    expectInvalid(body({ source_ref: null }));
    expectInvalid(body({ approved_by: 5 }));
  });

  it('rejects a body that is not an object', () => {
    expectInvalid(null);
    expectInvalid(undefined);
    expectInvalid('policy');
    expectInvalid(42);
    expectInvalid([]);
    expectInvalid([body()]);
  });
});

describe('parseActivePolicy: rules', () => {
  const withRule = (extra: Record<string, unknown>): Record<string, unknown> => body({ rules: [rule(extra)] });

  it('rejects a rule that is not an object', () => {
    expectInvalid(body({ rules: [null] }));
    expectInvalid(body({ rules: ['SYN-01'] }));
  });

  it('rejects a bad rule_id', () => {
    expectInvalid(withRule({ rule_id: 'syn-01' }));
    expectInvalid(withRule({ rule_id: '1SYN' }));
    expectInvalid(withRule({ rule_id: 'S' }));
    expectInvalid(withRule({ rule_id: `S${'A'.repeat(40)}` }));
    expectInvalid(withRule({ rule_id: 'SYN 01' }));
  });

  it('rejects a bad rule_version', () => {
    expectInvalid(withRule({ rule_version: 0 }));
    expectInvalid(withRule({ rule_version: 2.5 }));
  });

  it('rejects an empty or missing title, requirement or gate', () => {
    expectInvalid(withRule({ title: '' }));
    expectInvalid(withRule({ requirement: '' }));
    expectInvalid(withRule({ gate: '' }));
    expectInvalid(body({ rules: [without(rule(), 'title')] }));
    expectInvalid(body({ rules: [without(rule(), 'gate')] }));
  });

  it('rejects an unknown severity, so the whole response fails', () => {
    expectInvalid(withRule({ severity: 'blocker' }));
    expectInvalid(withRule({ severity: 'CRITICAL' }));
    expectInvalid(withRule({ severity: 'toString' }));
  });

  it('rejects a mandatory that is not a boolean', () => {
    expectInvalid(withRule({ mandatory: 'yes' }));
    expectInvalid(body({ rules: [without(rule(), 'mandatory')] }));
  });

  it('rejects an empty or non-string applies_to', () => {
    expectInvalid(withRule({ applies_to: [] }));
    expectInvalid(withRule({ applies_to: 'brief' }));
    expectInvalid(withRule({ applies_to: ['brief', 3] }));
  });

  it('rejects a bad source', () => {
    expectInvalid(withRule({ source: null }));
    expectInvalid(withRule({ source: { source_id: 's', clause: 'c' } }));
    expectInvalid(withRule({ source: { source_id: 1, clause: 'c', excerpt: null } }));
    expectInvalid(withRule({ source: { source_id: 's', clause: 'c', excerpt: 5 } }));
  });

  it('error message carries no server values', () => {
    let thrown: unknown;
    try {
      parseActivePolicy(body({ name: 7, approved_by: 'SECRET-VALUE' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    if (thrown instanceof ApiError) {
      expect(thrown.message).toBe('The active policy came back in an unexpected shape.');
    }
  });
});

describe('query keys and options', () => {
  it('policyKeys.active is scoped to the tenant', () => {
    expect(policyKeys.active('t1')).toEqual(['ws', 't1', 'policy', 'active']);
    expect(policyKeys.active('t2')).not.toEqual(policyKeys.active('t1'));
  });

  it('activePolicyQuery uses the same key', () => {
    expect(activePolicyQuery('t1').queryKey).toEqual(['ws', 't1', 'policy', 'active']);
  });
});

describe('isNoActivePolicy', () => {
  it('is true only for a 404 ApiError', () => {
    expect(isNoActivePolicy(new ApiError(404))).toBe(true);
    expect(isNoActivePolicy(new ApiError(500))).toBe(false);
    expect(isNoActivePolicy(new Error('x'))).toBe(false);
    expect(isNoActivePolicy(null)).toBe(false);
  });
});
