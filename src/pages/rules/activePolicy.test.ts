import { describe, expect, it } from 'vitest';
import type { ActivePolicyRule } from '@/api/policies';
import { filterRules, inputsLabel, isFiltered, NO_FILTER } from './activePolicy';

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
});
