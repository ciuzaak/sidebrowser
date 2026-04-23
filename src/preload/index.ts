import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { Tab } from '@shared/types';

const api = {
  // M0 smoke-test ping (kept for regression coverage; removed in a later cleanup).
  ping: (message: string): Promise<IpcContract[typeof IpcChannels.appPing]['response']> =>
    ipcRenderer.invoke(IpcChannels.appPing, { message }),

  // Navigation
  navigate: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabNavigate, { url }),
  goBack: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabGoBack),
  goForward: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabGoForward),
  reload: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabReload),

  // Chrome layout — fire-and-forget send (no response expected)
  setChromeHeight: (heightPx: number): void => {
    ipcRenderer.send(IpcChannels.chromeSetHeight, { heightPx });
  },

  /** Subscribe to tab state updates. Returns an unsubscribe function. */
  onTabUpdated: (listener: (tab: Tab) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tab: Tab): void => listener(tab);
    ipcRenderer.on(IpcChannels.tabUpdated, handler);
    return () => ipcRenderer.off(IpcChannels.tabUpdated, handler);
  },
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
