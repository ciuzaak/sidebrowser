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

  // Defer seeding by one tick so renderer has begun bootstrapping and the
  // tabs:snapshot broadcast arrives alongside the first tab:updated events.
  setImmediate(() => {
    seedTabs(viewManager, loadPersistedTabs(store));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      const newViewManager = new ViewManager(newWin);
      registerIpcRouter(newWin, newViewManager);
      setImmediate(() => {
        newViewManager.createTab('about:blank');
      });
    }
  });

  app.on('before-quit', () => {
    saver.flush();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
