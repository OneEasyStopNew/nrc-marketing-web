import { describe, expect, it } from 'vitest';
import * as S from '@/api/schemas.gen';
import type { ContextEvidence, ContextRule, ValidationContext } from '@/api/validations';
import contextSample from '@/api/__fixtures__/validationContext.nrc5.json';
import { ApiError } from '@/api/errors';
import { evidencePanel, missingContextNote, rulesWithEvidence, unlinkedEvidence } from './evidence';

/** The backend's own sample (contracts/examples/nrc5.json), read the way the app reads it. */
const sample = (): ValidationContext => S.ValidationContextRead.parse(contextSample);

const rule = (id: string, patch: Partial<ContextRule> = {}): ContextRule => ({
  rule_id: id, rule_version: 1, node_key: id, mandatory: true, check_type: 'semantic', gate: 'policy', severity: 'major', unresolved: [], ...patch,
});
const source = (key: string, paths: string[][], patch: Partial<ContextEvidence> = {}): ContextEvidence => ({
  node_key: key, node_type: 'CLAUSE', language: 'en', excerpt: `[SYNTHETIC] ${key}`, clause_ref: key, paths, matches: [], ...patch,
});

describe('rulesWithEvidence', () => {
  it('lists every selected rule in the order the run used them', () => {
    expect(rulesWithEvidence(sample()).map((r) => r.rule.rule_id)).toEqual(['REC-01', 'REC-02', 'REC-03', 'REC-04', 'REC-05', 'REC-08']);
  });

  it('puts each source text under the rule whose path reaches it', () => {
    const byRule = Object.fromEntries(rulesWithEvidence(sample()).map((r) => [r.rule.rule_id, r.sources.map((s) => s.node_key)]));
    expect(byRule).toEqual({
      'REC-01': ['CL-FDA-1', 'CL-FDA-1-ES'],
      'REC-02': ['CL-FDA-2'],
      'REC-03': ['CL-FDA-3'],
      'REC-04': ['CL-FDA-4'],
      'REC-05': ['CL-FDA-5'],
      'REC-08': ['INT-01'],
    });
  });

  it('shows a source reached by two rules under both', () => {
    const context = { ...sample(), required_rules: [rule('R-A'), rule('R-B')], evidence: [source('CL-1', [['R-A', 'supported_by', 'CL-1'], ['R-B', 'supported_by', 'CL-1']])] };
    expect(rulesWithEvidence(context).map((r) => r.sources.map((s) => s.node_key))).toEqual([['CL-1'], ['CL-1']]);
  });

  it('keeps optional rules after the required ones and marks them', () => {
    const context = { ...sample(), required_rules: [rule('R-REQ')], optional_rules: [rule('R-OPT', { mandatory: false })], evidence: [] };
    expect(rulesWithEvidence(context).map((r) => [r.rule.rule_id, r.required])).toEqual([['R-REQ', true], ['R-OPT', false]]);
  });

  it('matches a rule by its node key, not its rule id', () => {
    const context = { ...sample(), required_rules: [rule('REC-99', { node_key: 'NODE-99' })], evidence: [source('CL-9', [['NODE-99', 'supported_by', 'CL-9']])] };
    expect(rulesWithEvidence(context)[0].sources.map((s) => s.node_key)).toEqual(['CL-9']);
  });

  it('keeps a rule that has no source text, with an empty list', () => {
    const context = { ...sample(), required_rules: [rule('R-BARE')], evidence: [] };
    expect(rulesWithEvidence(context)).toEqual([{ rule: rule('R-BARE'), required: true, sources: [] }]);
  });
});

describe('unlinkedEvidence', () => {
  it('is empty when every source belongs to a selected rule', () => {
    expect(unlinkedEvidence(sample())).toEqual([]);
  });

  it('returns sources no selected rule reaches, so they are never dropped silently', () => {
    const stray = source('CL-STRAY', [['R-GONE', 'supported_by', 'CL-STRAY']]);
    const context = { ...sample(), required_rules: [rule('R-A')], evidence: [source('CL-1', [['R-A', 'supported_by', 'CL-1']]), stray] };
    expect(unlinkedEvidence(context)).toEqual([stray]);
  });
});

describe('missingContextNote', () => {
  it('explains that only word search was used', () => {
    expect(missingContextNote({ code: 'SEMANTIC_SEARCH_SKIPPED', rule_id: null, detail: null }))
      .toBe('The policy text was searched by words only; the meaning-based search did not run.');
  });

  it('names the rule the gap is about', () => {
    expect(missingContextNote({ code: 'SOURCE_MISSING', rule_id: 'REC-04', detail: null }))
      .toBe('REC-04: the source text for this rule was not found.');
  });

  it('adds the detail the service sent', () => {
    expect(missingContextNote({ code: 'CONFLICT', rule_id: 'REC-02', detail: 'REC-02 and REC-09 disagree for this audience.' }))
      .toBe('REC-02: two rules disagree, so a person has to decide. REC-02 and REC-09 disagree for this audience.');
  });

  it('has its own sentence for every code in the contract', () => {
    const notes = S.MissingContextCode.options.map((code) => missingContextNote({ code, rule_id: null, detail: null }));
    expect(new Set(notes).size).toBe(S.MissingContextCode.options.length);
    expect(notes.every((n) => n.length > 20)).toBe(true);
  });
});

describe('evidencePanel', () => {
  const idle = { isPending: false, error: null, data: undefined };

  it('is loading until the first answer arrives', () => {
    expect(evidencePanel({ ...idle, isPending: true })).toEqual({ kind: 'loading' });
  });

  it('shows the context once it is read', () => {
    const context = sample();
    expect(evidencePanel({ ...idle, data: context })).toEqual({ kind: 'ready', context });
  });

  it('says none was stored when the run has no context', () => {
    expect(evidencePanel({ ...idle, data: null })).toEqual({ kind: 'none' });
  });

  it('treats a service without the evidence endpoint as nothing stored, not as a failure', () => {
    expect(evidencePanel({ ...idle, error: new ApiError(404) })).toEqual({ kind: 'none' });
    expect(evidencePanel({ ...idle, error: new ApiError(501) })).toEqual({ kind: 'none' });
  });

  it('reports any other failure with the reason, so it can be retried', () => {
    expect(evidencePanel({ ...idle, error: new ApiError(503, { code: 'TEMPORARILY_UNAVAILABLE', message: 'Try again in a minute.' }) }))
      .toEqual({ kind: 'failed', message: 'Try again in a minute.' });
  });

  it('never shows an earlier answer in place of a failure', () => {
    expect(evidencePanel({ isPending: false, error: new ApiError(403), data: sample() }).kind).toBe('failed');
  });

  it('gives a plain reason for a failure that is not from the API', () => {
    expect(evidencePanel({ ...idle, error: new Error('boom') })).toEqual({ kind: 'failed', message: 'Try again in a moment.' });
  });
});
