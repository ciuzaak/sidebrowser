import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';

/**
 * Wires up all ipcMain handlers in one place.
 *
 * Idempotent: every handler registration is guarded with removeHandler so a
 * re-call (e.g. macOS `activate` recreating the window) does not throw. The
 * per-window ipcMain.on listener is released when its host window closes.
 */
export function registerIpcRouter(window: BrowserWindow, viewManager: ViewManager): void {
  // M0 smoke-test ping.
  ipcMain.removeHandler(IpcChannels.appPing);
  ipcMain.handle(
    IpcChannels.appPing,
    (_event, payload: IpcContract[typeof IpcChannels.appPing]['request']) => ({
      reply: `pong: ${payload.message}`,
      timestamp: Date.now(),
    }),
  );

  // Tab management.
  ipcMain.removeHandler(IpcChannels.tabCreate);
  ipcMain.handle(
    IpcChannels.tabCreate,
    (_event, payload: IpcContract[typeof IpcChannels.tabCreate]['request']) =>
      viewManager.createTab(payload.url),
  );

  ipcMain.removeHandler(IpcChannels.tabClose);
  ipcMain.handle(
    IpcChannels.tabClose,
    (_event, payload: IpcContract[typeof IpcChannels.tabClose]['request']) => {
      viewManager.closeTab(payload.id);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabActivate);
  ipcMain.handle(
    IpcChannels.tabActivate,
    (_event, payload: IpcContract[typeof IpcChannels.tabActivate]['request']) => {
      viewManager.activateTab(payload.id);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabsRequestSnapshot);
  ipcMain.handle(
    IpcChannels.tabsRequestSnapshot,
    () => viewManager.snapshot(),
  );

  // Per-tab navigation.
  ipcMain.removeHandler(IpcChannels.tabNavigate);
  ipcMain.handle(
    IpcChannels.tabNavigate,
    (_event, payload: IpcContract[typeof IpcChannels.tabNavigate]['request']) => {
      viewManager.navigate(payload.id, payload.url);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabGoBack);
  ipcMain.handle(
    IpcChannels.tabGoBack,
    (_event, payload: IpcContract[typeof IpcChannels.tabGoBack]['request']) => {
      viewManager.goBack(payload.id);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabGoForward);
  ipcMain.handle(
    IpcChannels.tabGoForward,
    (_event, payload: IpcContract[typeof IpcChannels.tabGoForward]['request']) => {
      viewManager.goForward(payload.id);
    },
  );

  ipcMain.removeHandler(IpcChannels.tabReload);
  ipcMain.handle(
    IpcChannels.tabReload,
    (_event, payload: IpcContract[typeof IpcChannels.tabReload]['request']) => {
      viewManager.reload(payload.id);
    },
  );

  // Chrome layout — fire-and-forget. Scope listener to this window's lifetime.
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

  // Main → renderer broadcasts.
  viewManager.onTabUpdated((tab) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.tabUpdated, tab);
    }
  });
  viewManager.onSnapshot((snapshot) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.tabsSnapshot, snapshot);
    }
  });
}
