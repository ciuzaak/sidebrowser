// Shared types used by main, preload, and renderer.

/** Active web view state, mirrored between main (source of truth) and renderer (Zustand). */
export interface Tab {
  /** For M1 always the constant "main" (single-tab). M2 switches to nanoid-generated per-tab IDs. */
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Initial empty state used before the first navigation. */
export const INITIAL_TAB: Tab = {
  id: 'main',
  url: 'about:blank',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};
