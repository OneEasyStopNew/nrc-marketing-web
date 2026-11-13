// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Asset } from '@/api/assets';
import type { Creative, GenerationEligibility } from '@/api/creatives';
import type { Job, JobState } from '@/api/jobs';
import { GenerationStep } from './Generation';

/** One render per job state the step shows, plus its status region (JS-82). */

afterEach(cleanup);

// Test fixtures: the step reads only these fields; the rest of each type is irrelevant here.
const CREATIVE = { id: 'sim-cr-0001', version: 3 } as unknown as Creative;
const eligibility = (eligible: boolean): UseQueryResult<GenerationEligibility> =>
  ({
    data: { eligible, message: eligible ? 'Ready to generate.' : 'Validate this version first.' },
    isError: false,
    error: null,
  }) as unknown as UseQueryResult<GenerationEligibility>;
const IMAGE = { width_px: 1080, height_px: 1080, provider: 'higgsfield', model: 'soul' } as unknown as Asset;

const job = (state: JobState, patch: Partial<Job> = {}): Job => ({
  job_id: '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b',
  kind: 'image_generation',
  creative_id: 'sim-cr-0001',
  creative_version: 3,
  state,
  stage: null,
  provider_request_id: null,
  failure_code: null,
  failure_message: null,
  result_asset_id: null,
  created_at: '2026-11-13T09:00:00Z',
  updated_at: '2026-11-13T09:00:01Z',
  completed_at: null,
  ...patch,
});

type Props = ComponentProps<typeof GenerationStep>;
const props = (patch: Partial<Props> = {}): Props => ({
  creative: CREATIVE,
  editing: false,
  canGenerate: true,
  eligibility: eligibility(true),
  job: undefined,
  active: false,
  unsettled: false,
  pollingStopped: false,
  checking: false,
  onCheckAgain: () => undefined,
  starting: false,
  onGenerate: () => undefined,
  image: undefined,
  ...patch,
});

/** The step's own region: first in the step. Astryx buttons add their own (empty) status regions after it. */
const status = () => screen.getAllByRole('status')[0];
/** Visible text, outside the status region that repeats it for screen readers. */
const shown = (text: string | RegExp) => {
  const hits = screen.getAllByText(text).filter((el) => !status().contains(el));
  expect(hits).toHaveLength(1);
  return hits[0];
};
const generateButton = () => screen.getByRole('button', { name: /Generate/ });
/** Astryx marks a disabled button with aria-disabled and keeps it focusable. */
const isOff = (b: HTMLElement) => b.getAttribute('aria-disabled') === 'true';

describe('GenerationStep', () => {
  it('keeps one status region mounted, from before any job until the job is done', () => {
    const { rerender } = render(<GenerationStep {...props()} />);
    const region = status();
    expect(region.textContent).toBe('');
    rerender(<GenerationStep {...props({ job: job('RUNNING', { stage: 'submitting' }), active: true })} />);
    expect(status()).toBe(region);
    expect(region.textContent).toBe('Image generation: Sending the brief to the image service');
    rerender(<GenerationStep {...props({ job: job('SUCCEEDED', { stage: 'stored' }) })} />);
    expect(status()).toBe(region);
    expect(region.textContent).toBe('Image generation: The image is saved');
  });

  it('shows progress by known steps while a job runs, with Generate off', () => {
    render(<GenerationStep {...props({ job: job('WAITING_PROVIDER', { stage: 'waiting_provider' }), active: true })} />);
    expect(screen.getByRole('progressbar', { name: 'Image generation progress' })).toBeTruthy();
    expect(shown('Step 3 of 5')).toBeTruthy();
    expect(isOff(generateButton())).toBe(true);
  });

  it('shows a job being stopped as stopping', () => {
    render(<GenerationStep {...props({ job: job('CANCEL_REQUESTED'), active: true })} />);
    expect(status().textContent).toBe('Image generation: Stopping');
  });

  it('says an unconfirmed job is being confirmed and keeps Generate off', () => {
    render(<GenerationStep {...props({ job: job('UNKNOWN'), unsettled: true })} />);
    expect(shown('The result is being confirmed')).toBeTruthy();
    expect(isOff(generateButton())).toBe(true);
  });

  it('says a person is reviewing the job and keeps Generate off', () => {
    render(<GenerationStep {...props({ job: job('NEEDS_REVIEW'), unsettled: true })} />);
    expect(shown('A person is reviewing this generation')).toBeTruthy();
    expect(isOff(generateButton())).toBe(true);
  });

  it('explains a failure from its code', () => {
    render(
      <GenerationStep
        {...props({ job: job('FAILED', { failure_code: 'PROVIDER_INSUFFICIENT_BALANCE', failure_message: 'raw provider text' }) })}
      />,
    );
    expect(shown('The image could not be generated')).toBeTruthy();
    expect(screen.getByText(/out of credit/)).toBeTruthy();
  });

  it('offers to check again once automatic checking has stopped', () => {
    const onCheckAgain = vi.fn();
    render(<GenerationStep {...props({ job: job('RUNNING'), active: true, pollingStopped: true, onCheckAgain })} />);
    expect(shown('Automatic checking has stopped')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  it('shows a saved image with its provenance and that it still needs final validation', () => {
    render(<GenerationStep {...props({ job: job('SUCCEEDED'), image: IMAGE })} />);
    expect(screen.getByText(/higgsfield \(soul\)/)).toBeTruthy();
    expect(screen.getByText(/still needs its final validation/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate a new image' })).toBeTruthy();
  });

  it('follows the eligibility answer for this version', () => {
    const { rerender } = render(<GenerationStep {...props({ eligibility: eligibility(false) })} />);
    expect(isOff(generateButton())).toBe(true);
    expect(screen.getByText('Validate this version first.')).toBeTruthy();
    rerender(<GenerationStep {...props()} />);
    expect(isOff(generateButton())).toBe(false);
  });
});
