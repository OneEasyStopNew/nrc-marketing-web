import { describe, expect, it, vi } from 'vitest';
import { runImageSimulation } from './imageSimulation';

describe('runImageSimulation', () => {
  it('sets the simulation, says so, then refreshes the image', async () => {
    const calls: string[] = [];
    const deps = {
      setMode: vi.fn(() => {
        calls.push('set');
        return Promise.resolve();
      }),
      refreshImage: vi.fn(() => {
        calls.push('refresh');
        return Promise.resolve();
      }),
      toast: vi.fn((title: string) => {
        calls.push(`toast:${title}`);
      }),
    };
    await runImageSimulation(deps, 'expired', 'The image link expired');
    expect(deps.setMode).toHaveBeenCalledWith('expired');
    expect(calls).toEqual(['set', 'toast:The image link expired', 'refresh']);
  });

  it('shows a failure toast instead of rejecting when the simulation call fails', async () => {
    const deps = {
      setMode: vi.fn(() => Promise.reject(new Error('session expired'))),
      refreshImage: vi.fn(() => Promise.resolve()),
      toast: vi.fn(),
    };
    await expect(runImageSimulation(deps, 'expired', 'The image link expired')).resolves.toBeUndefined();
    expect(deps.refreshImage).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith('Could not set the simulation', 'blocked', expect.any(String));
  });

  it('shows the failure toast when refreshing the image fails', async () => {
    const deps = {
      setMode: vi.fn(() => Promise.resolve()),
      refreshImage: vi.fn(() => Promise.reject(new Error('reset'))),
      toast: vi.fn(),
    };
    await expect(runImageSimulation(deps, 'expired', 'Done')).resolves.toBeUndefined();
    expect(deps.toast).toHaveBeenLastCalledWith('Could not set the simulation', 'blocked', expect.any(String));
  });
});
