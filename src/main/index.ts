import { app, BrowserWindow, screen, nativeTheme, ipcMain, shell, clipboard } from 'electron';
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
import type { HistoryEntry, Settings, SettingsPatch } from '@shared/types';
import { HistoryStore, createElectronHistoryBackend } from './history-store';
import { HistoryRecorder } from './history-recorder';
import { installApplicationMenu } from './keyboard-shortcuts';
import { TabCycler } from './tab-cycler';
import { isSafeExternalUrl } from './safe-external';
// Imported up here so the E2E `simulateContextMenu` hook (registered later)
// doesn't need a runtime require — keeps lint's no-import-type-annotation rule happy.
import { buildContextMenuTemplate as buildContextMenuTemplateForTest } from './context-menu';
import { handleSecondInstance } from './single-instance';
import { installMobileHeaderRewriter } from './mobile-emulation';
import { getPersistentSession } from './session-manager';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  // app.quit() is async; exit immediately so the rest of app setup (createWindow, etc.) doesn't run.
  process.exit(0);
}

function createWindow(initialBounds: Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    title: 'sidebrowser',
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // M13 hotfix: hide the empty menu bar by default — only appears on Alt.
  // Our hidden Application Menu (visible:false on the only top-level item)
  // still leaves an empty bar row otherwise.
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);

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

  // 1b. History store + recorder (M12).
  const historyStore = new HistoryStore(createElectronHistoryBackend());
  const historyRecorder = new HistoryRecorder(historyStore);

  // 2. Window + ViewManager + IPC router.
  const win = createWindow(initialBounds);
  const viewManager = new ViewManager(win, () => {
    const s = settingsStore.get();
    return {
      defaultIsMobile: s.browsing.defaultIsMobile,
      mobileUserAgent: s.browsing.mobileUserAgent,
    };
  }, historyRecorder);
  // M10: Sec-CH-UA-* 头改写。挂在 persistent session 上，按 viewManager 的 per-tab
  // isMobile 状态决定改不改。必须在 ViewManager 之后、第一个 createTab 之前——
  // seedTabs 在 did-finish-load 才跑，这里安全。
  installMobileHeaderRewriter(getPersistentSession(), (wcId) =>
    viewManager.getMobileEmulationState(wcId),
  );
  registerIpcRouter(win, viewManager, settingsStore, historyStore);

  // 2b. Hidden Application Menu — spec §15 keyboard shortcuts. Installed once
  // globally per-process (Menu.setApplicationMenu is app-wide, not per-window),
  // so the macOS `activate` reactivation path below intentionally doesn't
  // re-install. Direct-action handlers delegate to ViewManager active-tab
  // helpers; renderer-bound actions (focus address bar, toggle drawers) are
  // fanned out via the `chrome:shortcut` broadcast.
  installApplicationMenu({
    onNewTab: () => { viewManager.createTab('about:blank'); },
    onCloseActiveTab: () => { viewManager.closeActiveTab(); },
    onReloadActive: () => { viewManager.reloadActive(); },
    onGoBack: () => { viewManager.goBackActive(); },
    onGoForward: () => { viewManager.goForwardActive(); },
    onToggleDevTools: () => { viewManager.toggleDevToolsActive(); },
    onResetZoom: () => { viewManager.resetActiveZoom(); },
    emitToRenderer: (action) => {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.chromeShortcut, { action });
    },
  });

  // 2c. M13 web context-menu deps. The deps reference viewManager + settingsStore
  // via closures so search-engine selection / tab creation always sees current
  // state. canGoBack/canGoForward are placeholders here — view-manager refreshes
  // them per-event from the right tab's nav history.
  const buildSearchUrlForSelection = (text: string): string => {
    const s = settingsStore.get().search;
    const tpl =
      s.engines.find((e) => e.id === s.activeId)?.urlTemplate ??
      'https://www.google.com/search?q={query}';
    return tpl.replace('{query}', encodeURIComponent(text));
  };
  // M13 hotfix (codex review): shell.openExternal hands the URL to the OS's
  // protocol handler. Don't forward `javascript:`, `file:`, custom-scheme,
  // or malformed URLs from page-controlled context-menu params. http/https
  // only — guard implemented in src/main/safe-external.ts (pure, tested).
  const openExternalSafe = (url: string): void => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  };
  viewManager.setContextMenuDeps({
    openInSystemBrowser: openExternalSafe,
    openInNewTab: (url) => { viewManager.createTab(url); },
    copyToClipboard: (text) => { clipboard.writeText(text); },
    searchSelection: (text) => { viewManager.createTab(buildSearchUrlForSelection(text)); },
    viewSource: (url) => { viewManager.createTab(`view-source:${url}`); },
    navigateActive: (a) => {
      if (a === 'back') viewManager.goBackActive();
      else if (a === 'forward') viewManager.goForwardActive();
      else viewManager.reloadActive();
    },
    canGoBack: false,
    canGoForward: false,
    get activeSearchEngineName(): string {
      const s = settingsStore.get().search;
      return s.engines.find((e) => e.id === s.activeId)?.name ?? 'Google';
    },
  });

  // 2d. M13 TabCycler — replaces the old CmdOrCtrl+Tab "toggle drawer" accelerator.
  // Attaches before-input-event on the host renderer + every tab so whichever
  // wc has focus drives the cycle. Ctrl release is NOT auto-detected (Electron
  // unreliable on Windows); drawer dismisses via closeDrawer in the renderer
  // (outside-click / tab selection) or win.blur below.
  //
  // After each activation we re-focus chrome's wc. Two reasons:
  //   1) Without this, the newly-active tab's WebContentsView captures keyboard
  //      focus. Subsequent Ctrl+Tab keystrokes get dispatched to that tab's wc;
  //      on about:blank pages (no focusable element) Chromium may not deliver
  //      before-input-event at all, so the cycler stops responding ("stuck after
  //      one press").
  //   2) The same focus capture would also fire `wc.on('focus')` below → the
  //      tabFocused IPC → renderer's closeDrawer → cycle:end → drawer closes
  //      mid-cycle. Keeping focus on chrome avoids this feedback loop.
  const refocusChrome = (): void => {
    if (!win.isDestroyed()) win.webContents.focus();
  };
  const cycler = new TabCycler({
    activateNext: () => { viewManager.activateRelativeTab(+1); refocusChrome(); },
    activatePrev: () => { viewManager.activateRelativeTab(-1); refocusChrome(); },
    broadcastCycleState: (active) => {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.cycleState, { active });
    },
  });
  cycler.attach(win.webContents);
  viewManager.onTabAttach((wc) => {
    cycler.attach(wc);
    // M13 hotfix: when any tab wc gets focus (typically from a click on the
    // page area), broadcast so the renderer can close any open chrome drawer.
    // Replaces the suppression trick that used to hide the page while a
    // drawer was open.
    wc.on('focus', () => {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.tabFocused, {});
    });
  });
  win.on('blur', () => cycler.end());
  // M13: renderer-driven cycle end. The renderer's closeDrawer (outside-
  // click, tab selection) sends this IPC so a Ctrl+Tab-opened drawer
  // dismisses the same way as a mouse-opened one. There is no automatic
  // Ctrl-release detection — Electron's standalone modifier keyUp via
  // before-input-event is unreliable on Windows. Mouse dismiss is the only
  // exit path beyond win.blur above.
  ipcMain.on(IpcChannels.cycleEnd, () => cycler.end());
  win.once('closed', () => {
    ipcMain.removeAllListeners(IpcChannels.cycleEnd);
  });
  // Expose for E2E test hooks (registered later in the SIDEBROWSER_E2E block).
  // CDP-dispatched keyboard events from Playwright bypass Electron's
  // before-input-event, so direct-trigger is the only way to exercise cycle
  // behavior in E2E.
  const e2eCyclerTrigger = (direction: 1 | -1): void => {
    viewManager.activateRelativeTab(direction);
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.cycleState, { active: true });
  };
  const e2eCyclerEnd = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.cycleState, { active: false });
  };

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

  // M13: clear OS title text while dimmed (Alt+Tab tooltip / taskbar hover
  // / window title bar all show no string). Restored on dim clear.
  const APP_TITLE = 'sidebrowser';

  const edgeDock = new EdgeDock({
    setWindowX: (x) => { const b = win.getBounds(); win.setBounds({ ...b, x: Math.round(x) }); },
    getWindowBounds: () => win.getBounds(),
    applyDim: () => {
      const wc = viewManager.getActiveWebContents();
      if (wc) void dim.apply(wc, settingsStore.get().dim);
      if (!win.isDestroyed()) win.setTitle('');
    },
    clearDim: () => {
      void dim.clear();
      if (!win.isDestroyed()) win.setTitle(APP_TITLE);
    },
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
        windowWidth: win.getBounds().width,
        enabled: s.edgeDock.enabled,
      };
    },
  });

  app.on('second-instance', () => {
    handleSecondInstance({
      isDestroyed: () => win.isDestroyed(),
      isMinimized: () => win.isMinimized(),
      restore: () => win.restore(),
      show: () => win.show(),
      focus: () => win.focus(),
      forceRevealIfHidden: () => edgeDock.forceRevealIfHidden(),
    });
  });

  ipcMain.handle(IpcChannels.nativeThemeGet, () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  }));

  const onNativeThemeUpdated = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.nativeThemeUpdated, {
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      });
    }
  };
  nativeTheme.on('updated', onNativeThemeUpdated);

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

  // 6. Live-apply fan-out. Fires on every settingsStore.update(). Spec §7 +
  // plan §Task 8 live-apply matrix: dim (restyle if active), mouse-leave
  // delay (swap via setDelayMs), window resize only on preset CHANGE (M9:
  // decoupled from runtime bounds so user drag-resize is not reverted), and
  // the renderer broadcast. EdgeDock config is a getter — it picks up fresh
  // values on its next dispatch without explicit poke.
  let lastPreset = settingsStore.get().window.preset;
  settingsStore.onChanged((settings) => {
    if (dim.isActive) void dim.restyle(settings.dim);
    watcher.setDelayMs(settings.mouseLeave.delayMs);
    if (settings.window.preset !== lastPreset) {
      lastPreset = settings.window.preset;
      const b = win.getBounds();
      if (b.width !== settings.window.width || b.height !== settings.window.height) {
        win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
      }
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
      requestWindowClose: () => win.close(),
      getIsWindowVisible: () => !win.isDestroyed() && win.isVisible(),
      // M11 zoom hooks.
      getActiveZoomFactor: (): number => viewManager.getActiveWebContents()?.getZoomFactor() ?? 1.0,
      emitZoomChange: (dir: 'in' | 'out'): void => {
        const wc = viewManager.getActiveWebContents();
        if (wc) wc.emit('zoom-changed', null, dir);
      },
      triggerResetZoom: (): void => { viewManager.resetActiveZoom(); },
      // M12 history hooks.
      seedHistory: (entries: HistoryEntry[]): void => historyStore.seed(entries),
      getHistoryAll: (): HistoryEntry[] => historyStore.all(),
      // M13 cycle hooks. CDP keyboard events bypass before-input-event in
      // Playwright; these mirror what TabCycler would do so E2E can exercise
      // the cycle + drawer integration end-to-end.
      triggerCycle: (direction: 1 | -1): void => e2eCyclerTrigger(direction),
      endCycle: (): void => e2eCyclerEnd(),
      // M13 chrome-dim assertion hook.
      getWindowTitle: (): string => (win.isDestroyed() ? '' : win.getTitle()),
      // M13 context-menu hook. Runs the same template builder ViewManager
      // would for a real context-menu event, returning labels in order so the
      // spec can assert the menu structure without dealing with the native
      // popup menu (which Playwright cannot query).
      simulateContextMenu: (
        wc: Electron.WebContents,
        params: { linkURL?: string; selectionText?: string },
      ): string[] => {
        const tpl = buildContextMenuTemplateForTest(
          { linkURL: params.linkURL ?? '', selectionText: params.selectionText ?? '' } as Electron.ContextMenuParams,
          {
            openInSystemBrowser: () => {},
            openInNewTab: () => {},
            copyToClipboard: () => {},
            searchSelection: () => {},
            viewSource: () => {},
            navigateActive: () => {},
            canGoBack: true,
            canGoForward: true,
            activeSearchEngineName: settingsStore.get().search.engines.find((e) =>
              e.id === settingsStore.get().search.activeId,
            )?.name ?? 'Google',
          },
          wc.getURL(),
        );
        return tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));
      },
    };
  } else {
    watcher.start();
  }
  win.once('closed', () => {
    watcher.stop();
    screen.removeListener('display-metrics-changed', onDisplayChanged);
    screen.removeListener('display-removed', onDisplayChanged);
    nativeTheme.off('updated', onNativeThemeUpdated);
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
      }, historyRecorder);
      registerIpcRouter(newWin, newViewManager, settingsStore, historyStore);
      newWin.webContents.once('did-finish-load', () => {
        newViewManager.createTab('about:blank');
      });
    }
  });

  // 9. Before-quit: flush both bounds debounce and tab-save debounce so the
  // last rect/tab-state mutation always hits disk.
  app.on('before-quit', () => {
    boundsPersister.flush();
    saver.flush();
    historyStore.flush();
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
