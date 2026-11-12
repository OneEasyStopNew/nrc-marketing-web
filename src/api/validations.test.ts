import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp } from './http';
import { ApiError } from './errors';
import { parseValidationRun, validationsApi, VALIDATION_READ_TIMEOUT_MS, type ValidationRun } from './validations';

const SECRET_TEXT = 'SECRET-PROMPT-TEXT-12345';

/** A finished run with every kind of entry the screens read. */
const validRun = (): ValidationRun => ({
  validation_run_id: 'sim-run-ab12cd34',
  input_kind: 'text',
  creative_version: 3,
  state: 'SUCCEEDED',
  outcome: 'NEEDS_REVIEW',
  is_current: true,
  evaluated_at: '2026-11-05T10:00:00Z',
  job_id: 'sim-job-ab12cd34',
  input_hash: 'sim-hash-1',
  asset_id: null,
  study_snapshot_version: 2,
  policy_bundle_version: 'sim-bundle-1',
  gates: [
    { gate: 'completeness', outcome: 'NEEDS_REVIEW' },
    { gate: 'policy', outcome: 'FAIL' },
  ],
  rule_results: [
    { rule_id: 'SIM-1', rule_version: 1, mandatory: true, result: 'UNABLE_TO_ASSESS', reason: 'Not enough content.' },
    { rule_id: 'SIM-2', rule_version: 2, mandatory: false, result: 'PASS', reason: null },
    { rule_id: 'SIM-3', rule_version: 1, mandatory: true, result: 'FAIL' },
  ],
  findings: [
    {
      rule_id: 'SIM-3', rule_version: 1, severity: 'major', explanation: 'Placeholder explanation.',
      source: { source_id: 'sim-guideline', clause: 'Sim 1.2', excerpt: '[Placeholder clause text]' },
      text_span: { start: 4, end: 9 }, image_region: null, offending_excerpt: 'cure', suggested_correction: null,
      needs_human_decision: false,
    },
    {
      rule_id: 'SIM-4', rule_version: 1, severity: 'minor', explanation: 'Image issue.',
      source: { source_id: 'sim-guideline', clause: 'Sim 2.1' },
      image_region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      needs_human_decision: true,
    },
  ],
  coverage_gaps: [{ rule_id: 'SIM-1', reason: 'Not enough content to assess.' }, { rule_id: null, reason: 'Service timed out.' }],
});

/** A copy of the valid run with one top-level field replaced or, with undefined, removed. */
const withField = (key: string, value: unknown): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...validRun() };
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy;
};

const withFinding = (patch: Record<string, unknown>): Record<string, unknown> => ({
  ...validRun(),
  findings: [{ ...validRun().findings[0], ...patch }],
});

describe('parseValidationRun', () => {
  it('accepts a complete run unchanged', () => {
    const input = validRun();
    expect(parseValidationRun(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  it('accepts a null outcome and a null evaluated_at (queued or failed run)', () => {
    const run = parseValidationRun({ ...validRun(), state: 'QUEUED', outcome: null, evaluated_at: null, gates: [], rule_results: [], findings: [] });
    expect(run.outcome).toBeNull();
    expect(run.evaluated_at).toBeNull();
  });

  it('accepts a non-UUID run id (simulation ids)', () => {
    expect(parseValidationRun(validRun()).validation_run_id).toBe('sim-run-ab12cd34');
  });

  it.each(['validation_run_id', 'input_kind', 'creative_version', 'state', 'outcome', 'is_current', 'evaluated_at', 'job_id',
    'input_hash', 'asset_id', 'study_snapshot_version', 'policy_bundle_version', 'gates', 'rule_results', 'findings', 'coverage_gaps'])(
    'rejects a run without %s', (key) => {
      expect(() => parseValidationRun(withField(key, undefined))).toThrow(ApiError);
    });

  it.each([
    ['null body', null],
    ['array body', []],
    ['string body', 'nope'],
  ])('rejects a %s', (_name, body) => {
    expect(() => parseValidationRun(body)).toThrow(ApiError);
  });

  it.each([
    ['is_current as a string', 'is_current', 'true'],
    ['validation_run_id as a number', 'validation_run_id', 7],
    ['empty validation_run_id', 'validation_run_id', ' '],
    ['gates as an object', 'gates', {}],
    ['findings with a non-object entry', 'findings', ['x']],
    ['creative_version 0', 'creative_version', 0],
    ['negative creative_version', 'creative_version', -1],
    ['fractional creative_version', 'creative_version', 1.5],
    ['study_snapshot_version 0', 'study_snapshot_version', 0],
    ['evaluated_at not a date', 'evaluated_at', 'yesterday'],
    ['evaluated_at a number', 'evaluated_at', 1730000000],
    ['evaluated_at an impossible date', 'evaluated_at', '2026-13-45T99:00:00Z'],
  ])('rejects %s', (_name, key, value) => {
    expect(() => parseValidationRun(withField(key, value))).toThrow(ApiError);
  });

  it('rejects a rule result with rule_version 0 or a non-boolean mandatory', () => {
    const run = validRun();
    expect(() => parseValidationRun({ ...run, rule_results: [{ ...run.rule_results[0], rule_version: 0 }] })).toThrow(ApiError);
    expect(() => parseValidationRun({ ...run, rule_results: [{ ...run.rule_results[0], mandatory: 'yes' }] })).toThrow(ApiError);
  });

  it('rejects malformed nested findings, spans and regions', () => {
    expect(() => parseValidationRun(withFinding({ source: undefined }))).toThrow(ApiError);
    expect(() => parseValidationRun(withFinding({ needs_human_decision: undefined }))).toThrow(ApiError);
    expect(() => parseValidationRun(withFinding({ text_span: { start: 'a', end: 2 } }))).toThrow(ApiError);
    expect(() => parseValidationRun(withFinding({ text_span: 'x' }))).toThrow(ApiError);
    expect(() => parseValidationRun(withFinding({ image_region: { x: 0, y: 0, width: 1 } }))).toThrow(ApiError);
    expect(() => parseValidationRun(withFinding({ offending_excerpt: 5 }))).toThrow(ApiError);
  });

  it('rejects a coverage gap without a reason', () => {
    expect(() => parseValidationRun({ ...validRun(), coverage_gaps: [{ rule_id: null }] })).toThrow(ApiError);
  });

  it.each([
    ['outcome', withField('outcome', 'APPROVED')],
    ['state', withField('state', 'DONE')],
    ['input_kind', withField('input_kind', 'video')],
    ['gate result outcome', { ...validRun(), gates: [{ gate: 'policy', outcome: 'GREEN' }] }],
    ['gate', { ...validRun(), gates: [{ gate: 'legal', outcome: 'PASS' }] }],
    ['rule result value', { ...validRun(), rule_results: [{ ...validRun().rule_results[0], result: 'MAYBE' }] }],
    ['severity', withFinding({ severity: 'blocker' })],
  ])('rejects an unknown %s instead of showing it', (_name, body) => {
    expect(() => parseValidationRun(body)).toThrow(ApiError);
  });

  it('does not accept inherited property names as enum values', () => {
    expect(() => parseValidationRun(withField('outcome', 'constructor'))).toThrow(ApiError);
    expect(() => parseValidationRun(withField('state', 'toString'))).toThrow(ApiError);
  });

  it('keeps the response body out of the error', () => {
    let caught: unknown;
    try {
      parseValidationRun({ ...validRun(), outcome: SECRET_TEXT, findings: [{ explanation: SECRET_TEXT }] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.message).toBe('The validation result could not be read');
    expect(err.kind).toBe('server');
    expect(err.code).toBe('INVALID_RESPONSE');
    expect(JSON.stringify({ message: err.message, code: err.code, details: err.details, stack: err.stack })).not.toContain(SECRET_TEXT);
  });
});

describe('validationsApi.get', () => {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const stub = (respond: () => Response) => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), signal: init?.signal });
      return respond();
    });
    configureHttp({ baseUrl: 'http://api.test/v1/marketing', fetch: fetchStub as unknown as typeof globalThis.fetch, tokens: null });
    return fetchStub;
  };

  beforeEach(() => { calls.length = 0; });

  it.each(['', '  ', '../x', 'a/b', 'a\\b', 'run..1'])('treats id %j as not found without calling the API', async (id) => {
    const fetchStub = stub(() => jsonResponse(200, validRun()));
    const error = await validationsApi.get(id).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('not_found');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reads a run with a non-UUID id and parses it', async () => {
    stub(() => jsonResponse(200, validRun()));
    await expect(validationsApi.get('sim-run-ab12cd34')).resolves.toEqual(validRun());
    expect(calls[0].url).toBe('http://api.test/v1/marketing/validations/sim-run-ab12cd34');
  });

  it('rejects a body with an unknown outcome', async () => {
    stub(() => jsonResponse(200, { ...validRun(), outcome: 'APPROVED' }));
    await expect(validationsApi.get('sim-run-ab12cd34')).rejects.toBeInstanceOf(ApiError);
  });

  it('sends an abort signal, and the caller can still cancel through it', async () => {
    stub(() => jsonResponse(200, validRun()));
    const controller = new AbortController();
    await validationsApi.get('sim-run-ab12cd34', controller.signal);
    const sent = calls[0].signal;
    expect(sent).toBeInstanceOf(AbortSignal);
    expect(sent?.aborted).toBe(false);
    controller.abort();
    expect(sent?.aborted).toBe(true);
  });

  it('sends a timeout signal when the caller passes none', async () => {
    stub(() => jsonResponse(200, validRun()));
    await validationsApi.get('sim-run-ab12cd34');
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(VALIDATION_READ_TIMEOUT_MS).toBe(15_000);
  });
});
