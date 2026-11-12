// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { configureHttp } from '@/api/http';
import type { Creative } from '@/api/creatives';
import { FindingsToFix } from './revisions';

/**
 * "To fix from the last validation" in the editor: the list a creator works
 * from. A run that can't be read must say so, never look like nothing to fix.
 */

const BASE = 'http://api.test/v1/marketing';
const RUN_ID = 'rrrrrrrr-0000-4000-8000-000000000001';

vi.mock('@/auth/AuthProvider', () => ({ useSession: () => ({ context: { tenant: { tenant_id: 'tenant-1' } } }) }));

const creative: Creative = {
  id: 'cccccccc-0000-4000-8000-000000000001', study_id: 'ssssssss-0000-4000-8000-000000000001', version: 3,
  original_prompt: 'Synthetic prompt', current_prompt: 'Synthetic prompt', caption: null, language: 'en',
  channel: 'facebook', post_format: 'feed_image', study_snapshot_id: 'snap-0001', study_snapshot_version: 2,
  asset_id: null, created_by: 'user-1', created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:30:00Z',
  validation_runs: [{
    validation_run_id: RUN_ID, input_kind: 'brief', creative_version: 3, state: 'SUCCEEDED', outcome: 'FAIL',
    is_current: true, evaluated_at: '2026-11-12T10:15:42Z',
  }],
};

const runBody = (patch: Record<string, unknown> = {}) => ({
  validation_run_id: RUN_ID, input_kind: 'brief', creative_version: 3, state: 'SUCCEEDED', outcome: 'FAIL', is_current: true,
  evaluated_at: '2026-11-12T10:15:42Z', job_id: 'job-0001', input_hash: 'hash-0001', asset_id: null, study_snapshot_version: 2,
  policy_bundle_version: 'policy-bundle-synthetic-1', gates: [{ gate: 'policy', outcome: 'FAIL' }],
  rule_results: [{ rule_id: 'RULE-A', rule_version: 1, mandatory: true, result: 'FAIL', reason: null }],
  findings: [{
    rule_id: 'RULE-A', rule_version: 1, severity: 'critical', explanation: 'Synthetic finding explanation',
    source: { source_id: 'SRC-1', clause: 'Clause 4.2' }, needs_human_decision: true,
  }],
  coverage_gaps: [],
  ...patch,
});

const server = setupServer();

/** Same as useGeneration.hooks.test.tsx: keep jsdom's AbortSignal out of Node's fetch. */
const fetchHonouringJsdomSignal: typeof fetch = (input, init) => {
  const { signal, ...rest } = init ?? {};
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason));
    fetch(input, rest).then(resolve, reject);
  });
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  configureHttp({ baseUrl: BASE, fetch: fetchHonouringJsdomSignal });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function show(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  render(<FindingsToFix creative={creative} editing={false} />, { wrapper });
}

describe('FindingsToFix', () => {
  it('lists the findings of a readable run', async () => {
    server.use(mock.get(`${BASE}/validations/:id`, () => HttpResponse.json(runBody())));
    show();
    expect(await screen.findByText('To fix from the last validation')).toBeTruthy();
    expect(screen.getByText('Synthetic finding explanation')).toBeTruthy();
  });

  it('says the findings could not be loaded when the run is unreadable, instead of showing nothing', async () => {
    server.use(mock.get(`${BASE}/validations/:id`, () => HttpResponse.json(runBody({ outcome: 'SYNTHETIC_UNKNOWN_OUTCOME' }))));
    show();
    expect(await screen.findByText('The findings to fix could not be loaded')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('SYNTHETIC_UNKNOWN_OUTCOME')).toBeNull();
  });
});
