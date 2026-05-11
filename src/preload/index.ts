import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type IpcContract, type ShortcutAction } from '@shared/ipc-contract';
import type {
  HistoryEntry, Settings, SettingsPatch, Suggestion, Tab, TabsSnapshot, WindowState,
} from '@shared/types';

const api = {
  // M0 smoke-test ping (kept for regression coverage).
  ping: (message: string): Promise<IpcContract[typeof IpcChannels.appPing]['response']> =>
    ipcRenderer.invoke(IpcChannels.appPing, { message }),

  // Tab management
  createTab: (url?: string): Promise<Tab> =>
    ipcRenderer.invoke(IpcChannels.tabCreate, { url }),
  closeTab: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabClose, { id }),
  activateTab: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabActivate, { id }),
  /** Explicitly fetch the current tabs snapshot from main. Used after subscribing to close the broadcast race. */
  requestTabsSnapshot: (): Promise<TabsSnapshot> =>
    ipcRenderer.invoke(IpcChannels.tabsRequestSnapshot, {}),

  // Per-tab navigation
  navigate: (id: string, url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabNavigate, { id, url }),
  goBack: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabGoBack, { id }),
  goForward: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabGoForward, { id }),
  reload: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabReload, { id }),
  setMobile: (id: string, isMobile: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabSetMobile, { id, isMobile }),

  // Chrome layout
  setChromeHeight: (heightPx: number): void => {
    ipcRenderer.send(IpcChannels.chromeSetHeight, { heightPx });
  },

  /** Subscribe to single-tab updates. Returns an unsubscribe. */
  onTabUpdated: (listener: (tab: Tab) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tab: Tab): void => listener(tab);
    ipcRenderer.on(IpcChannels.tabUpdated, handler);
    return () => ipcRenderer.off(IpcChannels.tabUpdated, handler);
  },
  /** Subscribe to full tabs snapshot. Returns an unsubscribe. */
  onTabsSnapshot: (listener: (snapshot: TabsSnapshot) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, snapshot: TabsSnapshot): void =>
      listener(snapshot);
    ipcRenderer.on(IpcChannels.tabsSnapshot, handler);
    return () => ipcRenderer.off(IpcChannels.tabsSnapshot, handler);
  },
  /** Subscribe to EdgeDock window state broadcasts. Returns an unsubscribe. */
  onWindowState: (listener: (s: WindowState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, s: WindowState): void => listener(s);
    ipcRenderer.on(IpcChannels.windowState, handler);
    return () => ipcRenderer.off(IpcChannels.windowState, handler);
  },

  // Settings + app lifecycle + drawer view-suppression (M6)
  getSettings: (): Promise<Settings> =>
    ipcRenderer.invoke(IpcChannels.settingsGet, {}),

  updateSettings: (partial: SettingsPatch): Promise<Settings> =>
    ipcRenderer.invoke(IpcChannels.settingsUpdate, partial),

  /** Subscribe to settings:changed broadcasts. Returns unsubscribe. */
  onSettingsChanged: (listener: (s: Settings) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, s: Settings): void => listener(s);
    ipcRenderer.on(IpcChannels.settingsChanged, handler);
    return () => ipcRenderer.off(IpcChannels.settingsChanged, handler);
  },

  /** Subscribe to the single app:ready broadcast (carries initial Settings). Returns unsubscribe. */
  onAppReady: (listener: (p: { settings: Settings }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, p: { settings: Settings }): void => listener(p);
    ipcRenderer.on(IpcChannels.appReady, handler);
    return () => ipcRenderer.off(IpcChannels.appReady, handler);
  },

  /** R→M send. Tell ViewManager to hide/show the active WebContentsView beneath the chrome layer. Used by SettingsDrawer open/close in Task 10. */
  setViewSuppressed: (suppressed: boolean): void => {
    ipcRenderer.send(IpcChannels.viewSetSuppressed, { suppressed });
  },

  /**
   * Subscribe to spec §15 renderer-bound shortcut actions broadcast by the
   * hidden Application Menu (focus address bar, toggle tab/settings drawers).
   * Returns an unsubscribe.
   */
  onShortcut: (listener: (action: ShortcutAction) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: { action: ShortcutAction }): void =>
      listener(payload.action);
    ipcRenderer.on(IpcChannels.chromeShortcut, handler);
    return () => ipcRenderer.off(IpcChannels.chromeShortcut, handler);
  },

  getNativeTheme: (): Promise<{ shouldUseDarkColors: boolean }> =>
    ipcRenderer.invoke(IpcChannels.nativeThemeGet, {}),

  onNativeThemeUpdated: (
    cb: (v: { shouldUseDarkColors: boolean }) => void,
  ): (() => void) => {
    const handler = (_e: unknown, v: { shouldUseDarkColors: boolean }): void => cb(v);
    ipcRenderer.on(IpcChannels.nativeThemeUpdated, handler);
    return () => { ipcRenderer.removeListener(IpcChannels.nativeThemeUpdated, handler); };
  },

  // History (M12)
  historyRecent: (limit: number): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IpcChannels.historyRecent, { limit }),

  historySuggest: (query: string): Promise<Suggestion[]> =>
    ipcRenderer.invoke(IpcChannels.historySuggest, { query }),

  historyRemove: (url: string): void => {
    ipcRenderer.send(IpcChannels.historyRemove, { url });
  },

  /** Subscribe to history mutation pings. Returns unsubscribe. */
  onHistoryChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on(IpcChannels.historyChanged, handler);
    return () => ipcRenderer.off(IpcChannels.historyChanged, handler);
  },

  /**
   * Subscribe to TabCycler broadcasts (M13). payload.active=true when a
   * cycle starts (drawer should show), false when the cycle ends (drawer
   * should hide). Returns unsubscribe.
   */
  onCycleState: (cb: (active: boolean) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { active: boolean }): void => cb(p.active);
    ipcRenderer.on(IpcChannels.cycleState, handler);
    return () => ipcRenderer.off(IpcChannels.cycleState, handler);
  },

  /**
   * Subscribe to "any tab WebContents got focus" pings (M13 hotfix). Used by
   * renderer to close any open chrome drawer when the user clicks on the page
   * area (which can't be detected via DOM events because WebContentsView is
   * a separate process). Returns unsubscribe.
   */
  onTabFocused: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on(IpcChannels.tabFocused, handler);
    return () => ipcRenderer.off(IpcChannels.tabFocused, handler);
  },

  /**
   * R→M send: end any active Ctrl+Tab cycle. Called from `closeDrawer` in
   * App.tsx so outside-click / tab-wc focus / TabDrawer onSelect all
   * dismiss a Ctrl+Tab-opened drawer the same way they dismiss a mouse-
   * opened one. No automatic Ctrl-release detection exists.
   */
  endCycle: (): void => {
    ipcRenderer.send(IpcChannels.cycleEnd, {});
  },
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
