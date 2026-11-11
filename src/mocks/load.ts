import type { MockData } from './types';
import { SIMULATION_BUILD } from '@/config/env';

/**
 * Loads the local, git-ignored dummy data (src/mocks/data.ts) when it exists.
 * import.meta.glob returns an empty map when the file is absent, so a fresh
 * clone still builds; simulation mode then reports the missing file instead.
 */
const modules: Record<string, () => Promise<MockData>> = SIMULATION_BUILD ? import.meta.glob<MockData>('./data.ts') : {};

export const MOCK_DATA_PATH = 'src/mocks/data.ts';

let cached: Promise<MockData | null> | null = null;

export function loadMockData(): Promise<MockData | null> {
  const load = modules['./data.ts'];
  return (cached ??= load ? load() : Promise.resolve(null));
}
