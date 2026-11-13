import { describe, expect, it } from 'vitest';
import { initialRenewal, renewalStep, type RenewalEvent, type RenewalState } from './imageRenewal';

const run = (events: RenewalEvent['type'][], from: RenewalState = initialRenewal) =>
  events.reduce((s, type) => renewalStep(s, { type }), from);

describe('renewalStep', () => {
  it('shows the image when it loads', () => {
    expect(run(['loaded'])).toEqual({ phase: 'shown', autoRenewUsed: false, attempt: 0 });
  });

  it('renews the link once after the first failure and draws the image again', () => {
    expect(run(['load_failed'])).toMatchObject({ phase: 'renewing', autoRenewUsed: true });
    expect(run(['load_failed', 'renewed'])).toEqual({ phase: 'loading', autoRenewUsed: true, attempt: 1 });
    expect(run(['load_failed', 'renewed', 'loaded'])).toEqual({ phase: 'shown', autoRenewUsed: false, attempt: 1 });
  });

  it('stops after a second failure in a row instead of looping', () => {
    const s = run(['load_failed', 'renewed', 'load_failed']);
    expect(s.phase).toBe('failed');
    // Nothing but a manual retry moves it on.
    expect(run(['load_failed', 'loaded', 'renewed', 'renew_failed'], s)).toBe(s);
  });

  it('fails when the fresh link cannot be fetched', () => {
    expect(run(['load_failed', 'renew_failed']).phase).toBe('failed');
  });

  it('lets the user try again, once per click', () => {
    const failed = run(['load_failed', 'renewed', 'load_failed']);
    expect(run(['retry'], failed)).toMatchObject({ phase: 'renewing', autoRenewUsed: true });
    expect(run(['retry', 'renewed', 'loaded'], failed)).toEqual({ phase: 'shown', autoRenewUsed: false, attempt: 2 });
    expect(run(['retry', 'renewed', 'load_failed'], failed).phase).toBe('failed');
  });

  it('handles a later expiry the same way after a successful load', () => {
    const s = run(['load_failed', 'renewed', 'loaded', 'load_failed']);
    expect(s).toMatchObject({ phase: 'renewing', autoRenewUsed: true });
  });

  it('ignores retry unless failed, and stale events while renewing', () => {
    expect(run(['retry'])).toBe(initialRenewal);
    const renewing = run(['load_failed']);
    expect(run(['loaded', 'load_failed', 'retry'], renewing)).toBe(renewing);
  });

  it('never needs more than one automatic renewal however many failures arrive', () => {
    let renewals = 0;
    let s = initialRenewal;
    for (let i = 0; i < 50; i++) {
      s = renewalStep(s, { type: 'load_failed' });
      if (s.phase === 'renewing') {
        renewals++;
        s = renewalStep(s, { type: 'renewed' });
      }
    }
    expect(renewals).toBe(1);
    expect(s.phase).toBe('failed');
  });
});
