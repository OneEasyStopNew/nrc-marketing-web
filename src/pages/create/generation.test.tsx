// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Asset } from '@/api/assets';
import { ApiError } from '@/api/errors';
import type { Job } from '@/api/jobs';
import type { ExecutionState } from '@/api/validations';
import { GenerationStatus } from './generation';
import { JOB_POLL_MAX_AGE_MS, type StartProblem } from './useGeneration';

/** One component render per job state the panel shows, plus its status region. */

afterEach(cleanup);

const NOW = Date.parse('2026-11-12T10:00:00Z');

const job = (state: ExecutionState, createdAgoMs = 60_000): Job => ({
  job_id: '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b', kind: 'image_generation', creative_id: 'sim-cr-0001', creative_version: 3,
  state, stage: null, provider_request_id: null, failure_code: null, failure_message: null, result_asset_id: null,
  created_at: new Date(NOW - createdAgoMs).toISOString(), updated_at: new Date(NOW).toISOString(), completed_at: null,
});

/**
 * The query fields the panel reads. Test fixture: a UseQueryResult has dozens
 * of members the panel never touches, so the partial is cast once, here.
 */
function query<T>(fields: Partial<UseQueryResult<T>>): UseQueryResult<T> {
  const base: Partial<UseQueryResult<T>> = {
    isPending: false, isError: false, isFetching: false, error: null, data: undefined, dataUpdatedAt: NOW, refetch: async () => base as UseQueryResult<T>,
  };
  return { ...base, ...fields } as UseQueryResult<T>;
}
const loaded = (j: Job) => query<Job>({ data: j });
const failed = (e: unknown) => query<Job>({ isError: true, error: e as Error });
const noAsset = query<Asset>({ isPending: true });

function show(jobResult: UseQueryResult<Job> | null, opts: { asset?: UseQueryResult<Asset>; problem?: StartProblem | null; starting?: boolean } = {}) {
  render(<GenerationStatus version={3} job={jobResult} asset={opts.asset ?? noAsset} problem={opts.problem ?? null} starting={opts.starting ?? false} onRetry={() => undefined} />);
}
/** The panel's own region: first in the panel. Astryx buttons add their own (empty) status regions after it. */
const status = () => screen.getAllByRole('status')[0];
/** Visible text, outside the status region that repeats it for screen readers. */
const shown = (text: string) => {
  const hits = screen.getAllByText(text).filter((el) => !status().contains(el));
  expect(hits).toHaveLength(1);
  return hits[0];
};

describe('GenerationStatus', () => {
  it('keeps one status region mounted before any job and while one starts', () => {
    show(null);
    expect(status().textContent).toBe('');
    cleanup();
    show(null, { starting: true });
    expect(status().textContent).toBe('Starting the image generation');
  });

  it('announces a waiting start problem', () => {
    const problem: StartProblem = { sameCommand: true, title: 'No answer from NRC Marketing', detail: 'Try again.' };
    show(null, { problem });
    expect(status().textContent).toBe('No answer from NRC Marketing');
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });

  it('shows a job in review and turns automatic generation off', () => {
    show(loaded(job('NEEDS_REVIEW')));
    expect(shown('A person is reviewing this generation')).toBeTruthy();
    expect(status().textContent).toMatch(/person is reviewing/);
  });

  it('shows a job being stopped', () => {
    show(loaded(job('CANCEL_REQUESTED')));
    expect(shown('Stopping this generation')).toBeTruthy();
    expect(status().textContent).toBe('Image generation: Stopping');
  });

  it('shows an unconfirmed job as being confirmed', () => {
    show(loaded(job('UNKNOWN')));
    expect(shown('Confirming with the image service')).toBeTruthy();
  });

  it('offers to check again once automatic checking has stopped', () => {
    show(loaded(job('RUNNING', JOB_POLL_MAX_AGE_MS + 1)));
    expect(shown('Automatic checking has stopped')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeTruthy();
    expect(status().textContent).toBe('Automatic checking has stopped');
  });

  it.each([[new ApiError(404)], [new ApiError(403)]])('says a job it cannot read is not available (%s)', (e) => {
    show(failed(e));
    expect(shown('This generation is not available')).toBeTruthy();
    expect(status().textContent).toBe('This generation is not available');
  });

  it('offers to check again when the status could not be loaded', () => {
    show(failed(new ApiError(503)));
    expect(shown('The generation status could not be loaded')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeTruthy();
  });

  it('says a saved image could not be shown when its link fails', () => {
    show(loaded(job('SUCCEEDED')), { asset: query<Asset>({ isError: true, error: new ApiError(403) }) });
    expect(shown('The image could not be shown')).toBeTruthy();
    expect(status().textContent).toBe('Image generation: The image is saved');
  });

  it('keeps the same status region while the job moves on', () => {
    const { rerender } = render(<GenerationStatus version={3} job={loaded(job('QUEUED'))} asset={noAsset} problem={null} starting={false} onRetry={() => undefined} />);
    const region = status();
    rerender(<GenerationStatus version={3} job={loaded(job('SUCCEEDED'))} asset={noAsset} problem={null} starting={false} onRetry={() => undefined} />);
    expect(status()).toBe(region);
    expect(region.textContent).toBe('Image generation: The image is saved');
  });
});
