/**
 * Whitelist-only URL sanitizer. Unknown/malformed inputs fall back to
 * `about:blank`. Used at ViewManager entrypoints (`createTab`, `navigate`)
 * and indirectly protects the persistence replay path (`seedTabs` →
 * `createTab`) from `javascript:` / `data:` / `chrome://` URLs that should
 * never be loaded by the app. Spec §10 requires this belt-and-suspenders
 * guard even when upstream persistence (tab-persistence `SAFE_SCHEME`) and
 * the address-bar (`shared/url.ts normalizeUrlInput`) already filter input.
 *
 * Whitelist is intentionally strict: http, https, file, about. Everything
 * else — including `data:` which the persistence layer previously accepted
 * — resolves to `about:blank`.
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'file:', 'about:'].includes(u.protocol)) return url;
  } catch {
    // Malformed URL strings (e.g. '', 'not a url', 'ht tp://') fall through
    // to about:blank via the bottom-of-function return.
  }
  return 'about:blank';
}
