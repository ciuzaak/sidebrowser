import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';

/**
 * Wires up all ipcMain handlers in one place.
 * Every handler reads/writes through the contract types so channel names and
 * payload shapes are verified at compile time.
 */
export function registerIpcRouter(window: BrowserWindow, viewManager: ViewManager): void {
  // Kept from M0 for preload sanity checks.
  ipcMain.handle(
    IpcChannels.appPing,
    (_event, payload: IpcContract[typeof IpcChannels.appPing]['request']) => {
      return {
        reply: `pong: ${payload.message}`,
        timestamp: Date.now(),
      };
    },
  );

  ipcMain.handle(
    IpcChannels.tabNavigate,
    async (_event, payload: IpcContract[typeof IpcChannels.tabNavigate]['request']) => {
      await viewManager.navigate(payload.url);
    },
  );

  ipcMain.handle(IpcChannels.tabGoBack, () => viewManager.goBack());
  ipcMain.handle(IpcChannels.tabGoForward, () => viewManager.goForward());
  ipcMain.handle(IpcChannels.tabReload, () => viewManager.reload());

  ipcMain.on(
    IpcChannels.chromeSetHeight,
    (_event, payload: IpcContract[typeof IpcChannels.chromeSetHeight]['request']) => {
      viewManager.setChromeHeight(payload.heightPx);
    },
  );

  // Main → renderer: broadcast tab state on every change.
  viewManager.onTabChange((tab) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.tabUpdated, tab);
    }
  });
}
