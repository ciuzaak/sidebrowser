/** Pure label helpers for the chrome (M17). No React / DOM. */

export const PILL_PLACEHOLDER = 'Search or enter URL';

function isBlank(url: string): boolean {
  return url === '' || url === 'about:blank';
}

/** Address-pill text: host for real URLs, placeholder for blank. */
export function pillLabelFor(url: string): string {
  if (isBlank(url)) return PILL_PLACEHOLDER;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export type SchemeIcon = 'search' | 'lock' | 'globe';

export function schemeIconFor(url: string): SchemeIcon {
  if (isBlank(url)) return 'search';
  return url.toLowerCase().startsWith('https:') ? 'lock' : 'globe';
}

/** Tabs-button badge text; null hides the badge. */
export function formatTabCount(n: number): string | null {
  if (n < 2) return null;
  return n > 99 ? '99+' : String(n);
}

/** TabDrawer row label. */
export function tabLabel(tab: { url: string; title: string }): string {
  if (isBlank(tab.url)) return 'New Tab';
  return tab.title.trim() || tab.url || 'Loading…';
}
