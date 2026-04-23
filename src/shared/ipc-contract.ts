// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

import type { Tab } from './types';

export const IpcChannels = {
  // Smoke-test channel kept from M0 for the preload API sanity check.
  appPing: 'app:ping',

  // M1: tab navigation (single-tab; no ID arg until M2).
  tabNavigate: 'tab:navigate',
  tabGoBack: 'tab:go-back',
  tabGoForward: 'tab:go-forward',
  tabReload: 'tab:reload',
  /** Main → renderer event. Carries the full Tab (simpler than patches for M1). */
  tabUpdated: 'tab:updated',

  // M1: renderer reports its chrome bar height so main can position the WebContentsView.
  chromeSetHeight: 'chrome:set-height',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface IpcContract {
  [IpcChannels.appPing]: {
    request: { message: string };
    response: { reply: string; timestamp: number };
  };
  [IpcChannels.tabNavigate]: {
    request: { url: string };
    response: void;
  };
  [IpcChannels.tabGoBack]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabGoForward]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabReload]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabUpdated]: {
    /** Main broadcasts on navigation / title / loading state changes. */
    request: Tab;
    response: void;
  };
  [IpcChannels.chromeSetHeight]: {
    request: { heightPx: number };
    response: void;
  };
}
