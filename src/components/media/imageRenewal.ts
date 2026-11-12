/**
 * What an image preview does when the browser cannot load the picture. The
 * signed link may simply have expired (a laptop woke from sleep, a tab was
 * left open), so the first failure fetches a fresh link once and tries again.
 * A second failure in a row stops and waits for the user's "Try again": it
 * never loops. A successful load restores the one automatic renewal, so a
 * later expiry is handled the same way.
 *
 * - loading:  the current link is being drawn
 * - shown:    the image loaded
 * - renewing: a fresh link is being fetched (the event handler runs the refetch)
 * - failed:   renewal did not help; show an error with "Try again"
 */
export type RenewalPhase = 'loading' | 'shown' | 'renewing' | 'failed';

export interface RenewalState {
  phase: RenewalPhase;
  /** The automatic renewal was spent since the last successful load. */
  autoRenewUsed: boolean;
  /** Bumped for every fresh link, so the image is drawn again even when the link text is the same. */
  attempt: number;
}

export type RenewalEvent =
  | { type: 'loaded' }
  | { type: 'load_failed' }
  | { type: 'renewed' }
  | { type: 'renew_failed' }
  | { type: 'retry' };

export const initialRenewal: RenewalState = { phase: 'loading', autoRenewUsed: false, attempt: 0 };

export function renewalStep(s: RenewalState, e: RenewalEvent): RenewalState {
  switch (e.type) {
    case 'loaded':
      return s.phase === 'loading' || s.phase === 'shown' ? { ...s, phase: 'shown', autoRenewUsed: false } : s;
    case 'load_failed':
      // Late events from an image that is no longer drawn are ignored.
      if (s.phase !== 'loading' && s.phase !== 'shown') return s;
      return s.autoRenewUsed ? { ...s, phase: 'failed' } : { ...s, phase: 'renewing', autoRenewUsed: true };
    case 'renewed':
      return s.phase === 'renewing' ? { ...s, phase: 'loading', attempt: s.attempt + 1 } : s;
    case 'renew_failed':
      return s.phase === 'renewing' ? { ...s, phase: 'failed' } : s;
    case 'retry':
      // A manual retry gets one fresh link; if that fails too, it is "failed" again.
      return s.phase === 'failed' ? { ...s, phase: 'renewing', autoRenewUsed: true } : s;
  }
}
