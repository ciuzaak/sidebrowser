import Store from 'electron-store';

const SAFE_SCHEME = /^(https?|about|file|data):/i;
const DEBOUNCE_MS = 1000;

/** The persisted shape. Keep it minimal — transient state (title, loading, history flags) is not saved. */
export interface PersistedTab {
  id: string;
  url: string;
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
    const e = entry as { id?: unknown; url?: unknown };
    if (typeof e.id !== 'string' || e.id === '' || typeof e.url !== 'string') continue;
    if (!SAFE_SCHEME.test(e.url)) continue;
    cleaned.push({ id: e.id, url: e.url });
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

/** Factory for the electron-store instance. Isolated for testability. */
export function createTabStore(): Store<StoreSchema> {
  return new Store<StoreSchema>({ name: 'sidebrowser-tabs' });
}
