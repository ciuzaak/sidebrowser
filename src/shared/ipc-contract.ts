// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

import type { Settings, SettingsPatch, Tab, TabsSnapshot, WindowState } from './types';

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
} as const;

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
     * R→M send. When true, ViewManager shrinks active tab view bounds to
     * {0,0,0,0} so the settings drawer can render over the native
     * WebContentsView layer.
     */
    request: { suppressed: boolean };
    response: void;
  };
}
