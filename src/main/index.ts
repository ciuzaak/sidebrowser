import { app, BrowserWindow, screen } from 'electron';
import type { Rectangle } from 'electron';
import { createRequire } from 'node:module';
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
import { SettingsStore, createElectronBackend } from './settings-store';
import {
  WindowBoundsPersister,
  type WindowBoundsBackend,
} from './window-bounds';
import { IpcChannels } from '@shared/ipc-contract';
import type { Settings, SettingsPatch } from '@shared/types';
import { TrayManager, createElectronTrayBackend } from './tray-manager';
import { resolveCloseAction } from './close-action-resolver';

let isQuitting = false;

function createWindow(initialBounds: Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
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

/**
 * Window-bounds backend — second `electron-store` instance under the
 * `'window-bounds'` name. Chosen over multiplexing the settings store because:
 *  - Bounds write cadence (debounced per drag/resize) is orthogonal to
 *    settings writes (infrequent, user-driven).
 *  - File-level separation keeps a corrupt bounds blob from risking settings
 *    load on next launch (and vice versa).
 *  - Matches the lazy-require pattern in `createElectronBackend` so this
 *    module stays Node-only-importable in non-Electron contexts.
 */
function createBoundsBackend(): WindowBoundsBackend {
  const requireCjs = createRequire(import.meta.url);
  const StoreModule = requireCjs('electron-store') as
    | { default: new (opts?: unknown) => ElectronStoreInstance }
    | (new (opts?: unknown) => ElectronStoreInstance);
  const StoreCtor =
    typeof StoreModule === 'function' ? StoreModule : StoreModule.default;
  const store = new StoreCtor({
    name: 'window-bounds',
    defaults: {},
  }) as ElectronStoreInstance;
  return {
    get: () => store.get('bounds'),
    set: (v) => { store.set('bounds', v); },
  };
}

interface ElectronStoreInstance {
  get(key: 'bounds'): { x: number; y: number; width: number; height: number } | undefined;
  set(
    key: 'bounds',
    value: { x: number; y: number; width: number; height: number },
  ): void;
}

function resolveTrayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray', 'tray-32.png')
    : join(__dirname, '../../resources/tray/tray-32.png');
}

app.whenReady().then(() => {
  // 1. Settings store + window-bounds persister.
  const settingsStore = new SettingsStore(createElectronBackend());
  const boundsPersister = new WindowBoundsPersister(
    createBoundsBackend(),
    screen,
    (cb, ms) => setTimeout(cb, ms),
    (h) => { clearTimeout(h); },
  );
  const initial = settingsStore.get().window;
  const initialBounds = boundsPersister.loadOrDefault(initial.width, initial.height);

  // 2. Window + ViewManager + IPC router.
  const win = createWindow(initialBounds);
  const viewManager = new ViewManager(win, () => {
    const s = settingsStore.get();
    return {
      defaultIsMobile: s.browsing.defaultIsMobile,
      mobileUserAgent: s.browsing.mobileUserAgent,
    };
  });
  registerIpcRouter(win, viewManager, settingsStore);

  // 3. Tab persistence — save on any snapshot change or per-tab URL update.
  const store = createTabStore();
  const saver = createPersistedTabSaver(store);
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
    const persisted = settingsStore.get().lifecycle.restoreTabsOnLaunch
      ? loadPersistedTabs(store)
      : null;
    seedTabs(viewManager, persisted);
  });

  // 4. M4: mouse-leave dim — construct watcher + dim controller, wire listeners.
  const watcher = new CursorWatcher({
    getCursorPoint: () => screen.getCursorScreenPoint(),
    getWindowBounds: () => (win.isDestroyed() ? null : win.getBounds()),
    settings: settingsStore.get().mouseLeave,
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
    applyDim: () => { const wc = viewManager.getActiveWebContents(); if (wc) void dim.apply(wc, settingsStore.get().dim); },
    clearDim: () => { void dim.clear(); },
    broadcastState: (s) => { if (!win.isDestroyed()) win.webContents.send(IpcChannels.windowState, s); },
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => { clearInterval(h); },
    // Getter so live settings changes (M6) are picked up per-dispatch.
    config: () => {
      const s = settingsStore.get();
      return {
        edgeThresholdPx: s.window.edgeThresholdPx,
        animationMs: s.edgeDock.animationMs,
        triggerStripPx: s.edgeDock.triggerStripPx,
        windowWidth: s.window.width,
        enabled: s.edgeDock.enabled,
      };
    },
  });

  // M4 direct dim wiring replaced: mouse events now route through EdgeDock.
  watcher.onLeave(() => edgeDock.dispatch({ type: 'MOUSE_LEAVE' }));
  watcher.onEnter(() => edgeDock.dispatch({ type: 'MOUSE_ENTER' }));

  // M4 retarget behavior preserved (dim-only; unrelated to EdgeDock).
  viewManager.onSnapshot(() => {
    if (!dim.isActive) return;
    const wc = viewManager.getActiveWebContents();
    if (wc) void dim.retarget(wc, settingsStore.get().dim);
  });

  // 5. Window bounds persistence — debounced on every move/resize.
  win.on('moved', () => {
    boundsPersister.markDirty(win.getBounds());
    edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() });
  });
  win.on('resize', () => {
    boundsPersister.markDirty(win.getBounds());
  });

  // M7: close-action handler — intercept window close and hide instead of
  // destroy when closeAction='minimize-to-tray' and app is not quitting.
  win.on('close', (e) => {
    const action = resolveCloseAction({
      closeAction: settingsStore.get().lifecycle.closeAction,
      isQuitting,
    });
    if (action === 'hide') {
      e.preventDefault();
      win.hide();
    }
    // 'destroy' → default close flow continues
  });

  // 6. Live-apply fan-out. Fires on every settingsStore.update(). Spec §7 +
  // plan §Task 8 live-apply matrix: dim (restyle if active), mouse-leave
  // delay (swap via setDelayMs), window width/height (setBounds), and the
  // renderer broadcast. EdgeDock config is a getter — it picks up fresh
  // values on its next dispatch without explicit poke.
  settingsStore.onChanged((settings) => {
    if (dim.isActive) void dim.restyle(settings.dim);
    watcher.setDelayMs(settings.mouseLeave.delayMs);
    const b = win.getBounds();
    // NOTE: setBounds synchronously fires 'resize', which re-enters
    // boundsPersister.markDirty(). The debounce coalesces the self-triggered
    // write, and on the second tick the persisted rect already matches
    // settings, so the loop terminates after one store.set within ~1s.
    if (b.width !== settings.window.width || b.height !== settings.window.height) {
      win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
    }
    if (!win.isDestroyed()) {
      // If a renderer isn't yet listening (e.g. a test hook calls updateSettings
      // before React mount / did-finish-load), the broadcast drops silently.
      // Task 9's getSettings().then(setSettings) on mount is the authoritative
      // first-paint path; app:ready is a backup hint.
      win.webContents.send(IpcChannels.settingsChanged, settings);
    }
  });

  // 7. app:ready broadcast + initial EdgeDock seed (one-shot on ready-to-show).
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.appReady, { settings: settingsStore.get() });
    }
    edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() });
  });

  // 8. Display topology changes — unchanged from M5.
  const onDisplayChanged = (): void => {
    const b = win.getBounds();
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const nearest = screen.getDisplayNearestPoint(center);
    // Strict containment — a HIDDEN_LEFT/RIGHT window has triggerStripPx (3px) outside
    // the workArea by design, so insideAny=false there. If a display unplug fires while
    // HIDDEN, this correctly surfaces as offscreen=true → SNAP_TO_CENTER, matching the
    // spec §10 recovery requirement. A window docked flush against the edge (before hide)
    // has its right/left edge exactly on the workArea boundary and still passes `<=`.
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
      // M6 Task 8 hooks.
      getSettings: (): Settings => settingsStore.get(),
      updateSettings: (p: SettingsPatch): Settings => settingsStore.update(p),
      getActiveViewBounds: () => viewManager.getActiveBoundsForTest(),
      flushWindowBounds: () => { boundsPersister.flush(); },
      // M7 hooks.
      requestWindowClose: () => win.close(),
      getIsWindowVisible: () => !win.isDestroyed() && win.isVisible(),
      setCloseAction: (v: 'quit' | 'minimize-to-tray') =>
        settingsStore.update({ lifecycle: { closeAction: v } }),
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
      // TODO(post-v1-Windows): macOS activate path still has gaps — the
      // initialBounds snapshot is stale (no fresh boundsPersister.loadOrDefault
      // call) and tab persistence isn't re-attached, so reactivated windows
      // lose their saved tab state. Spec §17 ships v1 as Windows-only, so
      // this is best-effort. Extract a shared bootstrapWindow helper when
      // adding macOS support. Browsing defaults below now read live from
      // settingsStore, matching the primary-window wiring.
      const newWin = createWindow(initialBounds);
      const newViewManager = new ViewManager(newWin, () => {
        const s = settingsStore.get();
        return {
          defaultIsMobile: s.browsing.defaultIsMobile,
          mobileUserAgent: s.browsing.mobileUserAgent,
        };
      });
      registerIpcRouter(newWin, newViewManager, settingsStore);
      newWin.webContents.once('did-finish-load', () => {
        newViewManager.createTab('about:blank');
      });
    }
  });

  // M7: system tray — instantiate after win is ready, before before-quit handler.
  const iconPath = resolveTrayIconPath();
  const tray = new TrayManager({
    backend: createElectronTrayBackend(iconPath),
    iconPath,
    onShow: () => { win.show(); win.focus(); },
    onQuit: () => app.quit(),
  });

  // 9. Before-quit: flush both bounds debounce and tab-save debounce so the
  // last rect/tab-state mutation always hits disk.
  app.on('before-quit', () => {
    isQuitting = true;
    tray.destroy();
    boundsPersister.flush();
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
