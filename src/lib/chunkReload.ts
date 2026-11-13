// After a deploy the old hashed chunks are gone; reload once so an open tab picks up the new build.
export const CHUNK_RELOAD_KEY = 'nrc.chunkReload.v1';

const PRELOAD_ERROR_EVENT = 'vite:preloadError';

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Reading window.sessionStorage can itself throw (blocked storage, private mode).
export function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function installChunkReload(target: EventTarget, storage: ReloadStorage | null, reload: () => void): void {
  // In-memory guard for when storage is missing or throws, so we still reload only once.
  let reloaded = false;

  target.addEventListener(PRELOAD_ERROR_EVENT, (event) => {
    event.preventDefault();
    if (reloaded) return;

    try {
      // Already reloaded this session: let the error surface instead of looping.
      if (storage?.getItem(CHUNK_RELOAD_KEY)) return;
      storage?.setItem(CHUNK_RELOAD_KEY, '1');
    } catch {
      // Storage may be blocked; fall through and rely on the in-memory flag.
    }

    reloaded = true;
    reload();
  });
}
