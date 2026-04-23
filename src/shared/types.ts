// Shared types used by main, preload, and renderer.

/** Active web view state, mirrored between main (source of truth) and renderer (Zustand). */
export interface Tab {
  /** nanoid; stable across this tab's lifetime (create → close). */
  id: string;
  url: string;
  title: string;
  /** True = mobile UA + viewport behaviour; false = desktop. Per-tab independent (spec §2). */
  isMobile: boolean;
  /** Favicon URL (http(s) or data:) populated by `page-favicon-updated`. null = none received yet. */
  favicon: string | null;
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

/** Main → renderer broadcast of EdgeDock state (§5.1). Drives TopBar fade on hidden. */
export interface WindowState {
  docked: 'left' | 'right' | null;
  hidden: boolean;
  dimmed: boolean;
}

/** Factory for a freshly-created tab. Main owns the nanoid and the URL; everything else defaults. */
export function makeEmptyTab(id: string, url: string, isMobile: boolean = true): Tab {
  return {
    id,
    url,
    title: '',
    isMobile,
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  };
}
