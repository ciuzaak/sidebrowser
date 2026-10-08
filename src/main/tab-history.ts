/**
 * Back/forward history snapshots (M16) — captured when a tab is unloaded,
 * closed (for Ctrl+Shift+T) or persisted, and fed back to
 * `navigationHistory.restore()`. Pure: no Electron import.
 */
import { sanitizeUrl } from './url-validator';

export interface HistoryEntrySnapshot {
  url: string;
  title: string;
  /** Chromium page state (scroll position etc.); dropped when oversized. */
  pageState?: string;
}

export interface HistorySnapshot {
  entries: HistoryEntrySnapshot[];
  /** Index of the active entry within `entries`. */
  index: number;
}

/** At most this many entries are kept per tab (window around the active one). */
export const MAX_HISTORY_ENTRIES = 25;
/** `pageState` blobs larger than this are dropped (the entry itself is kept). */
export const MAX_PAGE_STATE = 64 * 1024;

const isSafeUrl = (url: string): boolean => url !== '' && sanitizeUrl(url) === url;

/**
 * Normalize raw entries into a snapshot: drops entries whose URL the app would
 * refuse to load, caps the list around the active entry, drops oversized
 * page state. Returns null when nothing restorable remains or the active entry
 * itself is unsafe (caller falls back to loading the tab URL).
 */
export function buildHistorySnapshot(
  raw: readonly { url: string; title?: string; pageState?: string }[],
  activeIndex: number,
): HistorySnapshot | null {
  if (activeIndex < 0 || activeIndex >= raw.length) return null;
  if (!isSafeUrl(raw[activeIndex]!.url)) return null;

  const entries: HistoryEntrySnapshot[] = [];
  let index = -1;
  raw.forEach((e, i) => {
    if (!isSafeUrl(e.url)) return;
    if (i === activeIndex) index = entries.length;
    const entry: HistoryEntrySnapshot = { url: e.url, title: e.title ?? '' };
    if (typeof e.pageState === 'string' && e.pageState.length <= MAX_PAGE_STATE) {
      entry.pageState = e.pageState;
    }
    entries.push(entry);
  });

  if (entries.length > MAX_HISTORY_ENTRIES) {
    // Keep mostly back-history: up to 5 forward entries after the active one.
    const forward = Math.min(5, entries.length - 1 - index);
    const end = index + forward + 1;
    const start = Math.max(0, end - MAX_HISTORY_ENTRIES);
    const sliced = entries.slice(start, end);
    return { entries: sliced, index: index - start };
  }
  return { entries, index };
}

/** canGoBack / canGoForward for an unloaded tab, derived from its snapshot. */
export function snapshotNavState(snap: HistorySnapshot | null): { canGoBack: boolean; canGoForward: boolean } {
  if (!snap) return { canGoBack: false, canGoForward: false };
  return { canGoBack: snap.index > 0, canGoForward: snap.index < snap.entries.length - 1 };
}

/** Strip page state (used for the persisted copy when it should stay small). */
export function withoutPageState(snap: HistorySnapshot): HistorySnapshot {
  return { index: snap.index, entries: snap.entries.map(({ url, title }) => ({ url, title })) };
}
