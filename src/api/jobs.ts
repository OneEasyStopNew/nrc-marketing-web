import { http, requestWithMeta } from './http';
import * as S from './schemas.gen';

/**
 * Image generation jobs (D3), per contracts/openapi.json. POST /creative-jobs
 * starts one for a validated version; GET /jobs/{id} is polled until it ends.
 * A job's state says how the work is going; it says nothing about validation
 * or approval of the image it produced.
 */

export type Job = S.JobRead;
export type JobAccepted = S.JobAccepted;

const DONE: readonly Job['state'][] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN', 'NEEDS_REVIEW'];
/** The job will not change any more; stop polling. */
export const isJobDone = (state: Job['state']): boolean => DONE.includes(state);

/** A new key per intended generation; the same key when retrying the same request, so a retry never starts a second one. */
export const newJobKey = (): string => `generate_${crypto.randomUUID().replace(/-/g, '')}`;

export const jobsApi = {
  /** Only from an explicit "Generate image" action, for a version whose brief passed. */
  startImage: async (creativeId: string, creativeVersion: number, idempotencyKey: string): Promise<JobAccepted> =>
    (await requestWithMeta('POST', '/creative-jobs', S.JobAccepted, {
      idempotencyKey,
      body: { creative_id: creativeId, creative_version: creativeVersion, kind: 'image_generation' },
    })).data,

  get: (jobId: string, signal?: AbortSignal): Promise<Job> => http.get(`/jobs/${encodeURIComponent(jobId)}`, S.JobRead, { signal }),
};
