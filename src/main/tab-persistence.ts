import Store from 'electron-store';

// M8: dropped `data:` from the whitelist to align with the new ViewManager-level
// `sanitizeUrl` guard (src/main/url-validator.ts). A persisted `data:` URL
// could otherwise replay through seedTabs → createTab, where the sanitizer
// would then kick it to about:blank — the net effect is the same, but
// dropping here keeps the two whitelists consistent and avoids logging a
// redundant sanitize hit at replay time.
const SAFE_SCHEME = /^(https?|about|file):/i;
const DEBOUNCE_MS = 1000;

/** The persisted shape. Keep it minimal — transient state (title, loading, history flags) is not saved. */
export interface PersistedTab {
  id: string;
  url: string;
  isMobile: boolean;
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
    const e = entry as { id?: unknown; url?: unknown; isMobile?: unknown };
    if (typeof e.id !== 'string' || e.id === '' || typeof e.url !== 'string') continue;
    if (!SAFE_SCHEME.test(e.url)) continue;
    const isMobile = typeof e.isMobile === 'boolean' ? e.isMobile : true;
    cleaned.push({ id: e.id, url: e.url, isMobile });
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

/** Load persisted tabs from the store; null if none or malformed. */
export function loadPersistedTabs(store: Store<StoreSchema>): PersistedTabs | null {
  try {
    return sanitizePersisted(store.get('tabs'));
  } catch (err) {
    console.error('[sidebrowser] failed to load persisted tabs:', err);
    return null;
  }
}

/**
 * Returns a save function that coalesces rapid writes into one persisted update
 * after DEBOUNCE_MS of quiescence. flush() forces an immediate write (used on quit).
 */
export function createPersistedTabSaver(store: Store<StoreSchema>): {
  save: (snapshot: PersistedTabs) => void;
  flush: () => void;
} {
  let timer: NodeJS.Timeout | null = null;
  let pending: PersistedTabs | null = null;

  const commit = (): void => {
    if (pending) {
      store.set('tabs', pending);
      pending = null;
    }
    timer = null;
  };

  return {
    save(snapshot: PersistedTabs): void {
      pending = snapshot;
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, DEBOUNCE_MS);
    },
    flush(): void {
      if (timer) clearTimeout(timer);
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
