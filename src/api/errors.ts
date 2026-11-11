/**
 * Error shape agreed for the Marketing API (demo plan, "Shared API contract"):
 * { code, message, request_id, details, retryable }.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
  details?: unknown;
  retryable?: boolean;
}

/** What the screen should do about a failure, independent of the exact status. */
export type ErrorKind =
  | 'unauthenticated' // 401: sign in again
  | 'forbidden' //       403: this account cannot do this
  | 'not_found' //       404
  | 'conflict' //        409: e.g. idempotency key reused with a different payload
  | 'stale' //           412: a newer version exists
  | 'invalid' //         422: fix the fields
  | 'throttled' //       429: wait and retry
  | 'unavailable' //     502/503/504: temporary
  | 'not_implemented' // 501: in the spec, not built yet
  | 'network' //         no response at all
  | 'server'; //         anything else

export function kindFor(status: number): ErrorKind {
  switch (status) {
    case 0: return 'network';
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 412: return 'stale';
    case 422: return 'invalid';
    case 429: return 'throttled';
    // 405: the path exists for another method only (e.g. GET /creatives before the list ships).
    case 405: case 501: return 'not_implemented';
    case 502: case 503: case 504: return 'unavailable';
    default: return 'server';
  }
}

const FALLBACK: Record<ErrorKind, string> = {
  unauthenticated: 'Your session ended. Sign in again to continue.',
  forbidden: 'Your account cannot do this.',
  not_found: 'This item does not exist or is not available to you.',
  conflict: 'This request conflicts with one already made.',
  stale: 'Someone saved a newer version.',
  invalid: 'Some fields need a fix.',
  throttled: 'Too many requests. Wait a moment and try again.',
  unavailable: 'The Marketing service is temporarily unavailable. Try again in a minute.',
  not_implemented: 'This is not available yet.',
  network: 'Cannot reach NRC Marketing. Check your connection and try again.',
  server: 'Something failed on our side. Nothing you entered was lost.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ErrorKind;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(status: number, body?: Partial<ApiErrorBody>) {
    const kind = kindFor(status);
    super(body?.message || FALLBACK[kind]);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.code = body?.code || kind.toUpperCase();
    this.requestId = body?.request_id;
    this.details = body?.details;
    this.retryable = body?.retryable ?? (kind === 'network' || kind === 'throttled' || kind === 'unavailable');
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/**
 * Field errors from a 422 VALIDATION_FAILED body (details.fields: [{loc, msg}])
 * keyed by the last named segment of `loc` ("body.source.clause" → "clause").
 */
export function fieldMessagesOf(e: unknown): Record<string, string> {
  if (!isApiError(e)) return {};
  const raw = (e.details as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const f of raw as { loc?: unknown[]; msg?: string }[]) {
    const key = [...(f.loc ?? [])].reverse().find((x) => typeof x === 'string') as string | undefined;
    if (key && !out[key]) out[key] = f.msg ?? 'Check this field.';
  }
  return out;
}
