import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import type { JobState } from '@/api/jobs';
import {
  commandAfterProblem,
  commandFor,
  generationAnnouncement,
  JOB_POLL_MAX_AGE_MS,
  jobPollDelay,
  jobPollingExpired,
  RUNNING_POLL_MAX_MS,
  SLOW_POLL_MS,
  startProblem,
  UNEXPECTED_PROBLEM,
} from './generationRules';

const err = (status: number, code?: string, details?: unknown, retryable?: boolean): ApiError =>
  new ApiError(status, code ? { code, message: 'Server says why.', details, retryable } : undefined);

describe('startProblem', () => {
  it('keeps the same command after a lost answer, so a retry cannot start a second job', () => {
    const p = startProblem(err(0));
    expect(p).toMatchObject({ sameCommand: true, title: 'No answer from NRC Marketing' });
    expect(p.detail).toMatch(/same request/);
  });

  it('keeps the same command when the 202 could not be read', () => {
    expect(startProblem(new ApiError(202, { code: 'CONTRACT_MISMATCH' }, { kind: 'contract' })).sameCommand).toBe(true);
  });

  it('keeps the same command for a temporary server failure and while the command is still in flight', () => {
    expect(startProblem(err(503)).sameCommand).toBe(true);
    expect(startProblem(err(409, 'CONFLICT')).sameCommand).toBe(true);
  });

  it('drops the command and re-reads eligibility when the version may not be generated', () => {
    for (const code of ['GENERATION_NOT_ELIGIBLE', 'VALIDATION_NOT_PASSED', 'VERSION_CONFLICT']) {
      expect(startProblem(err(409, code))).toMatchObject({ sameCommand: false, recheckEligibility: true });
    }
    expect(startProblem(err(409, 'GENERATION_NOT_ELIGIBLE')).detail).toBe('Server says why.');
  });

  it('tells the active-job limit apart from the daily allowance', () => {
    expect(startProblem(err(429, 'GENERATION_LIMIT_REACHED', { reason: 'ACTIVE_JOB_LIMIT' }, true))).toMatchObject({
      sameCommand: true,
      title: /at once|right now/,
    });
    expect(startProblem(err(429, 'GENERATION_LIMIT_REACHED', { reason: 'CREDIT_CEILING' }, true))).toMatchObject({
      sameCommand: false,
      title: /allowance/,
    });
  });

  it('never reads an inherited name or a non-text reason as the active-job limit', () => {
    for (const details of [{ reason: 'constructor' }, { reason: 7 }, 'ACTIVE_JOB_LIMIT', null]) {
      expect(startProblem(err(429, 'GENERATION_LIMIT_REACHED', details, true)).title).toMatch(/allowance/);
    }
  });

  it('names a reused key, a missing permission and a missing service', () => {
    expect(startProblem(err(409, 'IDEMPOTENCY_KEY_REUSED')).sameCommand).toBe(false);
    expect(startProblem(err(403, 'SOMETHING_NEW')).title).toMatch(/role cannot generate/);
    expect(startProblem(err(501)).title).toMatch(/not available yet/);
  });

  it('keeps the key for a failure that is not an API answer', () => {
    expect(UNEXPECTED_PROBLEM.sameCommand).toBe(true);
  });
});

describe('Generate command key', () => {
  let n = 0;
  const makeKey = () => `generate_${++n}`;

  it('reuses the key for the same version and makes a new one for another', () => {
    const first = commandFor(null, 'c1:3', makeKey);
    expect(commandFor(first, 'c1:3', makeKey)).toBe(first);
    expect(commandFor(first, 'c1:4', makeKey).key).not.toBe(first.key);
  });

  it('keeps the key only when the next Generate must resend the same command', () => {
    const cmd = { sig: 'c1:3', key: 'generate_x' };
    expect(commandAfterProblem(cmd, startProblem(err(0)))).toBe(cmd);
    expect(commandAfterProblem(cmd, startProblem(err(409, 'VALIDATION_NOT_PASSED')))).toBeNull();
  });
});

describe('job polling', () => {
  const at = Date.parse('2026-11-13T10:00:00Z');
  const job = (state: JobState, ageMs = 60_000) => ({ state, created_at: new Date(at - ageMs).toISOString() });

  it('polls a running job with backoff capped for the demo pace', () => {
    const d = jobPollDelay(job('RUNNING'), 10, at);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(RUNNING_POLL_MAX_MS);
  });

  it('keeps polling UNKNOWN and NEEDS_REVIEW slowly, because the backend can still settle them', () => {
    expect(jobPollDelay(job('UNKNOWN'), 0, at)).toBe(SLOW_POLL_MS);
    expect(jobPollDelay(job('NEEDS_REVIEW'), 0, at)).toBe(SLOW_POLL_MS);
  });

  it('stops on a finished job without calling it expired', () => {
    expect(jobPollDelay(job('SUCCEEDED', JOB_POLL_MAX_AGE_MS * 2), 0, at)).toBe(false);
    expect(jobPollingExpired(job('SUCCEEDED', JOB_POLL_MAX_AGE_MS * 2), at)).toBe(false);
  });

  it('stops an unfinished job once it is past the window, and treats an unreadable created_at as past it', () => {
    expect(jobPollDelay(job('RUNNING', JOB_POLL_MAX_AGE_MS), 0, at)).toBe(false);
    expect(jobPollingExpired({ state: 'UNKNOWN', created_at: 'not a date' }, at)).toBe(true);
  });
});

describe('generationAnnouncement', () => {
  it('says what is happening, and nothing before there is a job', () => {
    expect(generationAnnouncement({ job: undefined, starting: false, pollingStopped: false })).toBe('');
    expect(generationAnnouncement({ job: undefined, starting: true, pollingStopped: false })).toBe('Starting the image generation');
    expect(generationAnnouncement({ job: { state: 'RUNNING', stage: 'submitting' }, starting: false, pollingStopped: false })).toBe(
      'Image generation: Sending the brief to the image service',
    );
    expect(generationAnnouncement({ job: { state: 'RUNNING', stage: null }, starting: false, pollingStopped: true })).toBe(
      'Automatic checking has stopped',
    );
  });
});
