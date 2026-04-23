// Shared types used by main, preload, and renderer.

/** Active web view state, mirrored between main (source of truth) and renderer (Zustand). */
export interface Tab {
  /** nanoid; stable across this tab's lifetime (create → close). */
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * Full tabs snapshot broadcast on create/close/activate events.
 * Individual field changes (url/title/loading) go via tab:updated to avoid
 * re-serialising the whole list on every page title ping.
 */
export interface TabsSnapshot {
  tabs: Tab[];
  /** null only if the list is empty mid-transition — renderer ensures at least one active tab. */
  activeId: string | null;
}

/** Factory for a freshly-created tab. Main owns the nanoid and the URL; everything else defaults. */
export function makeEmptyTab(id: string, url: string): Tab {
  return {
    id,
    url,
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  };
}
