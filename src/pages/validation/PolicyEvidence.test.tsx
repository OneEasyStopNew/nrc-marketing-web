// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as S from '@/api/schemas.gen';
import type { ValidationContext } from '@/api/validations';
import contextSample from '@/api/__fixtures__/validationContext.nrc5.json';
import { PolicyEvidence } from './PolicyEvidence';

/**
 * The evidence panel on the validation results page (NRC-5): the rules a run
 * was checked against, with their source text. It must never read as a result.
 */

const sample = (patch: Partial<ValidationContext> = {}): ValidationContext => ({ ...S.ValidationContextRead.parse(contextSample), ...patch });
const titles: Record<string, string> = { 'REC-01': 'No safety or effectiveness claims' };
const show = (context: ValidationContext): void => {
  render(<PolicyEvidence context={context} ruleTitle={(id) => titles[id]} />);
};
const ruleRow = (ruleId: string): HTMLElement => {
  const row = screen.getAllByRole('listitem').find((li) => within(li).queryByText(new RegExp(`^${ruleId} v\\d`)));
  if (!row) throw new Error(`No row for ${ruleId}`);
  return row;
};

afterEach(cleanup);

describe('PolicyEvidence', () => {
  it('lists every rule the run was checked against, with its title when the policy still has it', () => {
    show(sample());
    for (const id of ['REC-01', 'REC-02', 'REC-03', 'REC-04', 'REC-05', 'REC-08']) expect(ruleRow(id)).toBeTruthy();
    expect(within(ruleRow('REC-01')).getByText(/No safety or effectiveness claims/)).toBeTruthy();
  });

  it('says how each rule is decided: by the model or by code', () => {
    show(sample());
    expect(within(ruleRow('REC-01')).getByText('Checked by the model')).toBeTruthy();
    expect(within(ruleRow('REC-08')).getByText('Checked by code')).toBeTruthy();
  });

  it('shows the source text of a rule, exactly as stored, when its sources are opened', () => {
    show(sample());
    const row = ruleRow('REC-01');
    fireEvent.click(within(row).getByRole('button', { name: /Source text \(2\)/ }));
    expect(within(row).getByText(contextSample.evidence[0].excerpt)).toBeTruthy();
    expect(within(row).getByText(contextSample.evidence[1].excerpt)).toBeTruthy();
    expect(within(row).getByText(/^Clause FDA-1-ES/)).toBeTruthy();
  });

  it('says a rule has no source text instead of offering an empty list', () => {
    show(sample({ evidence: [] }));
    const row = ruleRow('REC-01');
    expect(within(row).getByText('No source text was stored for this rule.')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /Source text/ })).toBeNull();
  });

  it('labels synthetic rules so they are never taken for the real rulebook', () => {
    show(sample());
    expect(screen.getByText('Synthetic rules')).toBeTruthy();
  });

  it('does not label real rules as synthetic', () => {
    show(sample({ is_synthetic: false }));
    expect(screen.queryByText('Synthetic rules')).toBeNull();
  });

  it('warns that the context is incomplete and that this is not a pass', () => {
    show(sample());
    expect(screen.getByText('The policy context is not complete')).toBeTruthy();
    expect(screen.getByText('The policy text was searched by words only; the meaning-based search did not run.')).toBeTruthy();
  });

  it('shows no warning when nothing is missing', () => {
    show(sample({ missing_context: [] }));
    expect(screen.queryByText('The policy context is not complete')).toBeNull();
  });

  it('names what could not be settled for a rule', () => {
    const context = sample();
    context.required_rules[0] = { ...context.required_rules[0], unresolved: ['audience', 'jurisdiction'] };
    show(context);
    expect(within(ruleRow('REC-01')).getByText('Could not be settled: audience, jurisdiction. The rule was kept.')).toBeTruthy();
  });

  it('marks a rule the run did not have to use as optional', () => {
    const context = sample();
    const [first, ...rest] = context.required_rules;
    show({ ...context, required_rules: rest, optional_rules: [first] });
    expect(within(ruleRow('REC-01')).getByText('Optional')).toBeTruthy();
    expect(within(ruleRow('REC-02')).getByText('Required')).toBeTruthy();
  });

  it('lists a replaced rule with the rule that replaced it', () => {
    show(sample({ superseded: [{ rule_id: 'REC-00', superseded_by: 'REC-01' }] }));
    expect(screen.getByText('REC-00 was replaced by REC-01.')).toBeTruthy();
  });

  it('shows an exception with the rule it belongs to and whether it applies', () => {
    show(sample({
      exceptions: [{
        node_key: 'EX-01', for_rule_id: 'REC-05', applicable: 'unresolved', reasons: ['audience not given'],
        excerpt: '[SYNTHETIC] Healthcare professionals may be told the phase of the study.', path: ['REC-05', 'except_when', 'EX-01'],
      }],
    }));
    expect(screen.getByText(/Exception to REC-05/)).toBeTruthy();
    expect(screen.getByText('Not settled')).toBeTruthy();
    expect(screen.getByText('[SYNTHETIC] Healthcare professionals may be told the phase of the study.')).toBeTruthy();
  });
});
