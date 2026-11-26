import { exhaustive } from '@/lib/exhaustive';
import { isApiError } from '@/api/errors';
import type { ContextEvidence, ContextRule, MissingContext, ValidationContext } from '@/api/validations';

/**
 * The policy context of one validation run (NRC-5), arranged for the screen:
 * each rule the run had to use, with the source text that supports it.
 * Evidence only: the result still comes from the run's own checks, and a
 * missing-context entry is never a pass.
 */

export interface RuleEvidence {
  rule: ContextRule;
  /** False for rules the run could use but did not have to. */
  required: boolean;
  /** Source text whose path starts at this rule, in the order the service sent it. */
  sources: ContextEvidence[];
}

/** A path is the rule's node key, then edge and node key pairs down to the source. */
const reachedFrom = (e: ContextEvidence, nodeKey: string): boolean => e.paths.some((path) => path[0] === nodeKey);

/** Required rules first, then optional ones; a source reached by two rules is shown under both. */
export function rulesWithEvidence(context: ValidationContext): RuleEvidence[] {
  const view = (required: boolean) => (rule: ContextRule): RuleEvidence => ({
    rule,
    required,
    sources: context.evidence.filter((e) => reachedFrom(e, rule.node_key)),
  });
  return [...context.required_rules.map(view(true)), ...context.optional_rules.map(view(false))];
}

/** Source text no selected rule reaches. Shown separately so nothing the service sent is dropped. */
export function unlinkedEvidence(context: ValidationContext): ContextEvidence[] {
  const keys = [...context.required_rules, ...context.optional_rules].map((r) => r.node_key);
  return context.evidence.filter((e) => !keys.some((k) => reachedFrom(e, k)));
}

function missingContextWords(code: MissingContext['code']): string {
  switch (code) {
    case 'APPLICABILITY_UNRESOLVED': return 'it could not be settled whether this rule applies here, so it was kept.';
    case 'TRAVERSAL_TRUNCATED': return 'following the links between rules stopped at a limit, so some linked text may be missing.';
    case 'CONFLICT': return 'two rules disagree, so a person has to decide.';
    case 'SOURCE_MISSING': return 'the source text for this rule was not found.';
    case 'SEMANTIC_SEARCH_SKIPPED': return 'the policy text was searched by words only; the meaning-based search did not run.';
    case 'STATEMENTS_TRUNCATED': return 'the text has more statements than can be searched, so only the first ones were.';
    default: return exhaustive(code, 'part of the policy context is missing.');
  }
}

const capitalise = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** One gap in the context, as a sentence: the rule it is about, what happened, and the service's own detail. */
export function missingContextNote(m: MissingContext): string {
  const words = missingContextWords(m.code);
  const lead = m.rule_id ? `${m.rule_id}: ${words}` : capitalise(words);
  return m.detail ? `${lead} ${m.detail}` : lead;
}

/** What the evidence card shows for one run. */
export type EvidencePanel =
  | { kind: 'loading' }
  | { kind: 'none' } //                     the run stored no context
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; context: ValidationContext };

/**
 * From the context query to what the card shows. A service that does not have
 * the evidence endpoint yet (404 or 501) reads as "none stored": the run's
 * result is still valid without it. Any other failure is shown, never hidden
 * behind an earlier answer.
 */
export function evidencePanel(query: { isPending: boolean; error: unknown; data: ValidationContext | null | undefined }): EvidencePanel {
  if (query.error) {
    if (isApiError(query.error) && (query.error.kind === 'not_found' || query.error.kind === 'not_implemented')) return { kind: 'none' };
    return { kind: 'failed', message: isApiError(query.error) ? query.error.message : 'Try again in a moment.' };
  }
  if (query.isPending) return { kind: 'loading' };
  return query.data ? { kind: 'ready', context: query.data } : { kind: 'none' };
}
