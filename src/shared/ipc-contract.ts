// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

import type {
  DownloadInfo,
  FindResult,
  HistoryEntry,
  Settings,
  SettingsPatch,
  Suggestion,
  Tab,
  TabsSnapshot,
  StorageUsage,
  TopSite,
  WindowState,
} from './types';

export const IpcChannels = {
  // Smoke-test channel kept from M0 for the preload API sanity check.
  appPing: 'app:ping',

  // Multi-tab management (M2).
  tabCreate: 'tab:create',
  tabClose: 'tab:close',
  tabActivate: 'tab:activate',
  /** Main → renderer event. Fires on create/close/activate — whenever the tab set or active id changes. */
  tabsSnapshot: 'tabs:snapshot',
  /** Renderer → main invoke. Returns the current TabsSnapshot synchronously. Used after mount to close the snapshot-vs-useEffect race. */
  tabsRequestSnapshot: 'tabs:request-snapshot',
  tabSetMobile: 'tab:set-mobile',

  // Per-tab navigation (all take `{ id }` in M2 — the single-tab shortcut from M1 is gone).
  tabNavigate: 'tab:navigate',
  tabGoBack: 'tab:go-back',
  tabGoForward: 'tab:go-forward',
  tabReload: 'tab:reload',
  /** Main → renderer event. Fires on a single tab's field change (url / title / loading / history). */
  tabUpdated: 'tab:updated',

  // Renderer reports chrome bar height so main can position WebContentsViews.
  chromeSetHeight: 'chrome:set-height',

  /** Main → renderer event. Broadcasts EdgeDock state (docked side, hidden, dimmed) to chrome. */
  windowState: 'window:state',

  // Settings persistence (M6).
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  /** Main → renderer event. Broadcasts the full Settings after every successful update. */
  settingsChanged: 'settings:changed',
  /** Main → renderer event. Fires once after ready-to-show with the initial Settings snapshot. */
  appReady: 'app:ready',
  /** Renderer → main send. Drives ViewManager suppression while the settings drawer is open. */
  viewSetSuppressed: 'view:set-suppressed',

  /**
   * Main → renderer event. Fired by the spec §15 hidden Application Menu when
   * an accelerator maps to a renderer-side action (focus address bar, toggle
   * a drawer). Direct main-side actions (new tab, close tab, navigation,
   * reload, DevTools) don't travel over this channel — they're invoked
   * directly from the menu's `click` handler.
   */
  chromeShortcut: 'chrome:shortcut',

  /** Main → renderer event. Fires when nativeTheme.shouldUseDarkColors changes. */
  nativeThemeUpdated: 'chrome:native-theme',
  /** Renderer → main invoke. Returns current nativeTheme.shouldUseDarkColors. */
  nativeThemeGet: 'chrome:native-theme-get',
  /** R→M invoke. 取最近 N 条历史，按 lastVisitedAt 倒序。 */
  historyRecent: 'history:recent',
  /** R→M invoke. 历史自动补全：按查询字符串返回 ≤8 条 Suggestion。 */
  historySuggest: 'history:suggest',
  /** R→M send. 删除一条历史；不存在的 URL 静默 no-op。 */
  historyRemove: 'history:remove',
  /** R→M send. 清空全部历史（M14 NewTab Clear 按钮）；同步 broadcast history:changed。 */
  historyClear: 'history:clear',
  /** M→R event. 历史变更信号 — payload 空对象，renderer 自己 re-fetch。 */
  historyChanged: 'history:changed',
  /**
   * M→R event. M13 TabCycler broadcasts active=true on Ctrl+Tab cycle start,
   * false when the cycle ends (renderer-driven via `cycleEnd`, win blur, or
   * any other call to `cycler.end()`). There is no automatic Ctrl-release
   * detection.
   */
  cycleState: 'cycle:state',
  /**
   * M→R event (M13 hotfix). Fires whenever any tab's WebContents receives
   * focus — typically because the user clicked on the page area. Renderer
   * uses this to close any open chrome drawer (replaces the suppression
   * trick that hid the page while a drawer was open).
   */
  tabFocused: 'chrome:tab-focused',
  /**
   * R→M send. Renderer asks main to end any active Ctrl+Tab cycle —
   * fires from `closeDrawer` in App.tsx so user-driven drawer dismissal
   * (outside-click / tab selection / tab-wc focus) also ends a cycle that
   * was started by Ctrl+Tab. There is no automatic Ctrl-release detection.
   */
  cycleEnd: 'cycle:end',

  /** R→M send (M17). Self-drawn window controls. */
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  /** R→M invoke (M17). Stop button in the address pill. */
  tabStop: 'tab:stop',
  /** R→M send (M17). TabDrawer overlay height; offsets the active view. */
  viewSetTopInset: 'view:set-top-inset',
  /** R→M invoke (M17). Half-res JPEG data URL of the active page, or null. */
  viewCaptureActive: 'view:capture-active',
  /** R→M invoke (M17). NewTab "Frequent" tiles, grouped by host, ranked by frecency. */
  historyTopSites: 'history:top-sites',

  /** R→M invoke (M16). User mute for a tab. */
  tabSetMuted: 'tab:set-muted',
  /** R→M invoke (M16). Find in the active tab (start or step). */
  findStart: 'find:start',
  /** R→M send (M16). Stop finding, clear the selection. */
  findStop: 'find:stop',
  /** M→R event (M16). found-in-page result for the active tab. */
  findResult: 'find:result',
  /** R→M invoke (M16). Current downloads list (most recent first). */
  downloadsList: 'downloads:list',
  /** M→R event (M16). Full downloads list after any change (throttled). */
  downloadsChanged: 'downloads:changed',
  /** R→M send (M16). Download item actions. */
  downloadsOpen: 'downloads:open',
  downloadsShowInFolder: 'downloads:show-in-folder',
  downloadsCancel: 'downloads:cancel',
  downloadsClear: 'downloads:clear',
  /** R→M invoke (M16). Settings → Storage. */
  storageUsage: 'storage:usage',
  storageClearCache: 'storage:clear-cache',
  storageClearSiteData: 'storage:clear-site-data',
} as const;

/**
 * Renderer-bound shortcut actions carried by {@link IpcChannels.chromeShortcut}.
 * Kept as a named union so the main dep type, IPC contract payload, and the
 * renderer dispatch switch all reference the same source of truth.
 */
export type ShortcutAction =
  | 'focus-address-bar'
  | 'toggle-settings-drawer'
  /** M16 Ctrl+F. */
  | 'open-find';

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface IpcContract {
  [IpcChannels.appPing]: {
    request: { message: string };
    response: { reply: string; timestamp: number };
  };

  [IpcChannels.tabCreate]: {
    /** Optional initial URL; defaults to about:blank. */
    request: { url?: string };
    response: Tab;
  };
  [IpcChannels.tabClose]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabActivate]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabsSnapshot]: {
    /** Full snapshot — renderer replaces its store wholesale on receive. */
    request: TabsSnapshot;
    response: void;
  };
  [IpcChannels.tabsRequestSnapshot]: {
    request: Record<string, never>;
    response: TabsSnapshot;
  };
  [IpcChannels.tabSetMobile]: {
    request: { id: string; isMobile: boolean };
    response: void;
  };

  [IpcChannels.tabNavigate]: {
    request: { id: string; url: string };
    response: void;
  };
  [IpcChannels.tabGoBack]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabGoForward]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabReload]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabStop]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.tabUpdated]: {
    /** Main broadcasts the full new Tab (id included). Renderer stores it keyed by id. */
    request: Tab;
    response: void;
  };

  [IpcChannels.chromeSetHeight]: {
    request: { heightPx: number };
    response: void;
  };

  [IpcChannels.windowState]: {
    /** Main broadcasts full EdgeDock state; renderer replaces its store on receive. */
    request: WindowState;
    response: void;
  };

  [IpcChannels.settingsGet]: {
    request: Record<string, never>;
    response: Settings;
  };
  [IpcChannels.settingsUpdate]: {
    /**
     * Request is a nested-Partial; main clamps + merges + persists.
     * Response is the resulting full Settings.
     */
    request: SettingsPatch;
    response: Settings;
  };
  [IpcChannels.settingsChanged]: {
    /** M→R event; main broadcasts full Settings after each successful update. */
    request: Settings;
    response: void;
  };
  [IpcChannels.appReady]: {
    /**
     * Fires once after ready-to-show. Carries initial Settings snapshot so
     * renderer has an authoritative starting state.
     */
    request: { settings: Settings };
    response: void;
  };
  [IpcChannels.viewSetSuppressed]: {
    /**
     * R→M send. When true, ViewManager hides the active tab's view
     * (View.setVisible(false); bounds unchanged — M17) so renderer overlays
     * can render over the native WebContentsView layer.
     */
    request: { suppressed: boolean };
    response: void;
  };

  [IpcChannels.chromeShortcut]: {
    /** M→R event; fires when a spec §15 accelerator needs a renderer-side action. */
    request: { action: ShortcutAction };
    response: void;
  };

  [IpcChannels.nativeThemeUpdated]: {
    request: { shouldUseDarkColors: boolean };
    response: void;
  };
  [IpcChannels.nativeThemeGet]: {
    request: Record<string, never>;
    response: { shouldUseDarkColors: boolean };
  };
  [IpcChannels.historyRecent]: {
    request: { limit: number };
    response: HistoryEntry[];
  };
  [IpcChannels.historySuggest]: {
    request: { query: string };
    response: Suggestion[];
  };
  [IpcChannels.historyRemove]: {
    request: { url: string };
    response: void;
  };
  [IpcChannels.historyClear]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.historyChanged]: {
    /** 仅信号；renderer 收到后自己 re-fetch。 */
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.cycleState]: {
    /** Fires on cycle start (active=true) and cycle end (active=false). */
    request: { active: boolean };
    response: void;
  };
  [IpcChannels.tabFocused]: {
    /** Empty payload — renderer just needs the signal. */
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.cycleEnd]: {
    /** R→M send: end any active Ctrl+Tab cycle. Fired by closeDrawer. */
    request: Record<string, never>;
    response: void;
  };

  [IpcChannels.windowMinimize]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.windowClose]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.viewSetTopInset]: {
    /** TabDrawer height in CSS px; 0 when the drawer closes. */
    request: { px: number };
    response: void;
  };
  [IpcChannels.viewCaptureActive]: {
    request: Record<string, never>;
    response: string | null;
  };
  [IpcChannels.historyTopSites]: {
    request: { limit: number };
    response: TopSite[];
  };

  [IpcChannels.tabSetMuted]: {
    request: { id: string; muted: boolean };
    response: void;
  };
  [IpcChannels.findStart]: {
    /**
     * `newSession: true` starts a new search (text changed); false steps to
     * the next/previous match. Maps to Electron's (confusingly named)
     * `findInPage({ findNext })`, which is true for a NEW session.
     */
    request: { text: string; forward: boolean; newSession: boolean };
    response: void;
  };
  [IpcChannels.findStop]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.findResult]: {
    request: FindResult;
    response: void;
  };
  [IpcChannels.downloadsList]: {
    request: Record<string, never>;
    response: DownloadInfo[];
  };
  [IpcChannels.downloadsChanged]: {
    request: DownloadInfo[];
    response: void;
  };
  [IpcChannels.downloadsOpen]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.downloadsShowInFolder]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.downloadsCancel]: {
    request: { id: string };
    response: void;
  };
  [IpcChannels.downloadsClear]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.storageUsage]: {
    request: Record<string, never>;
    response: StorageUsage;
  };
  [IpcChannels.storageClearCache]: {
    request: Record<string, never>;
    response: void;
  };
  [IpcChannels.storageClearSiteData]: {
    request: Record<string, never>;
    response: void;
  };
}
