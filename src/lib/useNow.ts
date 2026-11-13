import { useEffect, useState } from 'react';

/**
 * The current time for rendering, refreshed by a timer. Components read "now"
 * from here instead of calling Date.now() while rendering, so two renders of
 * the same data agree (StrictMode renders twice) and time-based labels
 * ("overdue", "3 hours ago") move on while the page stays open.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
