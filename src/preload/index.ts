import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type IpcContract, type ShortcutAction } from '@shared/ipc-contract';
import type { Settings, SettingsPatch, Tab, TabsSnapshot, WindowState } from '@shared/types';

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
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
