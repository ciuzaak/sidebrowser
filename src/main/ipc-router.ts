import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';
import type { SettingsStore } from './settings-store';
import type { HistoryStore } from './history-store';
import { rankSuggestions, recentEntries, SUGGEST_LIMIT } from './suggestion-ranker';

/**
 * Wires up all ipcMain handlers in one place.
 *
 * Idempotent: every handler registration is guarded with removeHandler so a
 * re-call (e.g. macOS `activate` recreating the window) does not throw. The
 * per-window ipcMain.on listener is released when its host window closes.
 *
 * Note: the `settings:changed` broadcast is NOT wired here — that lives in
 * `src/main/index.ts` because it fans out live-apply side effects (dim
 * restyle, watcher.setDelayMs, win.setBounds) alongside the renderer notify.
 * This router only handles request/response RPCs + fire-and-forget sends.
 */
export function registerIpcRouter(
  window: BrowserWindow,
  viewManager: ViewManager,
  settingsStore: SettingsStore,
  historyStore: HistoryStore,
): void {
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

  ipcMain.removeHandler(IpcChannels.tabSetMobile);
  ipcMain.handle(
    IpcChannels.tabSetMobile,
    (_event, payload: IpcContract[typeof IpcChannels.tabSetMobile]['request']) => {
      viewManager.setMobile(payload.id, payload.isMobile);
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

  // Settings RPCs (M6 Task 8).
  ipcMain.removeHandler(IpcChannels.settingsGet);
  ipcMain.handle(IpcChannels.settingsGet, () => settingsStore.get());

  ipcMain.removeHandler(IpcChannels.settingsUpdate);
  ipcMain.handle(
    IpcChannels.settingsUpdate,
    (_event, payload: IpcContract[typeof IpcChannels.settingsUpdate]['request']) =>
      settingsStore.update(payload),
  );

  // view:set-suppressed — R→M send (fire-and-forget). Drives ViewManager
  // suppression while the settings drawer is open.
  const onViewSetSuppressed = (
    _event: IpcMainEvent,
    payload: IpcContract[typeof IpcChannels.viewSetSuppressed]['request'],
  ): void => {
    viewManager.setSuppressed(payload.suppressed);
  };
  ipcMain.on(IpcChannels.viewSetSuppressed, onViewSetSuppressed);
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.viewSetSuppressed, onViewSetSuppressed);
  });

  // History RPCs (M12).
  ipcMain.removeHandler(IpcChannels.historyRecent);
  ipcMain.handle(
    IpcChannels.historyRecent,
    (_event, payload: IpcContract[typeof IpcChannels.historyRecent]['request']) =>
      historyStore.recent(payload.limit),
  );

  ipcMain.removeHandler(IpcChannels.historySuggest);
  ipcMain.handle(
    IpcChannels.historySuggest,
    (_event, payload: IpcContract[typeof IpcChannels.historySuggest]['request']) => {
      const q = payload.query.trim();
      if (q === '') {
        // Empty query (focus but no input): return recent 8 as Suggestions
        // with tier=0 just so the wire shape is uniform — UI doesn't render
        // the tier marker.
        return recentEntries(historyStore.all(), SUGGEST_LIMIT).map((e) => ({
          url: e.url,
          title: e.title,
          favicon: e.favicon,
          tier: 0 as const,
        }));
      }
      return rankSuggestions(historyStore.all(), q, Date.now());
    },
  );

  // history:remove — fire-and-forget.
  const onHistoryRemove = (
    _event: IpcMainEvent,
    payload: IpcContract[typeof IpcChannels.historyRemove]['request'],
  ): void => {
    historyStore.remove(payload.url);
  };
  ipcMain.on(IpcChannels.historyRemove, onHistoryRemove);
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.historyRemove, onHistoryRemove);
  });

  // history:changed — broadcast on store mutation. Throttling lives in
  // HistoryStore (16 ms); this fan-out is naturally rate-limited.
  const offHistoryChanged = historyStore.onChanged(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.historyChanged, {});
    }
  });
  window.once('closed', () => { offHistoryChanged(); });

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
