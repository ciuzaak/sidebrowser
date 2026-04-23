import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { ViewManager } from './view-manager';
import { registerIpcRouter } from './ipc-router';
import {
  createPersistedTabSaver,
  createTabStore,
  loadPersistedTabs,
  type PersistedTabs,
} from './tab-persistence';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 393,
    height: 852,
    title: 'sidebrowser',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function seedTabs(viewManager: ViewManager, persisted: PersistedTabs | null): void {
  if (persisted) {
    // Create tabs in stored order; last-created becomes active by default,
    // but we then explicitly activate the stored activeId.
    for (const pt of persisted.tabs) {
      viewManager.createTab(pt.url);
      // createTab auto-activates — we override below.
    }
    viewManager.activateTab(persisted.activeId);
  } else {
    viewManager.createTab('about:blank');
  }
}

app.whenReady().then(() => {
  const win = createWindow();
  const viewManager = new ViewManager(win);
  registerIpcRouter(win, viewManager);

  const store = createTabStore();
  const saver = createPersistedTabSaver(store);

  // Save tabs on every snapshot change, and on every tab URL update
  // (the URL is the only persisted-tab field that transient events can change).
  viewManager.onSnapshot(() => {
    const snap = viewManager.serializeForPersistence();
    if (snap) saver.save(snap);
  });
  viewManager.onTabUpdated(() => {
    const snap = viewManager.serializeForPersistence();
    if (snap) saver.save(snap);
  });

  // Defer seeding until the renderer bundle has loaded so the tabs:snapshot
  // broadcast lands on a renderer that has registered its IPC listeners.
  // (setImmediate fires too early — at that tick the renderer process exists
  // but React hasn't mounted and useTabBridge hasn't subscribed yet.)
  win.webContents.once('did-finish-load', () => {
    seedTabs(viewManager, loadPersistedTabs(store));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // TODO(post-v1-Windows): macOS activate path does not wire persistence —
      // reactivated windows lose tab state. Spec §17 ships v1 as Windows-only,
      // so this is best-effort. Extract a shared bootstrapWindow helper when
      // adding macOS support.
      const newWin = createWindow();
      const newViewManager = new ViewManager(newWin);
      registerIpcRouter(newWin, newViewManager);
      newWin.webContents.once('did-finish-load', () => {
        newViewManager.createTab('about:blank');
      });
    }
  });

  app.on('before-quit', () => {
    saver.flush();
  });
}).catch((err: unknown) => {
  console.error('[sidebrowser] bootstrap failed:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
