import { isNoActivePolicy, type ActiveRule } from '@/api/policy';
import type { ValidationInputKind } from '@/api/schemas.gen';

/**
 * What the viewer shows. No policy is a setup gap, never a clean result: GET /context reports
 * none (useActivePolicy is then disabled and would stay pending), the endpoint answers 404, or
 * the bundle has no rules.
 */
export type PolicyLoadState = 'loading' | 'setup_required' | 'failed' | 'loaded';

export function policyLoadState(
  q: { isPending: boolean; isError: boolean; error: unknown; data?: { rules: readonly unknown[] } },
  contextHasPolicy: boolean,
): PolicyLoadState {
  if (!contextHasPolicy) return 'setup_required';
  if (q.isPending) return 'loading';
  if (q.isError) return isNoActivePolicy(q.error) ? 'setup_required' : 'failed';
  return q.data && q.data.rules.length > 0 ? 'loaded' : 'setup_required';
}

/**
 * Text of the page's one always-mounted status region. A region created already filled (the
 * old Loading() one) is not announced. Worded differently from the visible titles so e2e text
 * locators stay unambiguous. Empty once loaded: the rule count has its own region in the list.
 */
export const POLICY_STATUS_TEXT: Readonly<Record<PolicyLoadState, string>> = {
  loading: 'Loading the active policy',
  setup_required: 'No approved policy is in force, so posts cannot be validated yet.',
  failed: 'The active policy could not be loaded.',
  loaded: '',
};

export const SEVERITY_FILTERS = ['any', 'critical', 'major', 'minor'] as const;
export const MANDATORY_FILTERS = ['any', 'mandatory', 'optional'] as const;
export type SeverityFilter = (typeof SEVERITY_FILTERS)[number];
export type MandatoryFilter = (typeof MANDATORY_FILTERS)[number];

/** Filters on the read-only active policy viewer (NRC-20). */
export interface PolicyFilter {
  severity: SeverityFilter;
  mandatory: MandatoryFilter;
  search: string;
}

export const NO_FILTER: PolicyFilter = { severity: 'any', mandatory: 'any', search: '' };

// Selector values and URL params are plain strings; these guards narrow them without a cast.
export const isSeverityFilter = (v: unknown): v is SeverityFilter => SEVERITY_FILTERS.some((s) => s === v);
export const isMandatoryFilter = (v: unknown): v is MandatoryFilter => MANDATORY_FILTERS.some((m) => m === v);

export const INPUT_LABEL: Record<ValidationInputKind, string> = { brief: 'Brief', text: 'Caption and text', image: 'Image' };

/**
 * Label for a value from the server, or the value as sent when the table has no own entry.
 * A plain `table[key]` would return inherited members for keys like `constructor`.
 */
export function labelFor(table: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(table, key) ? (table[key] ?? key) : key;
}

/** Case-insensitive search over the rule's ID, wording and source; filters never change the wording itself. */
export function filterRules(rules: readonly ActiveRule[], f: PolicyFilter): ActiveRule[] {
  const q = f.search.trim().toLowerCase();
  return rules.filter(
    (r) =>
      (f.severity === 'any' || r.severity === f.severity) &&
      (f.mandatory === 'any' || r.mandatory === (f.mandatory === 'mandatory')) &&
      (!q ||
        [r.rule_id, r.title, r.requirement, r.source.source_id, r.source.clause, r.source.excerpt ?? ''].some((s) =>
          s.toLowerCase().includes(q),
        )),
  );
}

export const isFiltered = (f: PolicyFilter): boolean => f.severity !== 'any' || f.mandatory !== 'any' || f.search.trim() !== '';

/** Unknown inputs from a newer backend show as sent rather than disappearing. */
export const inputsLabel = (inputs: readonly string[]): string => inputs.map((i) => labelFor(INPUT_LABEL, i)).join(', ');

// Filters live in the URL so a filtered view can be shared and survives going to Manage rules and back.
export const FILTER_PARAM = { search: 'q', severity: 'severity', mandatory: 'mandatory' } as const;

/** Reads the filter from the URL; anything unrecognised falls back to "any". */
export function filterFromParams(params: URLSearchParams): PolicyFilter {
  const severity = params.get(FILTER_PARAM.severity);
  const mandatory = params.get(FILTER_PARAM.mandatory);
  return {
    severity: isSeverityFilter(severity) ? severity : 'any',
    mandatory: isMandatoryFilter(mandatory) ? mandatory : 'any',
    search: params.get(FILTER_PARAM.search) ?? '',
  };
}

/** A copy of `params` with the filter written in; defaults are left out so an unfiltered link stays clean. Other params are kept. */
export function paramsWithFilter(params: URLSearchParams, f: PolicyFilter): URLSearchParams {
  const next = new URLSearchParams(params);
  const put = (key: string, value: string, isDefault: boolean): void => {
    if (isDefault) next.delete(key);
    else next.set(key, value);
  };
  put(FILTER_PARAM.severity, f.severity, f.severity === 'any');
  put(FILTER_PARAM.mandatory, f.mandatory, f.mandatory === 'any');
  put(FILTER_PARAM.search, f.search, f.search === '');
  return next;
}

// Rule administration is for policy administrators only (policy:manage), in the demo and after it.
export const RULE_ADMIN_PATH = '/marketing/rules/manage';
