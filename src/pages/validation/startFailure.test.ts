import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { startFailure } from './startFailure';

/** What the creator is told when "Validate" could not start a run. */
describe('startFailure', () => {
  it('says checks are queued up when the organisation reached its validation limit', () => {
    const e = new ApiError(429, { code: 'VALIDATION_LIMIT_REACHED', message: 'Too many validations are queued or running.', retryable: true });
    expect(startFailure(e)).toEqual({
      tone: 'waiting',
      title: 'Too many checks are running',
      detail: 'Your organisation has several validations in progress. Wait for one to finish, then validate again.',
    });
  });

  it('treats any other throttling as a failure to retry, not as the validation limit', () => {
    const e = new ApiError(429, { code: 'RATE_LIMITED', message: 'Slow down.' });
    expect(startFailure(e)).toEqual({ tone: 'blocked', title: 'Validation could not start', detail: 'Try again in a moment.' });
  });

  it('says validation is not connected when the service answers not implemented', () => {
    expect(startFailure(new ApiError(501))).toMatchObject({ tone: 'waiting', title: 'Validation is not available yet' });
  });

  it('asks to reload when the draft changed since it was loaded', () => {
    const e = new ApiError(409, { code: 'VERSION_CONFLICT', message: 'The creative changed.' });
    expect(startFailure(e)).toMatchObject({ tone: 'waiting', title: 'The draft changed' });
  });

  it('names the role as the reason when the account may not validate', () => {
    expect(startFailure(new ApiError(403))).toEqual({ tone: 'blocked', title: 'Your role cannot run validation here' });
  });

  it('shows the server reason for a failure that retrying will not fix', () => {
    const e = new ApiError(409, { code: 'NO_ACTIVE_POLICY', message: 'This organisation has no active policy.', retryable: false });
    expect(startFailure(e)).toEqual({ tone: 'blocked', title: 'Validation could not start', detail: 'This organisation has no active policy.' });
  });

  it('asks to try again when the service is temporarily unavailable', () => {
    expect(startFailure(new ApiError(503))).toEqual({ tone: 'blocked', title: 'Validation could not start', detail: 'Try again in a moment.' });
  });
});
