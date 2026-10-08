/** History recording filters (M16). */

/** Data-URI favicons above this length are not stored in history. */
export const MAX_DATA_FAVICON = 16_384;

/**
 * True when `next` differs from `prev` only by its fragment (or not at all).
 * SPA in-page navigations that change path/query are recorded; `#section`
 * jumps are not.
 */
export function isFragmentOnlyChange(prev: string, next: string): boolean {
  try {
    const a = new URL(prev);
    const b = new URL(next);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

/** Favicon value to store, or null to keep the store free of huge data URIs. */
export function storableFavicon(favicon: string | null): string | null {
  if (favicon === null) return null;
  if (favicon.startsWith('data:') && favicon.length > MAX_DATA_FAVICON) return null;
  return favicon;
}
