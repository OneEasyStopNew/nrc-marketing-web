// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { configureHttp } from '@/api/http';
import { validationReportFileName } from '@/pages/validation/report';
import { parseValidationRun } from '@/api/validations';
import { useValidationReport, type ReportPreview } from './useValidationReport';

/**
 * The report download against a fake API (MSW): stale-preview refusals, the
 * error notices, the double-click guard, leaving the page mid-request, and the
 * file that is saved. The HTML itself is covered in report.test.ts.
 */

const BASE = 'http://api.test/v1/marketing';
const CREATIVE_ID = 'cccccccc-0000-4000-8000-000000000001';
const STUDY_ID = 'ssssssss-0000-4000-8000-000000000001';
const RUN_ID = 'rrrrrrrr-0000-4000-8000-000000000001';
const OTHER_RUN_ID = 'rrrrrrrr-0000-4000-8000-000000000002';
const ASSET_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 3;

const h = vi.hoisted(() => ({ toast: vi.fn(), mode: { value: 'cognito' } }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast, apiError: vi.fn() }) }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ mode: h.mode.value }),
  useSession: () => ({
    context: {
      tenant: { tenant_id: 'tenant-1', name: 'Synthetic Org' },
      studies: [{ study_id: STUDY_ID, study_title: 'Synthetic study title' }],
    },
  }),
}));

const summary = (patch: Record<string, unknown> = {}) => ({
  validation_run_id: RUN_ID, input_kind: 'text', creative_version: VERSION, state: 'SUCCEEDED', outcome: 'FAIL',
  is_current: true, evaluated_at: '2026-11-12T10:15:42Z', ...patch,
});

const creativeBody = (patch: Record<string, unknown> = {}) => ({
  id: CREATIVE_ID, study_id: STUDY_ID, version: VERSION, original_prompt: 'Synthetic prompt', current_prompt: 'Synthetic prompt',
  caption: null, language: 'en', channel: 'linkedin', post_format: 'single_image',
  study_snapshot_id: 'snap-0001', study_snapshot_version: 2, asset_id: ASSET_ID, created_by: 'user-1',
  created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:30:00Z', validation_runs: [summary()], ...patch,
});

const runBody = (patch: Record<string, unknown> = {}) => ({
  validation_run_id: RUN_ID, input_kind: 'text', creative_version: VERSION, state: 'SUCCEEDED', outcome: 'FAIL', is_current: true,
  evaluated_at: '2026-11-12T10:15:42Z', job_id: 'job-0001', input_hash: 'hash-0001', asset_id: null, study_snapshot_version: 2,
  policy_bundle_version: 'policy-bundle-synthetic-1',
  gates: [{ gate: 'policy', outcome: 'FAIL' }],
  rule_results: [{ rule_id: 'RULE-A', rule_version: 1, mandatory: true, result: 'FAIL', reason: 'Synthetic reason A' }],
  findings: [{
    rule_id: 'RULE-A', rule_version: 1, severity: 'critical', explanation: 'Synthetic finding explanation',
    source: { source_id: 'SRC-1', clause: 'Clause 4.2' }, needs_human_decision: true,
  }],
  coverage_gaps: [{ rule_id: null, reason: 'Synthetic coverage gap reason' }],
  ...patch,
});

const PREVIEW: ReportPreview = { creativeId: CREATIVE_ID, version: VERSION, runId: RUN_ID, asset: { id: ASSET_ID, checksumSha256: null } };

let creativeReads = 0;
let runReads = 0;
const blobs: Blob[] = [];
const fileNames: string[] = [];
const server = setupServer();

/** Same idea as useGeneration.hooks.test.tsx: keep jsdom's AbortSignal out of Node's fetch. */
const fetchHonouringJsdomSignal: typeof fetch = (input, init) => {
  const { signal, ...rest } = init ?? {};
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason));
    fetch(input, rest).then(resolve, reject);
  });
};

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** Answers the two reads the download makes. */
function api(opts: { creative?: () => Response | Promise<Response>; run?: () => Response | Promise<Response> } = {}) {
  server.use(
    mock.get(`${BASE}/creatives/:id`, () => {
      creativeReads += 1;
      return opts.creative ? opts.creative() : HttpResponse.json(creativeBody(), { headers: { ETag: `"${VERSION}"` } });
    }),
    mock.get(`${BASE}/validations/:id`, () => {
      runReads += 1;
      return opts.run ? opts.run() : HttpResponse.json(runBody());
    }),
  );
}
const refuse = (status: number) => () => HttpResponse.json({ code: 'X', message: 'Synthetic server message' }, { status });

function setup(preview: ReportPreview = PREVIEW) {
  return renderHook(() => useValidationReport(preview));
}
const run = (r: ReturnType<typeof setup>) => act(() => r.result.current.download());

const STALE_ARGS = ['The draft changed while the report was prepared', 'waiting', 'Refresh the preview and download the report again.'];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  configureHttp({ baseUrl: BASE, fetch: fetchHonouringJsdomSignal });
});
beforeEach(() => {
  creativeReads = 0;
  runReads = 0;
  blobs.length = 0;
  fileNames.length = 0;
  h.toast.mockReset();
  h.mode.value = 'cognito';
  // jsdom has no object URLs.
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((b: Blob) => { blobs.push(b); return 'blob:synthetic'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { fileNames.push(this.download); });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('useValidationReport', () => {
  it('downloads the current result once and says so', async () => {
    api();
    const r = setup();
    await run(r);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/html;charset=utf-8');
    const text = await readBlob(blobs[0]);
    for (const expected of ['FAIL', 'Synthetic finding explanation', 'Synthetic coverage gap reason', 'Synthetic Org', 'Synthetic study title']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('Historical result');
    expect(fileNames).toEqual([validationReportFileName({
      creative: { id: CREATIVE_ID, version: VERSION, studySnapshotVersion: 2 },
      run: parseValidationRun(runBody()),
    })]);
    expect(h.toast).toHaveBeenCalledOnce();
    expect(h.toast).toHaveBeenCalledWith(`Validation report for version ${VERSION} downloaded`, 'done', 'It is a draft for review, not an approval.');
    expect(r.result.current.downloading).toBe(false);
  });

  it('labels a result that is not current as historical', async () => {
    api({
      creative: () => HttpResponse.json(creativeBody({ validation_runs: [summary({ is_current: false })] })),
      run: () => HttpResponse.json(runBody({ is_current: false })),
    });
    const r = setup();
    await run(r);
    expect(blobs).toHaveLength(1);
    expect(await readBlob(blobs[0])).toContain('Historical result');
    expect(h.toast).toHaveBeenCalledWith(
      `Historical validation report for version ${VERSION} downloaded`, 'waiting',
      'It is not the current result. Validate again for the current version.',
    );
  });

  it('adds the simulation label in a simulation build', async () => {
    h.mode.value = 'simulation';
    api();
    await run(setup());
    expect(await readBlob(blobs[0])).toContain('Simulation: synthetic data');
  });

  describe('refuses when the preview is out of date', () => {
    it('creative version changed: no run is read', async () => {
      api({ creative: () => HttpResponse.json(creativeBody({ version: VERSION + 1 })) });
      await run(setup());
      expect(runReads).toBe(0);
      expect(blobs).toHaveLength(0);
      expect(h.toast).toHaveBeenCalledWith(...STALE_ARGS);
    });

    it('latest run id differs from the preview', async () => {
      api({ creative: () => HttpResponse.json(creativeBody({ validation_runs: [summary({ validation_run_id: OTHER_RUN_ID })] })) });
      await run(setup());
      expect(runReads).toBe(0);
      expect(blobs).toHaveLength(0);
      expect(h.toast).toHaveBeenCalledWith(...STALE_ARGS);
    });

    it('image differs from the preview', async () => {
      api({ creative: () => HttpResponse.json(creativeBody({ asset_id: 'aaaaaaaa-0000-4000-8000-000000000002' })) });
      await run(setup());
      expect(runReads).toBe(0);
      expect(blobs).toHaveLength(0);
      expect(h.toast).toHaveBeenCalledWith(...STALE_ARGS);
    });

    it('creative answers 412', async () => {
      api({ creative: refuse(412) });
      await run(setup());
      expect(blobs).toHaveLength(0);
      expect(h.toast).toHaveBeenCalledWith(...STALE_ARGS);
    });
  });

  it('waits for a run that is still running, without reading it', async () => {
    api({ creative: () => HttpResponse.json(creativeBody({ validation_runs: [summary({ state: 'RUNNING', outcome: null })] })) });
    await run(setup());
    expect(runReads).toBe(0);
    expect(blobs).toHaveLength(0);
    expect(h.toast).toHaveBeenCalledWith('The validation is still running', 'waiting', 'Download the report once it has finished.');
  });

  it('says so when the draft has no validation', async () => {
    api({ creative: () => HttpResponse.json(creativeBody({ validation_runs: [] })) });
    await run(setup({ ...PREVIEW, runId: undefined }));
    expect(runReads).toBe(0);
    expect(blobs).toHaveLength(0);
    expect(h.toast).toHaveBeenCalledWith('There is no validation result to report', 'waiting', 'Validate the draft first.');
  });

  describe('errors', () => {
    it('501 means not built yet', async () => {
      api({ run: refuse(501) });
      await run(setup());
      expect(h.toast).toHaveBeenCalledWith('The validation report is not available yet', 'waiting', 'Validation results are not connected in this build.');
      expect(blobs).toHaveLength(0);
    });

    it.each([403, 404])('%i means not available to this user', async (status) => {
      api({ run: refuse(status) });
      await run(setup());
      expect(h.toast).toHaveBeenCalledWith(
        'This validation result is not available to you', 'blocked',
        'It does not exist, or it is not available to you in this organisation.',
      );
      expect(blobs).toHaveLength(0);
    });

    it('a lost connection asks to try again', async () => {
      api({ run: () => HttpResponse.error() });
      const r = setup();
      await run(r);
      expect(h.toast).toHaveBeenCalledWith('The validation report could not be downloaded', 'blocked', 'Try again in a moment.');
      expect(blobs).toHaveLength(0);
      expect(r.result.current.downloading).toBe(false);
    });

    it('a draft read that times out asks to try again and frees the button', async () => {
      // AbortSignal.timeout is not driven by fake timers, so the timeout is made to have fired already.
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('Synthetic timeout', 'TimeoutError')));
      api();
      const r = setup();
      await run(r);
      expect(h.toast).toHaveBeenCalledWith('The validation report could not be downloaded', 'blocked', 'Try again in a moment.');
      expect(runReads).toBe(0);
      expect(blobs).toHaveLength(0);
      expect(r.result.current.downloading).toBe(false);
      // A second click is not swallowed by a stuck in-flight guard.
      vi.mocked(AbortSignal.timeout).mockRestore();
      await run(r);
      expect(blobs).toHaveLength(1);
    });

    it('an unexpected failure shows a message and does not reject', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new TypeError('Synthetic failure'); });
      api();
      const r = setup();
      let rejected = false;
      try { await run(r); } catch { rejected = true; }
      expect(rejected).toBe(false);
      expect(h.toast).toHaveBeenCalledWith('The validation report could not be downloaded', 'blocked', 'Try again in a moment.');
      expect(r.result.current.downloading).toBe(false);
    });

    it('an unreadable result shows a generic message, never the body', async () => {
      api({ run: () => HttpResponse.json(runBody({ outcome: 'PASS_SECRET_BODY_TEXT' })) });
      await run(setup());
      expect(h.toast).toHaveBeenCalledOnce();
      const [title, tone, detail] = h.toast.mock.calls[0];
      expect(title).toBe('The validation report could not be downloaded');
      expect(tone).toBe('blocked');
      expect(String(detail)).not.toContain('PASS_SECRET_BODY_TEXT');
      expect(blobs).toHaveLength(0);
    });
  });

  it('reads once for a double click', async () => {
    api();
    const r = setup();
    await act(async () => { await Promise.all([r.result.current.download(), r.result.current.download()]); });
    expect(creativeReads).toBe(1);
    expect(blobs).toHaveLength(1);
    expect(h.toast).toHaveBeenCalledOnce();
  });

  it('stays silent when the page is left mid-request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api({ run: async () => { await gate; return HttpResponse.json(runBody()); } });
    const r = setup();
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = r.result.current.download(); });
    await waitFor(() => expect(runReads).toBe(1));
    r.unmount();
    release();
    await pending;
    expect(h.toast).not.toHaveBeenCalled();
    expect(blobs).toHaveLength(0);
    expect(fileNames).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
