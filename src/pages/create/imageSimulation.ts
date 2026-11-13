import type { ToastKind } from '@/components/ui/Toast';

export interface ImageSimulationDeps {
  /** Tells the fake API how to answer the next image request. */
  setMode: (mode: string) => Promise<void>;
  /** Asks for the image again so the new answer shows. */
  refreshImage: () => Promise<void>;
  toast: (title: string, kind: ToastKind, body?: string) => void;
}

/**
 * Simulation only: one of the final preview's simulation tools. The buttons call it with `void`, so it
 * never rejects; a failure (session expired, mock reset during a rehearsal) is shown as a toast.
 */
export async function runImageSimulation(deps: ImageSimulationDeps, mode: string, done: string): Promise<void> {
  try {
    await deps.setMode(mode);
    deps.toast(done, 'waiting');
    await deps.refreshImage();
  } catch {
    deps.toast('Could not set the simulation', 'blocked', 'Sign in again or reload the page, then try once more.');
  }
}
