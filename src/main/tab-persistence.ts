import Store from 'electron-store';
import { buildHistorySnapshot, type HistorySnapshot } from './tab-history';
import { storableFavicon } from './history-filter';

// M8: dropped `data:` from the whitelist to align with the new ViewManager-level
// `sanitizeUrl` guard (src/main/url-validator.ts). A persisted `data:` URL
// could otherwise replay through seedTabs → createTab, where the sanitizer
// would then kick it to about:blank — the net effect is the same, but
// dropping here keeps the two whitelists consistent and avoids logging a
// redundant sanitize hit at replay time.
const SAFE_SCHEME = /^(https?|about|file):/i;
const DEBOUNCE_MS = 1000;

/**
 * The persisted shape. Transient state (loading, audio, crash) is not saved.
 * M16 adds `title` + `favicon` (unloaded tabs show them in the drawer before
 * their page exists) and `history` (back/forward survives restarts). Older
 * files without these fields still load.
 */
export interface PersistedTab {
  id: string;
  url: string;
  isMobile: boolean;
  title: string;
  favicon: string | null;
  history: HistorySnapshot | null;
}
export interface PersistedTabs {
  tabs: PersistedTab[];
  activeId: string;
}

interface StoreSchema {
  tabs?: unknown;
}

/**
 * Validate/clean a raw blob from electron-store. Returns null if the payload
 * cannot be salvaged into a well-formed PersistedTabs.
 *
 * Exported for unit testing; no Electron dependencies inside this function.
 */
export function sanitizePersisted(raw: unknown): PersistedTabs | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { tabs?: unknown; activeId?: unknown };
  if (!Array.isArray(obj.tabs)) return null;

  const cleaned: PersistedTab[] = [];
  for (const entry of obj.tabs) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as {
      id?: unknown; url?: unknown; isMobile?: unknown; title?: unknown; favicon?: unknown; history?: unknown;
    };
    if (typeof e.id !== 'string' || e.id === '' || typeof e.url !== 'string') continue;
    if (!SAFE_SCHEME.test(e.url)) continue;
    const isMobile = typeof e.isMobile === 'boolean' ? e.isMobile : true;
    const title = typeof e.title === 'string' ? e.title : '';
    const favicon = typeof e.favicon === 'string' ? storableFavicon(e.favicon) : null;
    cleaned.push({ id: e.id, url: e.url, isMobile, title, favicon, history: sanitizeHistory(e.history) });
  }
  if (cleaned.length === 0) return null;

  const activeId =
    typeof obj.activeId === 'string' &&
    obj.activeId !== '' &&
    cleaned.some((t) => t.id === obj.activeId)
      ? obj.activeId
      : cleaned[0]!.id;

  return { tabs: cleaned, activeId };
}

/** Validate a persisted history blob (M16); null when absent or unusable. */
function sanitizeHistory(raw: unknown): HistorySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as { entries?: unknown; index?: unknown };
  if (!Array.isArray(h.entries) || typeof h.index !== 'number' || !Number.isInteger(h.index)) return null;
  const entries: { url: string; title?: string; pageState?: string }[] = [];
  for (const item of h.entries) {
    if (!item || typeof item !== 'object') return null;
    const x = item as { url?: unknown; title?: unknown; pageState?: unknown };
    if (typeof x.url !== 'string') return null;
    entries.push({
      url: x.url,
      title: typeof x.title === 'string' ? x.title : '',
      ...(typeof x.pageState === 'string' ? { pageState: x.pageState } : {}),
    });
  }
  return buildHistorySnapshot(entries, h.index);
}

/** Load persisted tabs from the store; null if none or malformed. */
export function loadPersistedTabs(store: Store<StoreSchema>): PersistedTabs | null {
  try {
    return sanitizePersisted(store.get('tabs'));
  } catch (err) {
    console.error('[sidebrowser] failed to load persisted tabs:', err);
    return null;
  }
}

/** M16: a burst of updates (e.g. a ticking title) can't postpone the write longer than this. */
const MAX_WAIT_MS = 5000;

/**
 * Returns a scheduler that coalesces rapid saves into one persisted update
 * after DEBOUNCE_MS of quiescence — or MAX_WAIT_MS after the first pending
 * change, whichever comes first. M16: takes a *producer* that is only called
 * when the write actually happens, so serializing every tab's history isn't
 * paid on every tab event. flush() writes immediately (used on quit).
 */
export function createPersistedTabSaver(
  store: Pick<Store<StoreSchema>, 'set'>,
): {
  save: (produce: () => PersistedTabs | null) => void;
  flush: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt: number | null = null;
  let produce: (() => PersistedTabs | null) | null = null;

  const commit = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstPendingAt = null;
    const p = produce;
    produce = null;
    if (!p) return;
    const snapshot = p();
    if (snapshot) store.set('tabs', snapshot);
  };

  return {
    save(next: () => PersistedTabs | null): void {
      produce = next;
      const now = Date.now();
      firstPendingAt ??= now;
      if (timer) clearTimeout(timer);
      const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstPendingAt + MAX_WAIT_MS - now));
      timer = setTimeout(commit, wait);
    },
    flush(): void {
      commit();
    },
  };
}

/**
 * Factory for the electron-store instance. Isolated for testability.
 *
 * M8 error-boundary hardening: try/catch Store construction so a corrupt
 * `sidebrowser-tabs.json` on disk degrades gracefully instead of crashing
 * the main-process bootstrap. On failure we return an in-memory fallback
 * implementing only the `get('tabs')` / `set('tabs', …)` surface that
 * `loadPersistedTabs` and `createPersistedTabSaver` actually use — the next
 * successful session will overwrite the corrupt file via the saver's flush.
 *
 * The cast to `Store<StoreSchema>` is intentional: the fake only ships the
 * two methods we actually call on this instance anywhere in the codebase;
 * electron-store's broader API surface is unused.
 */
export function createTabStore(): Store<StoreSchema> {
  try {
    return new Store<StoreSchema>({ name: 'sidebrowser-tabs' });
  } catch (err) {
    console.error(
      '[sidebrowser] tab store construction failed; persistence disabled for this session',
      err,
    );
    return createFallbackTabStore();
  }
}

/**
 * In-memory no-op store used when electron-store construction throws.
 * Only `get('tabs')` and `set('tabs', …)` are ever called against the
 * returned instance (see `loadPersistedTabs` + `createPersistedTabSaver`);
 * the cast papers over the unused rest of the Store surface.
 */
function createFallbackTabStore(): Store<StoreSchema> {
  const memory: { tabs?: unknown } = {};
  const fake = {
    get: (key: 'tabs') => memory[key],
    set: (key: 'tabs', value: unknown): void => {
      memory[key] = value;
    },
  };
  return fake as unknown as Store<StoreSchema>;
}
