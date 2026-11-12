import { describe, expect, it } from 'vitest';
import type { ActivePolicyRule } from '@/api/policies';
import {
  filterFromParams, filterRules, inputsLabel, isFiltered, isMandatoryFilter, isSeverityFilter, labelFor, MANDATORY_FILTERS,
  NO_FILTER, paramsWithFilter, POLICY_STATUS_TEXT, policyLoadState, SEVERITY_FILTERS, type PolicyFilter,
} from './activePolicy';
import { ApiError } from '@/api/errors';

const rule = (rule_id: string, extra: Partial<ActivePolicyRule> = {}): ActivePolicyRule => ({
  rule_id, rule_version: 1, title: `[SYNTHETIC] ${rule_id} title`, requirement: `[SYNTHETIC] ${rule_id} requirement`,
  gate: 'policy', severity: 'critical', mandatory: true, applies_to: ['brief'],
  source: { source_id: 'synthetic:doc', clause: `Clause ${rule_id}`, excerpt: null }, ...extra,
});

const RULES = [
  rule('REC-01'),
  rule('REC-02', { severity: 'major', mandatory: false, requirement: 'Payment must not be EMPHASISED.' }),
  rule('REC-03', { severity: 'minor', source: { source_id: 'study-snapshot', clause: 'facts', excerpt: 'quoted words' } }),
];

describe('filterRules', () => {
  it('returns every rule, in order, with no filter', () => {
    expect(filterRules(RULES, NO_FILTER).map((r) => r.rule_id)).toEqual(['REC-01', 'REC-02', 'REC-03']);
  });

  it('filters by severity and by mandatory status', () => {
    expect(filterRules(RULES, { ...NO_FILTER, severity: 'major' }).map((r) => r.rule_id)).toEqual(['REC-02']);
    expect(filterRules(RULES, { ...NO_FILTER, mandatory: 'optional' }).map((r) => r.rule_id)).toEqual(['REC-02']);
    expect(filterRules(RULES, { ...NO_FILTER, mandatory: 'mandatory' }).map((r) => r.rule_id)).toEqual(['REC-01', 'REC-03']);
    expect(filterRules(RULES, { ...NO_FILTER, severity: 'critical', mandatory: 'optional' })).toEqual([]);
  });

  it('searches ID, wording, source and excerpt, ignoring case and outer spaces', () => {
    expect(filterRules(RULES, { ...NO_FILTER, search: ' rec-01 ' }).map((r) => r.rule_id)).toEqual(['REC-01']);
    expect(filterRules(RULES, { ...NO_FILTER, search: 'emphasised' }).map((r) => r.rule_id)).toEqual(['REC-02']);
    expect(filterRules(RULES, { ...NO_FILTER, search: 'study-snapshot' }).map((r) => r.rule_id)).toEqual(['REC-03']);
    expect(filterRules(RULES, { ...NO_FILTER, search: 'quoted' }).map((r) => r.rule_id)).toEqual(['REC-03']);
  });

  it('returns the rules unchanged, never rewording them', () => {
    const [r] = filterRules(RULES, { ...NO_FILTER, search: 'payment' });
    expect(r).toBe(RULES[1]);
    expect(r.requirement).toBe('Payment must not be EMPHASISED.');
  });
});

describe('isFiltered and inputsLabel', () => {
  it('knows when a filter is set', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, search: '  ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, mandatory: 'optional' })).toBe(true);
  });

  it('labels inputs and keeps unknown ones as sent', () => {
    expect(inputsLabel(['brief', 'text', 'image'])).toBe('Brief, Caption and text, Image');
    expect(inputsLabel(['video'])).toBe('video');
  });

  // Regression (PR #4, JS-13): a plain lookup returned inherited members such as Object's constructor.
  it('shows inherited property names as sent, not as function source', () => {
    expect(inputsLabel(['constructor', 'toString', '__proto__'])).toBe('constructor, toString, __proto__');
    expect(labelFor({ policy: 'Policy rules' }, 'constructor')).toBe('constructor');
    expect(labelFor({ policy: 'Policy rules' }, 'hasOwnProperty')).toBe('hasOwnProperty');
    expect(labelFor({ policy: 'Policy rules' }, 'policy')).toBe('Policy rules');
  });
});

describe('policyLoadState', () => {
  const base = { isPending: false, isError: false, error: null };
  it('maps the query to what the page shows', () => {
    expect(policyLoadState({ ...base, isPending: true })).toBe('loading');
    expect(policyLoadState({ ...base, isError: true, error: new ApiError(404) })).toBe('setup_required');
    expect(policyLoadState({ ...base, isError: true, error: new ApiError(500) })).toBe('failed');
    expect(policyLoadState({ ...base, data: { rules: [] } })).toBe('setup_required');
    expect(policyLoadState({ ...base, data: { rules: [{}] } })).toBe('loaded');
  });

  // Regression (PR #4, RE-65): the status text, not the region's mounting, carries every state.
  it('has status text for every state except loaded', () => {
    expect(POLICY_STATUS_TEXT.loading).not.toBe('');
    expect(POLICY_STATUS_TEXT.setup_required).not.toMatch(/Policy setup required|no active policy/);
    expect(POLICY_STATUS_TEXT.failed).not.toBe('');
    expect(POLICY_STATUS_TEXT.loaded).toBe('');
  });
});

describe('filter guards', () => {
  it('accept only the listed values', () => {
    for (const v of SEVERITY_FILTERS) expect(isSeverityFilter(v)).toBe(true);
    for (const v of MANDATORY_FILTERS) expect(isMandatoryFilter(v)).toBe(true);
    for (const v of ['constructor', '', 'CRITICAL', null, undefined, 1]) {
      expect(isSeverityFilter(v)).toBe(false);
      expect(isMandatoryFilter(v)).toBe(false);
    }
  });
});

describe('filters in the URL', () => {
  it('reads valid params and falls back to "any" for anything else', () => {
    expect(filterFromParams(new URLSearchParams('severity=critical&mandatory=mandatory&q=pay'))).toEqual({ severity: 'critical', mandatory: 'mandatory', search: 'pay' });
    expect(filterFromParams(new URLSearchParams('severity=constructor&mandatory=yes'))).toEqual(NO_FILTER);
    expect(filterFromParams(new URLSearchParams(''))).toEqual(NO_FILTER);
  });

  it('writes only non-default values and keeps other params', () => {
    const p = paramsWithFilter(new URLSearchParams('tab=x&severity=minor'), { severity: 'any', mandatory: 'optional', search: 'a b' });
    expect(p.get('tab')).toBe('x');
    expect(p.has('severity')).toBe(false);
    expect(p.get('mandatory')).toBe('optional');
    expect(p.get('q')).toBe('a b');
    expect(paramsWithFilter(new URLSearchParams(), NO_FILTER).toString()).toBe('');
  });

  it('round-trips a filter', () => {
    const f: PolicyFilter = { severity: 'major', mandatory: 'optional', search: 'Clause 4' };
    expect(filterFromParams(paramsWithFilter(new URLSearchParams(), f))).toEqual(f);
  });
});
