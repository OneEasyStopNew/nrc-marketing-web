import { describe, expect, it } from 'vitest';
import { pollDelay } from './useValidation';

describe('pollDelay', () => {
  it('starts near one second and grows by half each time', () => {
    expect(pollDelay(0, () => 0.5)).toBe(1000);
    expect(pollDelay(1, () => 0.5)).toBe(1500);
    expect(pollDelay(2, () => 0.5)).toBe(2250);
  });

  it('is capped at ten seconds', () => {
    expect(pollDelay(30, () => 0.5)).toBe(10_000);
  });

  it('adds up to 20% jitter either way', () => {
    expect(pollDelay(0, () => 0)).toBe(800);
    expect(pollDelay(0, () => 1)).toBe(1200);
  });
});
