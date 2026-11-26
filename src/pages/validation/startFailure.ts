import type { ApiError } from '@/api/errors';

/** What to tell the creator when POST /validations did not start a run. */
export interface StartFailure {
  tone: 'waiting' | 'blocked';
  title: string;
  detail?: string;
}

export function startFailure(e: ApiError): StartFailure {
  // 429 VALIDATION_LIMIT_REACHED: the tenant already has its share of runs queued or running.
  if (e.code === 'VALIDATION_LIMIT_REACHED') {
    return {
      tone: 'waiting',
      title: 'Too many checks are running',
      detail: 'Your organisation has several validations in progress. Wait for one to finish, then validate again.',
    };
  }
  if (e.kind === 'not_implemented') {
    return { tone: 'waiting', title: 'Validation is not available yet', detail: 'The checking service is not connected in this build.' };
  }
  if (e.code === 'VERSION_CONFLICT') {
    return { tone: 'waiting', title: 'The draft changed', detail: 'Reload the draft and validate the latest version.' };
  }
  if (e.kind === 'forbidden') return { tone: 'blocked', title: 'Your role cannot run validation here' };
  return { tone: 'blocked', title: 'Validation could not start', detail: e.retryable ? 'Try again in a moment.' : e.message };
}
