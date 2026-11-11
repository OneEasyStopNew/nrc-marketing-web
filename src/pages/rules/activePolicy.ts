import type { ActivePolicyRule, PolicyInput, PolicySeverity } from '@/api/policies';

/** Filters on the read-only active policy viewer (NRC-20). */
export interface PolicyFilter {
  severity: PolicySeverity | 'any';
  mandatory: 'any' | 'mandatory' | 'optional';
  search: string;
}

export const NO_FILTER: PolicyFilter = { severity: 'any', mandatory: 'any', search: '' };

export const INPUT_LABEL: Record<PolicyInput, string> = { brief: 'Brief', text: 'Caption and text', image: 'Image' };

/** Case-insensitive search over the rule's ID, wording and source; filters never change the wording itself. */
export function filterRules(rules: readonly ActivePolicyRule[], f: PolicyFilter): ActivePolicyRule[] {
  const q = f.search.trim().toLowerCase();
  return rules.filter((r) =>
    (f.severity === 'any' || r.severity === f.severity)
    && (f.mandatory === 'any' || r.mandatory === (f.mandatory === 'mandatory'))
    && (!q || [r.rule_id, r.title, r.requirement, r.source.source_id, r.source.clause, r.source.excerpt ?? '']
      .some((s) => s.toLowerCase().includes(q))));
}

export const isFiltered = (f: PolicyFilter) => f.severity !== 'any' || f.mandatory !== 'any' || f.search.trim() !== '';

/** Unknown inputs from a newer backend show as sent rather than disappearing. */
export const inputsLabel = (inputs: readonly string[]) =>
  inputs.map((i) => INPUT_LABEL[i as PolicyInput] ?? i).join(', ');
