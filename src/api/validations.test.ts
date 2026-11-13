import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp } from './http';
import { ApiError } from './errors';
import { validationsApi, VALIDATION_READ_TIMEOUT_MS, type ValidationRun } from './validations';

/**
 * What NRC-30 adds to the run read: the id check before the path is built and
 * the timeout. The body itself is checked by main's `S.ValidationRunRead`.
 */

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
  policy_bundle_version: 1,
  gates: [
    { gate: 'completeness', outcome: 'NEEDS_REVIEW' },
    { gate: 'policy', outcome: 'FAIL' },
  ],
  rule_results: [
    { rule_id: 'SIM-1', rule_version: 1, mandatory: true, result: 'UNABLE_TO_ASSESS', reason: 'Not enough content.' },
    { rule_id: 'SIM-3', rule_version: 1, mandatory: true, result: 'FAIL', reason: null },
  ],
  findings: [
    {
      rule_id: 'SIM-3',
      rule_version: 1,
      severity: 'major',
      explanation: 'Placeholder explanation.',
      source: { source_id: 'sim-guideline', clause: 'Sim 1.2', excerpt: '[Placeholder clause text]' },
      text_span: { start: 4, end: 9 },
      image_region: null,
      offending_excerpt: 'cure',
      suggested_correction: null,
      needs_human_decision: false,
    },
  ],
  coverage_gaps: [{ rule_id: null, reason: 'Service timed out.' }],
});

describe('validationsApi.get', () => {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const stub = (respond: () => Response): ReturnType<typeof vi.fn> => {
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), signal: init?.signal });
      return Promise.resolve(respond());
    });
    configureHttp({ baseUrl: 'http://api.test/v1/marketing', fetch: fetchStub, tokens: null });
    return fetchStub;
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it.each(['', '  ', '../x', 'a/b', 'a\\b', 'run..1'])('treats id %j as not found without calling the API', async (id) => {
    const fetchStub = stub(() => jsonResponse(200, validRun()));
    const error: unknown = await validationsApi.get(id).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error instanceof ApiError && error.kind).toBe('not_found');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reads a run with a non-UUID id (the seeded simulation run)', async () => {
    stub(() => jsonResponse(200, validRun()));
    await expect(validationsApi.get('sim-run-ab12cd34')).resolves.toEqual(validRun());
    expect(calls[0].url).toBe('http://api.test/v1/marketing/validations/sim-run-ab12cd34');
  });

  it('rejects a body with an outcome the contract does not list, without echoing the body', async () => {
    stub(() => jsonResponse(200, { ...validRun(), outcome: 'APPROVED', findings: [{ explanation: SECRET_TEXT }] }));
    const error: unknown = await validationsApi.get('sim-run-ab12cd34').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error instanceof ApiError ? error.message : '').not.toContain(SECRET_TEXT);
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
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    stub(() => jsonResponse(200, validRun()));
    await validationsApi.get('sim-run-ab12cd34');
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(VALIDATION_READ_TIMEOUT_MS);
    timeout.mockRestore();
  });
});
