import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { Tab, TabsSnapshot, WindowState } from '@shared/types';

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
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
