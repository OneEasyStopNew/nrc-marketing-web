import { describe, expect, it } from 'vitest';
import type { ValidationRun } from '@/api/validations';
import {
  buildValidationReport,
  escapeHtml,
  html,
  SafeHtml,
  validationReportFileName,
  type ValidationReportInput,
} from './report';

const RUN_ID = '3f2b8c1e-0000-4000-8000-000000000001';
const JOB_ID = '9d9d9d9d-1111-4111-8111-aaaaaaaaaaaa';
const INPUT_HASH = 'hash-should-never-appear-0123456789';
const CHECKSUM = 'abcdef0123456789abcdef0123456789';

// Clearly synthetic fixture values (no real study facts).
function makeRun(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    validation_run_id: RUN_ID,
    input_kind: 'text',
    creative_version: 3,
    state: 'SUCCEEDED',
    outcome: 'FAIL',
    is_current: true,
    evaluated_at: '2026-11-12T10:15:42Z',
    job_id: JOB_ID,
    input_hash: INPUT_HASH,
    asset_id: null,
    study_snapshot_version: 2,
    policy_bundle_version: 'policy-bundle-synthetic-1',
    gates: [
      { gate: 'completeness', outcome: 'PASS' },
      { gate: 'policy', outcome: 'FAIL' },
    ],
    rule_results: [
      { rule_id: 'RULE-A', rule_version: 1, mandatory: true, result: 'FAIL', reason: 'Synthetic reason A' },
      { rule_id: 'RULE-B', rule_version: 2, mandatory: true, result: 'UNABLE_TO_ASSESS', reason: null },
      { rule_id: 'RULE-C', rule_version: 1, mandatory: false, result: 'PASS', reason: 'Synthetic reason C' },
    ],
    findings: [
      {
        rule_id: 'RULE-A',
        rule_version: 1,
        severity: 'critical',
        explanation: 'Synthetic explanation',
        source: { source_id: 'SRC-1', clause: 'Clause 4.2', excerpt: 'Synthetic source excerpt' },
        offending_excerpt: 'Synthetic offending text',
        suggested_correction: 'Synthetic correction',
        needs_human_decision: true,
      },
      {
        rule_id: 'RULE-D',
        rule_version: 5,
        severity: 'minor',
        explanation: 'Second explanation',
        source: { source_id: 'SRC-2', clause: 'Clause 1' },
        needs_human_decision: false,
      },
    ],
    coverage_gaps: [
      { rule_id: 'RULE-B', reason: 'No policy text covers this claim' },
      { rule_id: null, reason: 'General gap' },
    ],
    ...overrides,
  };
}

function makeInput(overrides: Partial<ValidationReportInput> = {}): ValidationReportInput {
  return {
    run: makeRun(),
    creative: { id: 'creative-1', version: 3, studySnapshotVersion: 2 },
    study: { title: 'Synthetic study' },
    tenantName: 'Synthetic Org',
    asset: undefined,
    isCurrent: true,
    simulation: false,
    generatedAt: new Date('2026-11-12T11:00:00Z'),
    ...overrides,
  };
}

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "' onmouseover='x",
].join(' ');

function hostileInput(): ValidationReportInput {
  const base = makeRun();
  const run: ValidationRun = {
    ...base,
    validation_run_id: `${RUN_ID}${HOSTILE}`,
    policy_bundle_version: HOSTILE,
    asset_id: HOSTILE,
    rule_results: [{ rule_id: HOSTILE, rule_version: 1, mandatory: true, result: 'FAIL', reason: HOSTILE }],
    findings: [
      {
        rule_id: HOSTILE,
        rule_version: 1,
        severity: 'major',
        explanation: HOSTILE,
        source: { source_id: HOSTILE, clause: HOSTILE, excerpt: HOSTILE },
        offending_excerpt: HOSTILE,
        suggested_correction: HOSTILE,
        needs_human_decision: true,
      },
    ],
    coverage_gaps: [{ rule_id: HOSTILE, reason: HOSTILE }],
  };
  return makeInput({
    run,
    creative: { id: HOSTILE, version: 3, studySnapshotVersion: 2 },
    study: { title: HOSTILE },
    tenantName: HOSTILE,
    asset: { id: HOSTILE, checksumSha256: HOSTILE },
  });
}

// Real tags only: escaped text never contains a literal `>`, so this sees markup, not data.
const tagsOf = (doc: string): string[] => doc.match(/<[^>]*>/g) ?? [];
const count = (doc: string, needle: string): number => doc.split(needle).length - 1;

describe('escapeHtml', () => {
  it('escapes & < > " and apostrophe', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('html template', () => {
  it('escapes strings and numbers by default', () => {
    expect(html`<p>${'<b>x</b>'} ${7}</p>`.value).toBe('<p>&lt;b&gt;x&lt;/b&gt; 7</p>');
  });

  it('does not double-escape nested SafeHtml, but escapes data inside it', () => {
    const inner = html`<b>${'a&b'}</b>`;
    expect(html`<p>${inner}</p>`.value).toBe('<p><b>a&amp;b</b></p>');
  });

  it('joins arrays and renders null, undefined and false as empty', () => {
    const items = ['x', 'y'].map((v) => html`<li>${v}</li>`);
    expect(html`<ul>${items}</ul>${null}${undefined}${false}`.value).toBe('<ul><li>x</li><li>y</li></ul>');
  });

  it('throws on an object interpolation', () => {
    // @ts-expect-error objects are not valid interpolations; this checks the runtime guard too
    expect(() => html`${{ a: 1 }}`).toThrow(TypeError);
  });

  it('throws on true', () => {
    // @ts-expect-error true is not a valid interpolation
    expect(() => html`${true}`).toThrow(TypeError);
  });

  it('does not treat a lookalike object as SafeHtml', () => {
    // Structurally a SafeHtml, but not one made by `html`.
    expect(() => html`${{ value: '<script>' }}`).toThrow(TypeError);
    expect(new SafeHtml('x')).toBeInstanceOf(SafeHtml);
  });
});

describe('buildValidationReport: structure', () => {
  const doc = buildValidationReport(makeInput());

  it('is a complete document in the requested order', () => {
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<html lang="en">');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<meta name="referrer" content="no-referrer">');
    const order = ['Draft for review', 'Summary', 'Outcome', 'Gates', 'Rule results', 'Findings', 'Coverage gaps'];
    const positions = order.map((s) => doc.indexOf(`>${s}`) >= 0 ? doc.indexOf(`>${s}`) : doc.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('carries the content security policy', () => {
    expect(doc).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">`,
    );
  });

  it('has one style element and no scripts, links, remote resources or src attributes', () => {
    expect(count(doc, '<style')).toBe(1);
    expect(count(doc, '<script')).toBe(0);
    expect(count(doc, '<a ')).toBe(0);
    expect(doc).not.toMatch(/https?:\/\//i);
    expect(doc).not.toContain('src=');
    expect(doc).not.toContain('href=');
  });

  it('uses overflow-wrapping evidence cells and print rules', () => {
    expect(doc).toContain('overflow-wrap: anywhere');
    expect(doc).toContain('white-space: pre-wrap');
    expect(doc).toContain('@media print');
    expect(doc).toContain('break-inside: avoid');
  });

  it('states it is a draft and not an approval', () => {
    expect(doc).toContain('Draft for review');
    expect(doc).toContain('This report records validation evidence. It is not an approval and does not publish anything.');
  });

  it('never says approved or compliant', () => {
    for (const outcome of ['PASS', 'FAIL', 'NEEDS_REVIEW', null] as const) {
      const out = buildValidationReport(makeInput({ run: makeRun({ outcome }) }));
      expect(out).not.toMatch(/\bapproved\b/i);
      expect(out).not.toMatch(/compliant/i);
    }
  });

  it('leaves out prompts, ids of the job, hashes and urls', () => {
    expect(doc).not.toContain(JOB_ID);
    expect(doc).not.toContain(INPUT_HASH);
    expect(doc).not.toMatch(/prompt|caption|token/i);
  });
});

describe('buildValidationReport: content', () => {
  it('shows the summary facts', () => {
    const doc = buildValidationReport(makeInput({ asset: { id: 'asset-9', checksumSha256: CHECKSUM } }));
    expect(doc).toContain('Synthetic Org');
    expect(doc).toContain('Synthetic study · snapshot version 2');
    expect(doc).not.toContain('draft uses snapshot version');
    expect(doc).toContain('policy-bundle-synthetic-1');
    expect(doc).toContain('creative-1 · version 3');
    expect(doc).toContain('asset-9 · reference abcdef012345');
    expect(doc).not.toContain(CHECKSUM);
    expect(doc).toContain(RUN_ID);
    expect(doc).toContain('2026-11-12 10:15 UTC');
    expect(doc).toContain('2026-11-12 11:00 UTC');
  });

  it('flags a snapshot mismatch, a missing study, a missing policy version and no image', () => {
    const doc = buildValidationReport(
      makeInput({
        creative: { id: 'creative-1', version: 3, studySnapshotVersion: 4 },
        study: undefined,
        run: makeRun({ policy_bundle_version: null }),
      }),
    );
    expect(doc).toContain('No longer available · snapshot version 2 (draft uses snapshot version 4)');
    expect(doc).toContain('Not reported');
    expect(doc).toMatch(/Image<\/th><td class="evidence">None</);
  });

  it('shows FAIL with its label and keeps findings and coverage gaps', () => {
    const doc = buildValidationReport(makeInput());
    expect(doc).toContain('<strong>FAIL</strong> Failed');
    expect(doc).toContain('Synthetic explanation');
    expect(doc).toContain('Clause 4.2');
    expect(doc).toContain('Synthetic source excerpt');
    expect(doc).toContain('Synthetic offending text');
    expect(doc).toContain('Synthetic correction');
    expect(doc).toContain('Second explanation');
    expect(doc).toContain('No policy text covers this claim');
    expect(doc).toContain('General');
    expect(doc).toContain('General gap');
  });

  it('shows NEEDS_REVIEW with its label', () => {
    const doc = buildValidationReport(makeInput({ run: makeRun({ outcome: 'NEEDS_REVIEW' }) }));
    expect(doc).toContain('<strong>NEEDS_REVIEW</strong> Needs review');
  });

  it('shows PASS only as passing the assessed checks', () => {
    const doc = buildValidationReport(makeInput({ run: makeRun({ outcome: 'PASS', rule_results: [] }) }));
    expect(doc).toContain('<strong>PASS</strong> Passed the assessed checks');
  });

  it('shows a missing gate as Not assessed, never as a pass', () => {
    const doc = buildValidationReport(makeInput());
    expect(doc).toMatch(/Study facts<\/th><td>Not assessed</);
    expect(doc).toMatch(/Media<\/th><td>Not assessed</);
    expect(doc).toMatch(/Completeness<\/th><td><strong>PASS<\/strong>/);
  });

  it('with no gates at all, every gate is Not assessed', () => {
    const doc = buildValidationReport(makeInput({ run: makeRun({ gates: [] }) }));
    expect(count(doc, '>Not assessed<')).toBe(4);
  });

  it('shows Not finished when the outcome and time are null', () => {
    const doc = buildValidationReport(
      makeInput({ run: makeRun({ outcome: null, evaluated_at: null, state: 'RUNNING' }) }),
    );
    expect(doc).toContain('<strong>Not finished</strong>');
    expect(doc).toContain('Evaluated at</th><td class="evidence">Not finished');
  });

  it('says required checks could not be assessed, with correct plural', () => {
    expect(buildValidationReport(makeInput())).toContain(
      '1 required check could not be assessed. This result does not pass.',
    );
    const two = makeRun({
      rule_results: [
        { rule_id: 'R1', rule_version: 1, mandatory: true, result: 'UNABLE_TO_ASSESS' },
        { rule_id: 'R2', rule_version: 1, mandatory: true, result: 'UNABLE_TO_ASSESS' },
      ],
    });
    expect(buildValidationReport(makeInput({ run: two }))).toContain('2 required checks could not be assessed');
  });

  it('omits that line when no mandatory rule is unassessed', () => {
    const run = makeRun({
      rule_results: [{ rule_id: 'R1', rule_version: 1, mandatory: false, result: 'UNABLE_TO_ASSESS' }],
    });
    expect(buildValidationReport(makeInput({ run }))).not.toContain('could not be assessed');
  });

  it('does not call an empty findings list a pass', () => {
    const doc = buildValidationReport(makeInput({ run: makeRun({ findings: [], coverage_gaps: [] }) }));
    expect(doc).toContain('No findings were reported.');
    expect(doc).toContain('No coverage gaps were reported.');
  });

  it('survives unexpected enum values from the server', () => {
    // JSON.parse returns any, so a server value outside the enums can be modelled without a cast.
    const odd: ValidationRun = JSON.parse(
      JSON.stringify({ ...makeRun(), state: 'constructor', input_kind: 'toString', outcome: 'hasOwnProperty' }),
    );
    expect(() => buildValidationReport(makeInput({ run: odd }))).not.toThrow();
  });
});

describe('buildValidationReport: current versus historical', () => {
  it('shows the historical banner when not current', () => {
    const doc = buildValidationReport(makeInput({ isCurrent: false, run: makeRun({ creative_version: 2 }) }));
    expect(doc).toContain('Historical result');
    expect(doc).toContain('This result is for version 2 of the draft and is no longer current. Validate again for the current version.');
  });

  it('does not show it when current', () => {
    const doc = buildValidationReport(makeInput({ isCurrent: true }));
    expect(doc).not.toContain('Historical result');
    expect(doc).toContain('Current result for this draft version');
  });
});

describe('buildValidationReport: simulation', () => {
  it('labels synthetic data in simulation builds only', () => {
    const label = 'Simulation: synthetic data, not a real validation result.';
    expect(buildValidationReport(makeInput({ simulation: true }))).toContain(label);
    expect(buildValidationReport(makeInput({ simulation: false }))).not.toContain(label);
  });
});

describe('buildValidationReport: escaping', () => {
  const doc = buildValidationReport(hostileInput());

  it('contains no live script or image markup', () => {
    expect(doc).not.toContain('<script');
    expect(doc).not.toContain('<img');
    // The report's own markup has `"><` (for example `class="x"><strong>`), so check the payload's form.
    expect(doc).not.toContain('"><img');
    expect(doc).not.toContain('"><script');
    expect(count(doc, '<style')).toBe(1);
  });

  it('keeps the hostile text only as escaped text', () => {
    expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(doc).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(doc).toContain('&#39; onmouseover=&#39;x');
    // Every real tag is one the report wrote: no event handler or src attribute anywhere.
    for (const tag of tagsOf(doc)) {
      expect(tag).not.toMatch(/\son\w+\s*=/i);
      expect(tag).not.toMatch(/\ssrc\s*=/i);
    }
  });

  it('escapes the hostile text in every field', () => {
    // 6 text fields in the finding, 2 in the rule row, 2 in the gap, and the summary fields.
    expect(count(doc, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBeGreaterThanOrEqual(14);
  });

  it('keeps the title element well formed', () => {
    const title = doc.match(/<title>([^<]*)<\/title>/);
    expect(title).not.toBeNull();
  });
});

describe('validationReportFileName', () => {
  it('builds the expected name', () => {
    expect(validationReportFileName({ creative: makeInput().creative, run: makeRun() })).toBe(
      'nrc-validation-report-creative-1-v3-3f2b8c1e-0000-4000-8000-000000000001.html',
    );
  });

  it('tells runs apart when their ids share a prefix', () => {
    const creative = makeInput().creative;
    const a = validationReportFileName({ creative, run: makeRun({ validation_run_id: 'sim-run-aaaa1111' }) });
    const b = validationReportFileName({ creative, run: makeRun({ validation_run_id: 'sim-run-bbbb2222' }) });
    expect(a).not.toBe(b);
  });

  it('keeps only safe characters', () => {
    const name = validationReportFileName({
      creative: { id: '../../etc/pass wd\\<x>', version: 1, studySnapshotVersion: 1 },
      run: makeRun({ validation_run_id: '..//x y' }),
    });
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name).not.toContain('..');
    expect(name.endsWith('.html')).toBe(true);
  });
});
