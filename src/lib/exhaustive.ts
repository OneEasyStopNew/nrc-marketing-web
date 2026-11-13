/**
 * The `default` of a switch over a union (JS-11). The `never` parameter makes
 * the compiler fail when a new member (say a save state 'offline') is added
 * without a case. At runtime, a value the types did not foresee falls back to
 * `fallback` instead of rendering nothing.
 */
export function exhaustive<T>(value: never, fallback: T): T {
  void value;
  return fallback;
}
