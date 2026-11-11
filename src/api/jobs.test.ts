import { describe, expect, it } from 'vitest';
import { failureText, isJobOutcomeUnknown, isJobTerminal, JOB_STEPS, jobProgress, newJobKey } from './jobs';

describe('job states', () => {
  it('stops polling only on finished states', () => {
    expect(['SUCCEEDED', 'FAILED', 'CANCELLED'].every((s) => isJobTerminal(s as never))).toBe(true);
    expect(['QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'UNKNOWN', 'NEEDS_REVIEW'].some((s) => isJobTerminal(s as never))).toBe(false);
  });

  it('treats UNKNOWN as unsettled, not finished', () => {
    expect(isJobOutcomeUnknown('UNKNOWN')).toBe(true);
    expect(isJobOutcomeUnknown('FAILED')).toBe(false);
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
  });

  it('shows a retry as still sending, not as progress', () => {
    expect(jobProgress({ state: 'RUNNING', stage: 'retry_wait' }).step).toBe(1);
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
