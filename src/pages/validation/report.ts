import {
  GATES,
  unassessedMandatory,
  type ExecutionState,
  type Finding,
  type Gate,
  type Outcome,
  type RuleResult,
  type Severity,
  type ValidationInputKind,
  type ValidationRun,
} from '@/api/validations';
import type { components } from '@/api/schema';

/**
 * Downloadable validation evidence report (NRC-30). Pure: input in, one
 * self-contained HTML string out, so it can be tested in node.
 *
 * Deliberately left out: prompts, captions, any URL, job id, input hash and
 * tokens. Nothing from the data is ever rendered as a link, script or
 * attribute; every value goes through `html`, which escapes by default.
 */

type RuleResultValue = components['schemas']['RuleResultValue'];

export interface ValidationReportInput {
  run: ValidationRun;
  creative: { id: string; version: number; studySnapshotVersion: number };
  /** Undefined when the study is no longer available to this user. */
  study: { title: string } | undefined;
  tenantName: string;
  asset: { id: string; checksumSha256: string | null } | undefined;
  /** Computed by the caller: run.is_current && run.creative_version === creative.version. */
  isCurrent: boolean;
  /** True in simulation builds, so the file carries a visible label. */
  simulation: boolean;
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Escaping template

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Markup that is already escaped. Only `html` (and `trusted`, for constants) creates one. */
export class SafeHtml {
  constructor(readonly value: string) {}
}

export type Interpolation = string | number | false | null | undefined | SafeHtml | Interpolation[];

function render(v: Interpolation): string {
  if (v === null || v === undefined || v === false) return '';
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number') return escapeHtml(String(v));
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  // Never echo the value: it may be data that should not end up in a log.
  throw new TypeError('html: unsupported interpolation value');
}

/** Tagged template: every interpolated value is escaped unless it is itself a SafeHtml. */
export function html(strings: TemplateStringsArray, ...values: Interpolation[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}

/** For fixed, developer-written constants only (the stylesheet). Never pass data. */
const trusted = (constant: string): SafeHtml => new SafeHtml(constant);

// ---------------------------------------------------------------------------
// Wording. Lookups are typed with the schema enums so a new value fails typecheck.

const OUTCOME_LABEL: Record<Outcome, string> = {
  PASS: 'Passed the assessed checks',
  FAIL: 'Failed',
  NEEDS_REVIEW: 'Needs review',
};

const RULE_RESULT_LABEL: Record<RuleResultValue, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_APPLICABLE: 'Not applicable',
  UNABLE_TO_ASSESS: 'Unable to assess',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

const GATE_LABEL: Record<Gate, string> = {
  completeness: 'Completeness',
  study_facts: 'Study facts',
  policy: 'Policy',
  media: 'Media',
};

const STATE_LABEL: Record<ExecutionState, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING_PROVIDER: 'Waiting for provider',
  NEEDS_REVIEW: 'Needs review',
  SUCCEEDED: 'Finished',
  FAILED: 'Failed to run',
  CANCEL_REQUESTED: 'Cancel requested',
  CANCELLED: 'Cancelled',
  UNKNOWN: 'Unknown',
};

const INPUT_KIND_LABEL: Record<ValidationInputKind, string> = {
  brief: 'Brief',
  text: 'Text',
  image: 'Image',
};

/**
 * Label for a value the server sent. A plain index would return inherited members
 * ("constructor") for a hostile or unexpected value, so check own keys first.
 */
function label<K extends string>(table: Record<K, string>, key: K): string {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : 'Unknown value';
}

const NOT_FINISHED = 'Not finished';
const NOT_REPORTED = 'Not reported';
const NOT_ASSESSED = 'Not assessed';
const ASSET_REFERENCE_LENGTH = 12;
const FILE_NAME_PART_MAX = 64;

// ---------------------------------------------------------------------------
// Formatting

/** `2026-11-12 10:15 UTC`; an unparseable value is shown as received (escaped later). */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

function describeStudy(input: ValidationReportInput): string {
  const title = input.study ? input.study.title : 'No longer available';
  const base = `${title} · snapshot version ${input.run.study_snapshot_version}`;
  return input.run.study_snapshot_version === input.creative.studySnapshotVersion
    ? base
    : `${base} (draft uses snapshot version ${input.creative.studySnapshotVersion})`;
}

function describeImage(input: ValidationReportInput): string {
  const { asset, run } = input;
  if (!asset) {
    // The run knows which image it checked even when the caller could not load it.
    return run.asset_id ? `${run.asset_id} · reference not available` : 'None';
  }
  const ref = asset.checksumSha256
    ? `reference ${asset.checksumSha256.slice(0, ASSET_REFERENCE_LENGTH)}`
    : 'reference not available';
  return `${asset.id} · ${ref}`;
}

// ---------------------------------------------------------------------------
// Sections

const row = (label: string, value: Interpolation): SafeHtml => html`
<tr><th scope="row">${label}</th><td class="evidence">${value}</td></tr>`;

function banners(input: ValidationReportInput): SafeHtml {
  const { run, isCurrent, simulation } = input;
  return html`
<section class="banner">
<h1>Draft for review</h1>
<p>This report records validation evidence. It is not an approval and does not publish anything.</p>
</section>
${!isCurrent && html`
<section class="banner historical" role="note">
<h2>Historical result</h2>
<p>This result is for version ${run.creative_version} of the draft and is no longer current. Validate again for the current version.</p>
</section>`}
${simulation && html`
<section class="banner simulation" role="note">
<p><strong>Simulation: synthetic data, not a real validation result.</strong></p>
</section>`}`;
}

function summary(input: ValidationReportInput): SafeHtml {
  const { run, creative, isCurrent } = input;
  return html`
<h2>Summary</h2>
<table>
${row('Organisation', input.tenantName)}
${row('Status of this result', isCurrent ? 'Current result for this draft version' : 'Historical result, not current')}
${row('Study', describeStudy(input))}
${row('Policy bundle version', run.policy_bundle_version ?? NOT_REPORTED)}
${row('Draft', `${creative.id} · version ${run.creative_version}`)}
${row('Image', describeImage(input))}
${row('Validation run id', run.validation_run_id)}
${row('Input kind', label(INPUT_KIND_LABEL, run.input_kind))}
${row('Execution state', label(STATE_LABEL, run.state))}
${row('Evaluated at', run.evaluated_at === null ? NOT_FINISHED : formatUtc(run.evaluated_at))}
${row('Report generated at', formatUtc(input.generatedAt.toISOString()))}
</table>`;
}

function outcomeSection(run: ValidationRun): SafeHtml {
  const unassessed = unassessedMandatory(run).length;
  return html`
<h2>Outcome</h2>
<p class="outcome">${run.outcome === null
    ? html`<strong>${NOT_FINISHED}</strong>`
    : html`<strong>${run.outcome}</strong> ${label(OUTCOME_LABEL, run.outcome)}`}</p>
${unassessed > 0 && html`<p class="notice"><strong>${unassessed} required ${unassessed === 1 ? 'check' : 'checks'} could not be assessed. This result does not pass.</strong></p>`}`;
}

function gatesSection(run: ValidationRun): SafeHtml {
  const rows = GATES.map((gate) => {
    const result = run.gates.find((g) => g.gate === gate);
    return html`
<tr><th scope="row">${label(GATE_LABEL, gate)}</th><td>${result ? html`<strong>${result.outcome}</strong> ${label(OUTCOME_LABEL, result.outcome)}` : NOT_ASSESSED}</td></tr>`;
  });
  return html`
<h2>Gates</h2>
<table>
<thead><tr><th scope="col">Gate</th><th scope="col">Result</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function ruleRow(r: RuleResult): SafeHtml {
  return html`
<tr><td class="evidence">${r.rule_id}</td><td>${r.rule_version}</td><td>${yesNo(r.mandatory)}</td><td><strong>${label(RULE_RESULT_LABEL, r.result)}</strong></td><td class="evidence">${r.reason ?? 'No reason given'}</td></tr>`;
}

function rulesSection(run: ValidationRun): SafeHtml {
  if (run.rule_results.length === 0) {
    return html`
<h2>Rule results</h2>
<p>No rule results were reported.</p>`;
  }
  return html`
<h2>Rule results</h2>
<table>
<thead><tr><th scope="col">Rule</th><th scope="col">Version</th><th scope="col">Mandatory</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
<tbody>${run.rule_results.map(ruleRow)}</tbody>
</table>`;
}

function findingBlock(f: Finding, index: number): SafeHtml {
  return html`
<article class="finding">
<h3>Finding ${index + 1}: ${label(SEVERITY_LABEL, f.severity)} severity</h3>
<dl>
<dt>Rule</dt><dd class="evidence">${f.rule_id} · version ${f.rule_version}</dd>
<dt>Explanation</dt><dd class="evidence">${f.explanation}</dd>
<dt>Source</dt><dd class="evidence">${f.source.source_id}</dd>
<dt>Clause</dt><dd class="evidence">${f.source.clause}</dd>
<dt>Source excerpt</dt><dd class="evidence">${f.source.excerpt ?? 'None provided'}</dd>
<dt>Offending excerpt</dt><dd class="evidence">${f.offending_excerpt ?? 'None provided'}</dd>
<dt>Suggested correction</dt><dd class="evidence">${f.suggested_correction ?? 'None provided'}</dd>
<dt>Needs a human decision</dt><dd>${yesNo(f.needs_human_decision)}</dd>
</dl>
</article>`;
}

function findingsSection(run: ValidationRun): SafeHtml {
  return html`
<h2>Findings</h2>
${run.findings.length === 0 ? html`<p>No findings were reported.</p>` : run.findings.map(findingBlock)}`;
}

function gapsSection(run: ValidationRun): SafeHtml {
  return html`
<h2>Coverage gaps</h2>
${run.coverage_gaps.length === 0
    ? html`<p>No coverage gaps were reported.</p>`
    : html`<ul>${run.coverage_gaps.map((g) => html`
<li class="evidence"><strong>${g.rule_id ? `Rule ${g.rule_id}` : 'General'}</strong>: ${g.reason}</li>`)}</ul>`}`;
}

// The stylesheet lives here, not in the app UI: the ticket requires one
// self-contained, printable file, so it cannot depend on the app's styles. The
// repo's "no custom CSS" rule covers the app UI, not this exported document.
const STYLE = trusted(`
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; max-width: 900px; margin: 0 auto; padding: 24px; color: #111; background: #fff; }
h1 { font-size: 1.6rem; margin: 0 0 8px; }
h2 { font-size: 1.2rem; margin: 28px 0 8px; }
h3 { font-size: 1rem; margin: 0 0 8px; }
table { border-collapse: collapse; width: 100%; table-layout: auto; }
th, td { border: 1px solid #555; padding: 6px 8px; text-align: left; vertical-align: top; }
thead th { font-weight: 700; }
.evidence, dd { overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.banner { border: 2px solid #111; padding: 8px 12px; margin: 0 0 12px; }
.historical { border-style: dashed; border-width: 3px; }
.notice { border: 2px solid #111; padding: 8px 12px; }
.outcome { font-size: 1.2rem; }
.finding { border: 1px solid #555; padding: 8px 12px; margin: 0 0 12px; }
dl { margin: 0; }
dt { font-weight: 700; margin-top: 6px; }
dd { margin: 0; }
@media print {
  body { max-width: none; padding: 0; }
  .finding, tr, .banner { break-inside: avoid; page-break-inside: avoid; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
}
`);

export function buildValidationReport(input: ValidationReportInput): string {
  const { run, creative } = input;
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${`NRC validation evidence report (draft for review): ${creative.id} version ${run.creative_version}`}</title>
<style>${STYLE}</style>
</head>
<body>
${banners(input)}
${summary(input)}
${outcomeSection(run)}
${gatesSection(run)}
${rulesSection(run)}
${findingsSection(run)}
${gapsSection(run)}
</body>
</html>
`;
  return doc.value;
}

/** Keeps only [A-Za-z0-9._-]; no path separators, no `..`. */
function safeFilePart(v: string): string {
  return v.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.').slice(0, FILE_NAME_PART_MAX);
}

export function validationReportFileName(input: Pick<ValidationReportInput, 'creative' | 'run'>): string {
  const { creative, run } = input;
  // The whole run id: a prefix is the same for every run when ids share a prefix (simulation `sim-run-…`).
  const runPart = safeFilePart(run.validation_run_id);
  return `nrc-validation-report-${safeFilePart(creative.id)}-v${run.creative_version}-${runPart}.html`;
}
