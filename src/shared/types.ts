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

// ── Settings (spec §7) ───────────────────────────────────────────────────────
// Type-only definitions live here so main, preload, and renderer can all import
// them via `@shared/types`. `DEFAULTS` and any runtime constants stay in
// `src/main/settings.ts` (which re-exports these for back-compat).

export interface WindowSettings {
  width: number;            // 393
  height: number;           // 852
  preset: 'iphone14pro' | 'iphonese' | 'pixel7';
  edgeThresholdPx: number;  // 8, 0–50
}

export interface MouseLeaveSettings {
  delayMs: number;          // 100, 0–2000
}

export interface DimSettings {
  effect: 'dark' | 'light' | 'blur' | 'none';
  blurPx: number;           // 0–40
  darkBrightness: number;   // 0–1
  lightBrightness: number;  // 1–3
  transitionMs: number;     // 0–1000
}

export interface EdgeDockSettings {
  enabled: boolean;         // true
  animationMs: number;      // 200, 0 = instant
  triggerStripPx: number;   // 3, 1–10
}

export interface LifecycleSettings {
  restoreTabsOnLaunch: boolean;
}

export interface BrowsingSettings {
  defaultIsMobile: boolean;
  /** iOS Safari UA — sourced from `MOBILE_UA` in src/main/user-agents.ts at DEFAULTS construction. */
  mobileUserAgent: string;
}

export type ThemeChoice = 'system' | 'dark' | 'light';

export interface AppearanceSettings {
  theme: ThemeChoice;
}

/**
 * 一个搜索引擎条目。Builtins 用稳定字符串 id（'google'/'duckduckgo'/'bing'/'baidu'），
 * 自定义条目由 renderer 在 + 时用 nanoid 生成 id。`urlTemplate` 必须含 `{query}` 占位符
 * 才能通过 main 侧 `clampSearch` 校验。`builtin` 字段以 main 侧的 `BUILTIN_SEARCH_ENGINE_IDS`
 * 为权威——外部传入的 builtin 标记会被 clamp 修正。
 */
export interface SearchEngine {
  id: string;
  name: string;
  urlTemplate: string;
  builtin: boolean;
}

/**
 * Search section（spec §3.1）。`engines` 数组前 N 个永远是 builtins（按
 * `BUILTIN_SEARCH_ENGINES` 表的顺序），自定义追加在后。`activeId` 必须存在
 * 于 `engines` 的 id 集合中，否则 main 侧 fallback 到 'google'。
 */
export interface SearchSettings {
  engines: SearchEngine[];
  activeId: string;
}

export interface Settings {
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
  lifecycle: LifecycleSettings;
  browsing: BrowsingSettings;
  appearance: AppearanceSettings;
  search: SearchSettings;
}

/**
 * One-level-deep partial: each top-level section is optional, and *within* a
 * section every field is optional too. Used as the wire type for
 * `settings:update` (IPC contract) and as the input shape of `clampSettings`
 * + `SettingsStore.update`. Lives in `@shared/types` because both the
 * shared IPC contract and the main process consume it — the shared layer
 * mustn't import from `src/main/`.
 */
export type SettingsPatch = {
  window?: Partial<WindowSettings>;
  mouseLeave?: Partial<MouseLeaveSettings>;
  dim?: Partial<DimSettings>;
  edgeDock?: Partial<EdgeDockSettings>;
  lifecycle?: Partial<LifecycleSettings>;
  browsing?: Partial<BrowsingSettings>;
  appearance?: Partial<AppearanceSettings>;
  search?: Partial<SearchSettings>;
};
