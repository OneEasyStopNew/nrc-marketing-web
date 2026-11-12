import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, installChunkReload } from './chunkReload';

function preloadError(): Event {
  return new Event('vite:preloadError', { cancelable: true });
}

function fakeStorage(initial: Record<string, string> = {}): {
  map: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('blocked');
  },
};

describe('installChunkReload', () => {
  it('prevents the default, reloads once and records the key', () => {
    const target = new EventTarget();
    const storage = fakeStorage();
    const reload = vi.fn();
    installChunkReload(target, storage, reload);

    const event = preloadError();
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.map.has(CHUNK_RELOAD_KEY)).toBe(true);
  });

  it('does not reload again when the session already reloaded', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installChunkReload(target, fakeStorage({ [CHUNK_RELOAD_KEY]: '1' }), reload);

    target.dispatchEvent(preloadError());

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once even when storage throws', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installChunkReload(target, throwingStorage, reload);

    target.dispatchEvent(preloadError());
    target.dispatchEvent(preloadError());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when storage is null', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installChunkReload(target, null, reload);

    target.dispatchEvent(preloadError());
    target.dispatchEvent(preloadError());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated events', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installChunkReload(target, fakeStorage(), reload);

    const event = new Event('error', { cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
