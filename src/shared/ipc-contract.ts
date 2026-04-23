// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

import type { Tab, TabsSnapshot } from './types';

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
}
