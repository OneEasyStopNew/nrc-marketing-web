import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import type { ExecutionState } from '@/api/validations';
import {
  commandAfterProblem, commandFor, generationSummary, JOB_POLL_MAX_AGE_MS, jobPollDelay, jobPollingExpired, startProblem,
  type PendingCommand, type StartProblem,
} from './useGeneration';

const err = (status: number, code?: string, details?: unknown, retryable?: boolean) =>
  new ApiError(status, code ? { code, message: 'x', details, retryable } : undefined);

describe('startProblem', () => {
  it('keeps the same command after a lost response, so a retry cannot start a second job', () => {
    const p = startProblem(err(0));
    expect(p.sameCommand).toBe(true);
    expect(p.detail).toMatch(/same request/);
  });

  it('keeps the same command for a temporary server failure', () => {
    expect(startProblem(err(503)).sameCommand).toBe(true);
  });

  it('drops the command when the backend refuses it for good', () => {
    expect(startProblem(err(409, 'VALIDATION_NOT_PASSED')).sameCommand).toBe(false);
    expect(startProblem(err(412, 'VERSION_CONFLICT', { current_version: 4 })).sameCommand).toBe(false);
    expect(startProblem(err(403, 'FORBIDDEN')).sameCommand).toBe(false);
  });

  it('tells the active-job limit apart from the daily allowance', () => {
    expect(startProblem(err(429, 'GENERATION_LIMIT_REACHED', { reason: 'ACTIVE_JOB_LIMIT' }, true)).sameCommand).toBe(true);
    expect(startProblem(err(429, 'GENERATION_LIMIT_REACHED', { reason: 'CREDIT_CEILING' }, true)).title).toMatch(/allowance/);
  });

  it('names the eligibility reason', () => {
    expect(startProblem(err(409, 'GENERATION_NOT_ELIGIBLE', { reason: 'STUDY_CLOSED' })).title).toMatch(/recruiting/);
  });

  it('uses the same words whether a refusal comes as a code or as an eligibility reason', () => {
    const same = (code: string, reason: string) => {
      const a = startProblem(err(409, code));
      const b = startProblem(err(409, 'GENERATION_NOT_ELIGIBLE', { reason }));
      expect([a.title, a.detail]).toEqual([b.title, b.detail]);
    };
    same('VALIDATION_NOT_PASSED', 'NOT_VALIDATED');
    same('VERSION_CONFLICT', 'STALE_VERSION');
    same('STUDY_CLOSED', 'STUDY_CLOSED');
  });

  it('keeps the same command while the backend reports the same command in flight', () => {
    expect(startProblem(err(409, 'CONFLICT')).sameCommand).toBe(true);
  });
});

describe('Generate command key', () => {
  const pending: PendingCommand = { body: '{"v":3}', key: 'generate_first' };
  const problem = (sameCommand: boolean): StartProblem => ({ sameCommand, title: 't', detail: 'd' });

  it('reuses the key when the same body is sent again', () => {
    expect(commandFor(pending, '{"v":3}', () => 'generate_new')).toBe(pending);
  });

  it('makes a new key for a new body or when nothing is pending', () => {
    expect(commandFor(pending, '{"v":4}', () => 'generate_new')).toEqual({ body: '{"v":4}', key: 'generate_new' });
    expect(commandFor(null, '{"v":3}', () => 'generate_new')).toEqual({ body: '{"v":3}', key: 'generate_new' });
  });

  it('keeps the key only when trying again must resend the same command', () => {
    expect(commandAfterProblem(pending, problem(true))).toBe(pending);
    expect(commandAfterProblem(pending, problem(false))).toBeNull();
  });
});

describe('job polling bound', () => {
  const created = Date.parse('2026-11-11T10:00:00Z');
  const job = (state: ExecutionState) => ({ state, created_at: new Date(created).toISOString() });
  const before = created + JOB_POLL_MAX_AGE_MS - 1;
  const after = created + JOB_POLL_MAX_AGE_MS;

  it('keeps polling an unfinished job inside the window', () => {
    for (const s of ['QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'CANCEL_REQUESTED', 'UNKNOWN', 'NEEDS_REVIEW'] as const) {
      expect(jobPollDelay(job(s), 0, before)).toBeGreaterThan(0);
      expect(jobPollingExpired(job(s), before)).toBe(false);
    }
  });

  it('polls UNKNOWN and NEEDS_REVIEW slowly', () => {
    expect(jobPollDelay(job('UNKNOWN'), 0, before)).toBe(15_000);
    expect(jobPollDelay(job('NEEDS_REVIEW'), 0, before)).toBe(15_000);
  });

  it('stops polling an unfinished job once it is past the window', () => {
    for (const s of ['QUEUED', 'RUNNING', 'UNKNOWN', 'NEEDS_REVIEW', 'CANCEL_REQUESTED'] as const) {
      expect(jobPollDelay(job(s), 50, after)).toBe(false);
      expect(jobPollingExpired(job(s), after)).toBe(true);
    }
  });

  it('stops on a finished job without calling it expired', () => {
    for (const s of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
      expect(jobPollDelay(job(s), 0, before)).toBe(false);
      expect(jobPollingExpired(job(s), after)).toBe(false);
    }
  });

  it('treats an unreadable created_at as past the window', () => {
    expect(jobPollDelay({ state: 'RUNNING', created_at: 'not a date' }, 0, before)).toBe(false);
  });
});

describe('generationSummary', () => {
  const start = { allowed: true, onClick: () => {}, busy: false };
  const summary = (state: ExecutionState) => generationSummary({ state, creative_version: 3 }, start);

  it('turns Generate off while a job is stopping, unsettled or in review', () => {
    expect(summary('CANCEL_REQUESTED')).toMatchObject({ variant: 'waiting', text: 'Stopping' });
    expect(summary('NEEDS_REVIEW')).toMatchObject({ variant: 'waiting', text: 'Needs review' });
    expect(summary('UNKNOWN')).toMatchObject({ variant: 'waiting', text: 'Being confirmed' });
    for (const s of ['CANCEL_REQUESTED', 'NEEDS_REVIEW', 'UNKNOWN', 'QUEUED', 'RUNNING', 'WAITING_PROVIDER'] as const) {
      expect(summary(s).start).toBeUndefined();
    }
  });

  it('offers Generate again once a job has finished', () => {
    expect(summary('CANCELLED')).toMatchObject({ text: 'Cancelled' });
    for (const s of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) expect(summary(s).start).toBeDefined();
  });

  it('never offers Generate when it is not allowed', () => {
    expect(generationSummary(undefined, { ...start, allowed: false }).start).toBeUndefined();
  });
});
