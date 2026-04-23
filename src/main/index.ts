import { app, BrowserWindow, screen } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'node:path';
import { ViewManager } from './view-manager';
import { registerIpcRouter } from './ipc-router';
import {
  createPersistedTabSaver,
  createTabStore,
  loadPersistedTabs,
  type PersistedTabs,
} from './tab-persistence';
import { CursorWatcher } from './cursor-watcher';
import { DimController } from './dim-controller';
import { EdgeDock } from './edge-dock';
import { DEFAULTS } from './settings';
import { IpcChannels } from '@shared/ipc-contract';

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
      viewManager.createTab(pt.url, pt.id, pt.isMobile);
      // createTab auto-activates — we override the active tab below.
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

  // M4: mouse-leave dim — construct watcher + dim controller, wire listeners.
  const watcher = new CursorWatcher({
    getCursorPoint: () => screen.getCursorScreenPoint(),
    getWindowBounds: () => (win.isDestroyed() ? null : win.getBounds()),
    settings: DEFAULTS.mouseLeave,
  });
  const dim = new DimController();

  const getWorkArea = (): Electron.Rectangle => {
    const b = win.getBounds();
    try { return screen.getDisplayMatching(b).workArea; }
    catch { return screen.getPrimaryDisplay().workArea; }
  };

  const edgeDock = new EdgeDock({
    setWindowX: (x) => { const b = win.getBounds(); win.setBounds({ ...b, x: Math.round(x) }); },
    getWindowBounds: () => win.getBounds(),
    applyDim: () => { const wc = viewManager.getActiveWebContents(); if (wc) void dim.apply(wc, DEFAULTS.dim); },
    clearDim: () => { void dim.clear(); },
    broadcastState: (s) => { if (!win.isDestroyed()) win.webContents.send(IpcChannels.windowState, s); },
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => clearInterval(h),
    config: {
      edgeThresholdPx: DEFAULTS.window.edgeThresholdPx,
      animationMs: DEFAULTS.edgeDock.animationMs,
      triggerStripPx: DEFAULTS.edgeDock.triggerStripPx,
      windowWidth: DEFAULTS.window.width,
      enabled: DEFAULTS.edgeDock.enabled,
    },
  });

  // Seed workArea after window ready (one-shot).
  win.once('ready-to-show', () => {
    edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() });
  });

  // M4 direct dim wiring replaced: mouse events now route through EdgeDock.
  watcher.onLeave(() => edgeDock.dispatch({ type: 'MOUSE_LEAVE' }));
  watcher.onEnter(() => edgeDock.dispatch({ type: 'MOUSE_ENTER' }));

  // M4 retarget behavior preserved (dim-only; unrelated to EdgeDock).
  viewManager.onSnapshot(() => {
    if (!dim.isActive) return;
    const wc = viewManager.getActiveWebContents();
    if (wc) void dim.retarget(wc, DEFAULTS.dim);
  });

  // New event sources: window move + display topology changes.
  win.on('moved', () => edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() }));

  const onDisplayChanged = (): void => {
    const b = win.getBounds();
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const nearest = screen.getDisplayNearestPoint(center);
    const insideAny = screen.getAllDisplays().some(d =>
      b.x >= d.workArea.x && b.x + b.width <= d.workArea.x + d.workArea.width
      && b.y >= d.workArea.y && b.y + b.height <= d.workArea.y + d.workArea.height);
    edgeDock.dispatch({
      type: 'DISPLAY_CHANGED',
      bounds: b,
      workArea: nearest.workArea, // always populated — nearest display if offscreen
      offscreen: !insideAny,
    });
  };
  screen.on('display-metrics-changed', onDisplayChanged);
  screen.on('display-removed', onDisplayChanged);

  if (process.env['SIDEBROWSER_E2E'] === '1') {
    (globalThis as Record<string, unknown>)['__sidebrowserTestHooks'] = {
      fireLeaveNow: () => watcher.emitLeaveNow(),
      fireEnterNow: () => watcher.emitEnterNow(),
      getActiveWebContents: () => viewManager.getActiveWebContents(),
      getWebContentsByUrlSubstring: (s: string) => viewManager.getWebContentsByUrlSubstring(s),
      emitWindowMoved: () => edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() }),
      emitDisplayChanged: onDisplayChanged,
      getEdgeDockState: () => edgeDock.getState(),
      getWindowBounds: () => win.getBounds(),
      setWindowBounds: (b: Rectangle) => win.setBounds(b),
    };
  } else {
    watcher.start();
  }
  win.once('closed', () => {
    watcher.stop();
    screen.removeListener('display-metrics-changed', onDisplayChanged);
    screen.removeListener('display-removed', onDisplayChanged);
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
