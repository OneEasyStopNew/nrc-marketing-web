import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { startProblem } from './useGeneration';

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
    expect(startProblem(err(409, 'GENERATION_NOT_ELIGIBLE', { reason: 'STUDY_NOT_RECRUITING' })).title).toMatch(/recruiting/);
  });
});
