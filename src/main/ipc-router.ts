import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';

/**
 * Wires up all ipcMain handlers in one place.
 * Every handler reads/writes through the contract types so channel names and
 * payload shapes are verified at compile time.
 *
 * Safe to call multiple times for successive windows (e.g. macOS `activate`
 * re-opens the window after all windows close): `handle` registrations are
 * overwritten via `removeHandler`, and the per-window `ipcMain.on` listener
 * is removed when its window closes.
 */
export function registerIpcRouter(window: BrowserWindow, viewManager: ViewManager): void {
  // Kept from M0 for preload sanity checks.
  ipcMain.removeHandler(IpcChannels.appPing);
  ipcMain.handle(
    IpcChannels.appPing,
    (_event, payload: IpcContract[typeof IpcChannels.appPing]['request']) => {
      return {
        reply: `pong: ${payload.message}`,
        timestamp: Date.now(),
      };
    },
  );

  ipcMain.removeHandler(IpcChannels.tabNavigate);
  ipcMain.handle(
    IpcChannels.tabNavigate,
    async (_event, payload: IpcContract[typeof IpcChannels.tabNavigate]['request']) => {
      await viewManager.navigate(payload.url);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabGoBack);
  ipcMain.handle(IpcChannels.tabGoBack, () => viewManager.goBack());
  ipcMain.removeHandler(IpcChannels.tabGoForward);
  ipcMain.handle(IpcChannels.tabGoForward, () => viewManager.goForward());
  ipcMain.removeHandler(IpcChannels.tabReload);
  ipcMain.handle(IpcChannels.tabReload, () => viewManager.reload());

  const onChromeSetHeight = (
    _event: IpcMainEvent,
    payload: IpcContract[typeof IpcChannels.chromeSetHeight]['request'],
  ): void => {
    viewManager.setChromeHeight(payload.heightPx);
  };
  ipcMain.on(IpcChannels.chromeSetHeight, onChromeSetHeight);
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.chromeSetHeight, onChromeSetHeight);
  });

  // Main → renderer: broadcast tab state on every change.
  viewManager.onTabChange((tab) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.tabUpdated, tab);
    }
  });
}
