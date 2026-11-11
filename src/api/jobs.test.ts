import { describe, expect, it } from 'vitest';
import { failureText, isJobStage, isJobTerminal, JOB_STAGES, JOB_STEPS, jobProgress, newJobKey } from './jobs';
import type { ExecutionState } from './validations';

describe('job states', () => {
  it('stops polling only on finished states', () => {
    const finished: ExecutionState[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
    const unfinished: ExecutionState[] = ['QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'UNKNOWN', 'NEEDS_REVIEW', 'CANCEL_REQUESTED'];
    expect(finished.every(isJobTerminal)).toBe(true);
    expect(unfinished.some(isJobTerminal)).toBe(false);
  });
});

describe('jobProgress', () => {
  it('follows the backend stages in order', () => {
    const steps = [
      jobProgress({ state: 'QUEUED', stage: null }),
      jobProgress({ state: 'RUNNING', stage: 'submitting' }),
      jobProgress({ state: 'WAITING_PROVIDER', stage: 'waiting_provider' }),
      jobProgress({ state: 'RUNNING', stage: 'fetching_output' }),
      jobProgress({ state: 'SUCCEEDED', stage: 'stored' }),
    ].map((p) => p.step);
    expect(steps).toEqual([0, 1, 2, 3, JOB_STEPS.length - 1]);
  });

  it('never jumps ahead on a stage it does not know', () => {
    expect(jobProgress({ state: 'RUNNING', stage: 'something_new' }).step).toBe(1);
    expect(jobProgress({ state: 'WAITING_PROVIDER', stage: 'something_new' }).step).toBe(2);
  });

  it('shows a retry as still sending, not as progress', () => {
    expect(jobProgress({ state: 'RUNNING', stage: 'retry_wait' }).step).toBe(1);
  });

  it('maps every backend stage to a running step', () => {
    for (const stage of JOB_STAGES) {
      const { step } = jobProgress({ state: 'RUNNING', stage });
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThan(JOB_STEPS.length - 1);
    }
  });

  it('names stopping, cancelled and review apart from progress', () => {
    expect(jobProgress({ state: 'CANCEL_REQUESTED', stage: null }).label).toBe('Stopping');
    expect(jobProgress({ state: 'CANCELLED', stage: null }).label).toBe('Cancelled');
    expect(jobProgress({ state: 'NEEDS_REVIEW', stage: null }).label).toMatch(/person is reviewing/);
    expect(jobProgress({ state: 'UNKNOWN', stage: 'reconcile' }).label).toMatch(/Confirming/);
  });
});

describe('isJobStage', () => {
  it('accepts only the backend JobStage values', () => {
    expect(isJobStage('fetching_output')).toBe(true);
    expect(isJobStage('something_new')).toBe(false);
    expect(isJobStage(null)).toBe(false);
  });
});

describe('failureText', () => {
  it('explains a content refusal and an unknown code', () => {
    expect(failureText('content_rejected')).toMatch(/refused/);
    expect(failureText('SOMETHING_ELSE')).toMatch(/could not be made/);
    expect(failureText(null)).toMatch(/could not be made/);
  });
});

describe('newJobKey', () => {
  it('is new each time and fits the Idempotency-Key format', () => {
    const a = newJobKey();
    expect(a).not.toBe(newJobKey());
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});
