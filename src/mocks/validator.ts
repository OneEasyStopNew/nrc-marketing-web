import type { Schemas } from '@/api/schemas.gen';
import type { MockRule } from './types';

type S = Schemas;

/**
 * The pretend validator behind simulation mode. It applies the placeholder
 * rules from data.ts to a text and returns what a finished run reports. It
 * exists only so the screens can be built and tested; it proves nothing about
 * real compliance.
 */
export function evaluate(text: string, rules: MockRule[]): Pick<S['ValidationRunRead'], 'outcome' | 'gates' | 'rule_results' | 'findings' | 'coverage_gaps'> {
  const findings: S['Finding'][] = [];
  const ruleResults: S['RuleResult'][] = [];
  const gaps: S['CoverageGap'][] = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  for (const rule of rules) {
    const base = { rule_id: rule.rule_id, rule_version: rule.rule_version, mandatory: rule.mandatory };
    if (rule.check.kind === 'min_words') {
      if (words < rule.check.min_words) {
        ruleResults.push({ ...base, result: 'UNABLE_TO_ASSESS', reason: rule.unassessed_reason ?? null });
        gaps.push({ rule_id: rule.rule_id, reason: rule.unassessed_reason ?? 'Not enough content to assess.' });
      } else {
        ruleResults.push({ ...base, result: 'PASS', reason: null });
      }
      continue;
    }
    const hits = rule.check.phrases.flatMap((p) => findAll(text, p));
    for (const span of hits) {
      findings.push({
        rule_id: rule.rule_id, rule_version: rule.rule_version, severity: rule.severity,
        explanation: rule.explanation, source: rule.source, text_span: span, image_region: null,
        offending_excerpt: [...text].slice(span.start, span.end).join(''),
        suggested_correction: rule.suggested_correction ?? null,
        needs_human_decision: rule.needs_human_decision ?? false,
      });
    }
    ruleResults.push({ ...base, result: hits.length ? 'FAIL' : 'PASS', reason: null });
  }

  const gateOutcome = (gate: S['Gate']): S['Outcome'] | null => {
    const inGate = rules.filter((r) => r.gate === gate);
    if (!inGate.length) return null;
    const results = ruleResults.filter((r) => inGate.some((g) => g.rule_id === r.rule_id));
    const gateFindings = findings.filter((f) => inGate.some((g) => g.rule_id === f.rule_id));
    if (gateFindings.some((f) => f.severity !== 'minor' && results.find((r) => r.rule_id === f.rule_id)?.mandatory)) return 'FAIL';
    if (results.some((r) => r.result === 'UNABLE_TO_ASSESS') || gateFindings.length) return 'NEEDS_REVIEW';
    return 'PASS';
  };
  const gates = (['completeness', 'study_facts', 'policy', 'media'] as const)
    .map((gate) => ({ gate, outcome: gateOutcome(gate) }))
    .filter((g): g is S['GateResult'] => g.outcome !== null);

  const outcome: S['Outcome'] = gates.some((g) => g.outcome === 'FAIL')
    ? 'FAIL'
    : gates.some((g) => g.outcome === 'NEEDS_REVIEW') ? 'NEEDS_REVIEW' : 'PASS';

  return { outcome, gates, rule_results: ruleResults, findings, coverage_gaps: gaps };
}

/** Every case-insensitive occurrence, as code-point offsets (end exclusive). */
function findAll(text: string, phrase: string): S['TextSpan'][] {
  const out: S['TextSpan'][] = [];
  const hay = text.toLowerCase();
  const needle = phrase.toLowerCase();
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const start = [...text.slice(0, i)].length;
    out.push({ start, end: start + [...text.slice(i, i + needle.length)].length });
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}
