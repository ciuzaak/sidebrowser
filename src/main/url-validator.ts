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
 *
 * M13 addition: `view-source:` is allowed when the inner URL is one of
 * { http, https, file }. The "View source" context-menu action constructs
 * `view-source:${currentTabUrl}`; without this special case, the outer
 * `view-source:` scheme rejection would silently load `about:blank`.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:']);
const VIEW_SOURCE_INNER_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export function sanitizeUrl(url: string): string {
  if (url.startsWith('view-source:')) {
    const inner = url.slice('view-source:'.length);
    try {
      const u = new URL(inner);
      if (VIEW_SOURCE_INNER_PROTOCOLS.has(u.protocol)) return url;
    } catch {
      // Fall through to about:blank.
    }
    return 'about:blank';
  }
  try {
    const u = new URL(url);
    if (SAFE_PROTOCOLS.has(u.protocol)) return url;
  } catch {
    // Malformed URL strings (e.g. '', 'not a url', 'ht tp://') fall through
    // to about:blank via the bottom-of-function return.
  }
  return 'about:blank';
}
