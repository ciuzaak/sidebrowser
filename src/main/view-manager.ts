import { WebContentsView, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { nanoid } from 'nanoid';
import { getPersistentSession } from './session-manager';
import { desktopUa } from './user-agents';
import { sanitizeUrl } from './url-validator';
import {
  applyMobileEmulation,
  removeMobileEmulation,
  attachCdpEmulation,
  detachCdpEmulation,
  parseUaForMetadata,
  type MobileRequestIdentity,
} from './mobile-emulation';
import type { Tab, TabsSnapshot } from '@shared/types';
import { makeEmptyTab } from '@shared/types';
import type { HistoryRecorder } from './history-recorder';
import {
  buildContextMenuTemplate,
  type ContextMenuBaseDeps,
  type ContextMenuDeps,
  type EditCommand,
} from './context-menu';
import { computeViewLayout } from './view-layout';
import { effectiveMuted } from './audio';
import { pickTabsToDiscard } from './tab-discard';
import { decideWindowOpen, popupSizeFromFeatures } from './window-open';
import { isFragmentOnlyChange, storableFavicon } from './history-filter';
import {
  buildHistorySnapshot,
  snapshotNavState,
  type HistorySnapshot,
} from './tab-history';

// Lazy CommonJS bridge for runtime-only Electron APIs (`Menu`, `screen`) —
// keeps non-Electron contexts (vitest importing the pure free functions in
// this module) free of them. Same pattern as keyboard-shortcuts.ts.
const requireCjs = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// History recorder wiring — M12 Task 5, M16 SPA navigations
// ---------------------------------------------------------------------------

/**
 * Bind history-recording listeners onto a webContents. Returns a detach
 * closure that removes them. Kept as a free function so it is unit-testable
 * with a fake EventEmitter — no BrowserWindow / WebContentsView required.
 *
 * `getCurrentUrl` is a closure (not a snapshot) because page-title-updated
 * fires AFTER did-navigate has already updated the tab state — by the time
 * the title arrives, the URL we want is the freshly-set one.
 *
 * M16: main-frame `did-navigate-in-page` (SPA pushState routes) is recorded
 * too, except fragment-only changes (`#section` jumps). Because ViewManager
 * also updates `tab.url` on those navigations, a title arriving after an SPA
 * route change now patches the right history entry. Oversized `data:`
 * favicons are not stored.
 *
 * `recorder = null` is a valid no-op binding (used in tests + future
 * "history disabled" config paths).
 */
export function bindHistoryRecorderEvents(
  tabId: string,
  wc: Electron.WebContents,
  recorder: HistoryRecorder | null,
  getCurrentUrl: () => string,
): () => void {
  if (recorder === null) return () => {};

  let lastRecorded = '';
  const onNavigate = (_e: Electron.Event, url: string): void => {
    lastRecorded = url;
    recorder.recordNavigation(tabId, url);
  };
  const onNavigateInPage = (_e: Electron.Event, url: string, isMainFrame: boolean): void => {
    if (!isMainFrame) return;
    if (isFragmentOnlyChange(lastRecorded, url)) return;
    lastRecorded = url;
    recorder.recordNavigation(tabId, url);
  };
  const onTitle = (_e: Electron.Event, title: string): void => {
    recorder.patchTitle(getCurrentUrl(), title);
  };
  const onFavicon = (_e: Electron.Event, favicons: string[]): void => {
    recorder.patchFavicon(getCurrentUrl(), storableFavicon(favicons[0] ?? null));
  };
  const onFailLoad = (
    _e: Electron.Event,
    errorCode: number,
    _desc: string,
    _validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame) return;
    if (errorCode === -3) return;     // ABORTED — not a real failure
    recorder.revokeFailed(tabId);
  };

  wc.on('did-navigate', onNavigate);
  wc.on('did-navigate-in-page', onNavigateInPage);
  wc.on('page-title-updated', onTitle);
  wc.on('page-favicon-updated', onFavicon);
  wc.on('did-fail-load', onFailLoad);

  return () => {
    wc.off('did-navigate', onNavigate);
    wc.off('did-navigate-in-page', onNavigateInPage);
    wc.off('page-title-updated', onTitle);
    wc.off('page-favicon-updated', onFavicon);
    wc.off('did-fail-load', onFailLoad);
  };
}

// ---------------------------------------------------------------------------
// Zoom helpers — M11 Task 8
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

/**
 * Pure helper for zoom steps. Computed step bounded by [0.5, 3.0] and rounded
 * to whole percent so repeated steps don't accumulate float drift.
 */
export function nextZoomFactor(current: number, dir: 'in' | 'out'): number {
  const delta = dir === 'in' ? +ZOOM_STEP : -ZOOM_STEP;
  const next = Math.round((current + delta) * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

// ---------------------------------------------------------------------------
// Tab cycling — M13 Task 3
// ---------------------------------------------------------------------------

/**
 * Pure index math for Ctrl+Tab cycling. Returns -1 if `order` is empty or
 * `activeId` is not found. With a single tab, returns 0 so callers can no-op
 * via id equality (current === order[0]).
 */
export function nextRelativeIndex(
  order: readonly string[],
  activeId: string,
  delta: 1 | -1,
): number {
  if (order.length === 0) return -1;
  const idx = order.indexOf(activeId);
  if (idx === -1) return -1;
  const N = order.length;
  return ((idx + delta) % N + N) % N;
}

/**
 * Tab to activate after closing `closingId` (M16): the right-hand neighbour,
 * else the left-hand one, else null.
 */
export function neighbourAfterClose(order: readonly string[], closingId: string): string | null {
  const idx = order.indexOf(closingId);
  if (idx === -1) return order[order.length - 1] ?? null;
  return order[idx + 1] ?? order[idx - 1] ?? null;
}

// ---------------------------------------------------------------------------

/**
 * Getter closure the main bootstrap injects so ViewManager can read live
 * browsing defaults from SettingsStore without holding a direct reference.
 */
export type BrowsingDefaultsGetter = () => {
  defaultIsMobile: boolean;
  mobileUserAgent: string;
  /** M16: auto-mute while the window is hidden at the screen edge. */
  muteWhenHidden: boolean;
};

/** Options for createTab (M16). Everything is optional. */
export interface CreateTabOptions {
  /** Persisted id (restore path); fresh nanoid otherwise. */
  id?: string;
  /** Defaults to settings.browsing.defaultIsMobile. */
  isMobile?: boolean;
  /** Activate the new tab (default true). */
  activate?: boolean;
  /** Create the page now (default true). false → unloaded placeholder. */
  load?: boolean;
  title?: string;
  favicon?: string | null;
  /** Back/forward stack restored via navigationHistory.restore when the page is created. */
  history?: HistorySnapshot | null;
}

/** One entry of the Ctrl+Shift+T stack. */
interface ClosedTab {
  url: string;
  isMobile: boolean;
  title: string;
  favicon: string | null;
  history: HistorySnapshot | null;
}

const CLOSED_STACK_MAX = 10;

type TabUpdatedListener = (tab: Tab) => void;
type SnapshotListener = (snapshot: TabsSnapshot) => void;

interface ManagedTab {
  tab: Tab;
  /** null while the tab is unloaded (lazy restore / auto-unload). */
  view: WebContentsView | null;
  /** Detachable webContents listener cleanup; null while unloaded. */
  detach: (() => void) | null;
  /** Back/forward stack to restore when the page is (re)created. */
  history: HistorySnapshot | null;
  /** epoch ms the tab last stopped (or started) being the active tab. */
  lastActiveAt: number;
  /** Zoom factor (1 = 100%). Survives unload; not persisted across restarts. */
  zoom: number;
}

/** Persistable shape of one tab — see tab-persistence.ts. */
export interface SerializedTab {
  id: string;
  url: string;
  isMobile: boolean;
  title: string;
  favicon: string | null;
  history: HistorySnapshot | null;
}

/**
 * Multi-tab web view controller.
 *
 * Each loaded tab owns one WebContentsView attached to the host BrowserWindow,
 * all sharing the persistent session. Every view gets the page bounds; only
 * the active one is visible (see computeViewLayout). M16: tabs may be
 * unloaded (no view) — restored lazily on activation from a history snapshot.
 */
export class ViewManager {
  private readonly window: BrowserWindow;
  private readonly tabs = new Map<string, ManagedTab>();
  /** webContents id → tab id, for request-header routing (M16). */
  private readonly wcToTab = new Map<number, string>();
  private activeId: string | null = null;
  private chromeHeightPx = 0;
  /** M17: top overlay stack height — offsets (never resizes) the active view. */
  private topInsetPx = 0;
  private suppressed = false;
  /** M16: edge-dock reports the window fully hidden at the screen edge. */
  private windowHidden = false;
  /** M16: tab currently in in-window HTML fullscreen. */
  private fullscreenTabId: string | null = null;
  /** M16: Ctrl+Shift+T stack (most recent last). */
  private readonly closedTabs: ClosedTab[] = [];
  /** M16: cached mobile request identity per UA string. */
  private identityCache: MobileRequestIdentity | null = null;
  /** Web context-menu deps (M13). Wired via setContextMenuDeps() after construction. */
  private contextMenuDeps: ContextMenuBaseDeps | null = null;
  /** Tab attach listeners (M13). Used by TabCycler to install before-input-event on every tab. */
  private readonly tabAttachListeners = new Set<(wc: Electron.WebContents) => void>();
  private readonly tabUpdatedListeners = new Set<TabUpdatedListener>();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly getBrowsingDefaults: BrowsingDefaultsGetter;
  private readonly recorder: HistoryRecorder | null;

  /**
   * Trailing-edge debounce timer for re-applying mobile emulation after a
   * resize. Window 'resize' fires many times during a drag; the CDP
   * `setDeviceMetricsOverride` round-trip is not free, so we coalesce.
   */
  private emulationReapplyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stored resize handler so it can be removed in destroy(). */
  private readonly onWindowResize = (): void => {
    // Bounds must track the window immediately (otherwise the active view
    // visibly lags during drag); emulation reapply can wait for the drag to
    // settle.
    this.applyBounds();
    this.scheduleEmulationReapply();
  };

  constructor(
    window: BrowserWindow,
    getBrowsingDefaults: BrowsingDefaultsGetter,
    recorder: HistoryRecorder | null = null,
  ) {
    this.window = window;
    this.getBrowsingDefaults = getBrowsingDefaults;
    this.recorder = recorder;
    window.on('resize', this.onWindowResize);
    window.once('ready-to-show', () => this.applyBounds());
  }

  /**
   * Subscribe to per-tab field updates. Returns an unsubscribe function.
   * Multiple subscribers (IpcRouter broadcast + persistence saver) coexist.
   */
  onTabUpdated(listener: TabUpdatedListener): () => void {
    this.tabUpdatedListeners.add(listener);
    return () => this.tabUpdatedListeners.delete(listener);
  }

  /**
   * Subscribe to full tab-set snapshots. Listener is invoked immediately with
   * the current snapshot upon registration. Returns an unsubscribe function.
   */
  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    try {
      listener(this.snapshot());
    } catch (err) {
      console.error('[sidebrowser] onSnapshot initial listener call threw:', err);
    }
    return () => this.snapshotListeners.delete(listener);
  }

  snapshot(): TabsSnapshot {
    return {
      tabs: Array.from(this.tabs.values()).map((m) => ({ ...m.tab })),
      activeId: this.activeId,
    };
  }

  setChromeHeight(heightPx: number): void {
    const clamped = Math.max(0, Math.round(heightPx));
    if (clamped === this.chromeHeightPx) return;
    this.chromeHeightPx = clamped;
    this.applyBounds();
    // Chrome height affects the effective webview height, so any mobile tab's
    // emulated viewport must follow. Fires at most a few times per session
    // (TopBar mount + occasional layout reflows) — no debouncing needed.
    this.reapplyMobileEmulationAll();
  }

  /**
   * Create a tab and return the full Tab object. By default the page is
   * created and the tab activated; M16 options allow background tabs
   * (`activate: false`) and unloaded placeholders (`load: false`, restore
   * path) that create their page on first activation.
   */
  createTab(url: string = 'about:blank', opts: CreateTabOptions = {}): Tab {
    // Whitelist guard (spec §10). Covers user-initiated createTab via IPC, the
    // window-open path, AND the seedTabs replay path, so persisted
    // javascript:/data:/chrome: URLs can't reach the renderer.
    url = sanitizeUrl(url);
    const id = opts.id ?? nanoid();
    const isMobile = opts.isMobile ?? this.getBrowsingDefaults().defaultIsMobile;
    const history = opts.history ?? null;
    const tab: Tab = {
      ...makeEmptyTab(id, url, isMobile),
      title: opts.title ?? '',
      favicon: opts.favicon ?? null,
      loaded: false,
      ...snapshotNavState(history),
    };
    const managed: ManagedTab = {
      tab,
      view: null,
      detach: null,
      history,
      lastActiveAt: Date.now(),
      zoom: 1,
    };
    this.tabs.set(id, managed);

    const activate = opts.activate ?? true;
    if (activate) {
      this.activateTab(id); // creates the page
    } else {
      if (opts.load ?? true) this.ensureView(id);
      this.emitSnapshot();
    }
    return { ...managed.tab };
  }

  closeTab(id: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    this.recorder?.forgetTab(id);

    // M16: remember it for Ctrl+Shift+T (skip blank tabs with no history).
    const history = managed.view
      ? this.captureHistory(managed.view.webContents)
      : managed.history;
    if (managed.tab.url !== 'about:blank' || (history !== null && history.entries.length > 1)) {
      this.closedTabs.push({
        url: managed.tab.url,
        isMobile: managed.tab.isMobile,
        title: managed.tab.title,
        favicon: managed.tab.favicon,
        history,
      });
      if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
    }

    const neighbour = neighbourAfterClose(Array.from(this.tabs.keys()), id);
    if (this.fullscreenTabId === id) this.fullscreenTabId = null;
    this.destroyView(id, managed);
    this.tabs.delete(id);

    if (this.tabs.size === 0) {
      // Spec §10: never leave the user with zero tabs — auto-seed a blank.
      // createTab activates the new tab and emits the snapshot itself.
      this.activeId = null;
      this.createTab('about:blank');
      return;
    }
    if (this.activeId === id) {
      this.activeId = null;
      if (neighbour !== null) {
        this.activateTab(neighbour); // emits the snapshot
        return;
      }
    }
    this.emitSnapshot();
  }

  /** M16 Ctrl+Shift+T: reopen the most recently closed tab (with its history). */
  reopenClosedTab(): boolean {
    const closed = this.closedTabs.pop();
    if (!closed) return false;
    this.createTab(closed.url, {
      isMobile: closed.isMobile,
      title: closed.title,
      favicon: closed.favicon,
      history: closed.history,
    });
    return true;
  }

  activateTab(id: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    if (this.activeId === id) return;
    const now = Date.now();
    const prevId = this.activeId;
    if (prevId !== null) {
      const prev = this.tabs.get(prevId);
      if (prev) {
        prev.lastActiveAt = now;
        if (this.fullscreenTabId === prevId) this.exitFullscreen(prev);
      }
    }
    this.activeId = id;
    managed.lastActiveAt = now;
    if (!managed.view) this.ensureView(id);
    this.applyBounds();
    this.emitSnapshot();
  }

  /**
   * Cycle to the next/prev tab by insertion order (Map iteration order).
   * No-op when no active tab, fewer than 2 tabs, or activeId missing from the
   * order. M13 Task 3 — used by TabCycler.
   */
  activateRelativeTab(delta: 1 | -1): void {
    if (!this.activeId) return;
    const order = Array.from(this.tabs.keys());
    const next = nextRelativeIndex(order, this.activeId, delta);
    if (next === -1) return;
    const nextId = order[next];
    if (nextId === this.activeId) return;
    this.activateTab(nextId);
  }

  /** Wire the M13 web context-menu deps. Called once during bootstrap. */
  setContextMenuDeps(deps: ContextMenuBaseDeps): void {
    this.contextMenuDeps = deps;
  }

  /**
   * Subscribe to per-tab WebContents attachment (M13). Fires whenever a tab's
   * page is created (createTab, lazy restore, reload after unload). Used by
   * TabCycler to install before-input-event on every tab. Returns an
   * unsubscribe function. Does NOT fire retroactively.
   */
  onTabAttach(listener: (wc: Electron.WebContents) => void): () => void {
    this.tabAttachListeners.add(listener);
    return () => this.tabAttachListeners.delete(listener);
  }

  private emitTabAttach(wc: Electron.WebContents): void {
    for (const l of this.tabAttachListeners) {
      try { l(wc); } catch (err) {
        console.error('[sidebrowser] onTabAttach listener threw:', err);
      }
    }
  }

  navigate(id: string, url: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    // Whitelist guard — spec §10. Final gate even though the address-bar
    // `normalizeUrlInput` already ran in shared/url.ts; keeps javascript:/data:
    // out of the renderer regardless of entry point.
    url = sanitizeUrl(url);
    this.updateTab(id, { url, isLoading: true });
    if (!managed.view) {
      // Unloaded tab: drop the stale history and create the page at `url`.
      managed.history = null;
      this.ensureView(id);
      return;
    }
    void managed.view.webContents.loadURL(url).catch((err: unknown) => {
      console.error('[sidebrowser] navigate loadURL failed:', err);
    });
  }

  goBack(id: string): void {
    const wc = this.tabs.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  goForward(id: string): void {
    const wc = this.tabs.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  reload(id: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    if (!managed.view) {
      this.ensureView(id);
      return;
    }
    if (managed.tab.crashed !== null) this.updateTab(id, { crashed: null });
    managed.view.webContents.reload();
  }
  /** M17: Stop button in the address pill. */
  stop(id: string): void {
    this.tabs.get(id)?.view?.webContents.stop();
  }

  /**
   * Toggle a tab between mobile and desktop UA. Per spec §5.4 + M10 design §6:
   *   1. apply / remove device emulation so Chromium internal mobile flag flips
   *      (touch / pointer:coarse / hover:none / userAgentData.mobile). Safe to call
   *      synchronously here — wc has already navigated, renderer is alive.
   *   2. setUserAgent so the next request uses the new UA
   *   3. updateTab so the renderer reflects the new isMobile (button state) immediately
   *      and clears the stale favicon (page-favicon-updated will re-populate post-reload)
   *   4. reloadIgnoringCache so the page re-fetches under the new UA + Client Hints
   *      without serving a cached response tied to the previous UA
   */
  setMobile(id: string, isMobile: boolean): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    if (!managed.view) {
      // Unloaded: just flip the flag; the page is created with the right UA.
      this.updateTab(id, { isMobile, favicon: null });
      return;
    }
    const wc = managed.view.webContents;
    const defaults = this.getBrowsingDefaults();
    if (isMobile) {
      const size = this.webviewSize();
      wc.setZoomFactor(1); // mobile zoom goes through CDP metrics instead
      applyMobileEmulation(wc, size);
      void attachCdpEmulation(wc, parseUaForMetadata(defaults.mobileUserAgent), defaults.mobileUserAgent, size, managed.zoom);
    } else {
      detachCdpEmulation(wc);
      removeMobileEmulation(wc);
    }
    wc.setUserAgent(isMobile ? defaults.mobileUserAgent : desktopUa());
    this.updateTab(id, { isMobile, favicon: null });
    wc.reloadIgnoringCache();
  }

  /** M16: user mute toggle (TabDrawer speaker button). */
  setMuted(id: string, muted: boolean): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    this.updateTab(id, { muted });
    this.applyAudio(managed);
  }

  /** M16: re-evaluate every tab's effective mute (settings changed). */
  refreshAudio(): void {
    for (const m of this.tabs.values()) this.applyAudio(m);
  }

  /**
   * M16: edge-dock reports the window fully hidden at the screen edge (true
   * after the hide animation, false as soon as a reveal starts). Hides the
   * active page (stops rendering) and applies auto-mute.
   */
  setWindowHidden(hidden: boolean): void {
    if (this.windowHidden === hidden) return;
    this.windowHidden = hidden;
    this.applyBounds();
    this.refreshAudio();
  }

  /** Persistable shape — see tab-persistence.ts. */
  serializeForPersistence(): { tabs: SerializedTab[]; activeId: string } | null {
    if (this.tabs.size === 0 || !this.activeId) return null;
    return {
      tabs: Array.from(this.tabs.values()).map((m) => ({
        id: m.tab.id,
        url: m.tab.url,
        isMobile: m.tab.isMobile,
        title: m.tab.title,
        favicon: m.tab.favicon,
        history: m.view ? this.captureHistory(m.view.webContents) : m.history,
      })),
      activeId: this.activeId,
    };
  }

  getActiveWebContents(): Electron.WebContents | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId)?.view?.webContents ?? null;
  }

  /** Active tab id (null before the first tab exists). */
  getActiveId(): string | null {
    return this.activeId;
  }

  // ------- Active-tab convenience wrappers (spec §15 keyboard shortcuts) ----
  // Thin delegations so callers (the hidden Application Menu handlers) don't
  // need to know/query the active tab's id.

  /** Ctrl+W handler. Closes the active tab; ViewManager auto-seeds a blank when the set becomes empty. */
  closeActiveTab(): void {
    if (this.activeId) this.closeTab(this.activeId);
  }

  /** Ctrl+R / F5 handler. No-op when no tab is active. */
  reloadActive(): void {
    if (this.activeId) this.reload(this.activeId);
  }

  /** Alt+Left handler. Delegates to `goBack(id)` so the can-go-back guard applies. */
  goBackActive(): void {
    if (this.activeId) this.goBack(this.activeId);
  }

  /** Alt+Right handler. Delegates to `goForward(id)`. */
  goForwardActive(): void {
    if (this.activeId) this.goForward(this.activeId);
  }

  /** F12 handler. Toggles the active WebContents' DevTools; no-op when no tab is active. */
  toggleDevToolsActive(): void {
    this.getActiveWebContents()?.toggleDevTools();
  }

  /** Ctrl+0 handler. Resets the active tab's zoom to 100%. */
  resetActiveZoom(): void {
    if (this.activeId) this.setZoom(this.activeId, 1);
  }

  /** M16 Ctrl+= / Ctrl+- / context menu. */
  zoomActive(action: 'in' | 'out' | 'reset'): void {
    if (!this.activeId) return;
    const m = this.tabs.get(this.activeId);
    if (!m) return;
    this.setZoom(this.activeId, action === 'reset' ? 1 : nextZoomFactor(m.zoom, action));
  }

  /** Zoom factor of a tab (1 = 100%). */
  getZoom(id: string): number {
    return this.tabs.get(id)?.zoom ?? 1;
  }

  /**
   * Set a tab's zoom. Desktop tabs use Chromium's zoom factor; mobile tabs
   * use CDP device metrics (see mobile-zoom.ts) because device emulation
   * ignores setZoomFactor.
   */
  setZoom(id: string, zoom: number): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    managed.zoom = zoom;
    const wc = managed.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (managed.tab.isMobile) {
      const ua = this.getBrowsingDefaults().mobileUserAgent;
      void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, this.webviewSize(), zoom);
    } else {
      wc.setZoomFactor(zoom);
    }
  }

  /**
   * Toggle the "suppressed" flag. While suppressed, the active tab's view is
   * hidden via `View.setVisible(false)` so a renderer-layer overlay (settings
   * drawer, Spotlight, NewTab, crash overlay) can paint over the
   * WebContentsView layer. Bounds are unchanged, so the page does not
   * reflow (M17). Idempotent.
   */
  setSuppressed(v: boolean): void {
    if (this.suppressed === v) return;
    this.suppressed = v;
    this.applyBounds();
  }

  /**
   * M17: top overlay stack height. Offsets the active view down without
   * changing its size (see computeViewLayout). Unlike setChromeHeight this
   * does NOT reapply mobile emulation — the emulated viewport is unchanged.
   */
  setTopInset(px: number): void {
    const clamped = Math.max(0, Math.round(px));
    if (clamped === this.topInsetPx) return;
    this.topInsetPx = clamped;
    this.applyBounds();
  }

  /**
   * M17: half-resolution JPEG snapshot of the active page for the Spotlight
   * backdrop. Null when there is nothing visible to capture (no active tab,
   * already suppressed, empty image) or capture fails.
   */
  async captureActiveForBackdrop(): Promise<string | null> {
    const wc = this.getActiveWebContents();
    if (!wc || wc.isDestroyed() || this.suppressed) return null;
    try {
      const img = await wc.capturePage();
      if (img.isEmpty()) return null;
      const width = Math.max(1, Math.round(img.getSize().width / 2));
      const jpeg = img.resize({ width, quality: 'good' }).toJPEG(70);
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err) {
      console.error('[sidebrowser] captureActiveForBackdrop failed:', err);
      return null;
    }
  }

  /**
   * M16 auto-unload: unload background tabs idle for `minutes` (0 = never).
   * `busyWcIds` are webContents with an in-progress download. Returns the
   * unloaded tab ids.
   */
  discardInactive(now: number, minutes: number, busyWcIds: ReadonlySet<number> = new Set()): string[] {
    const ids = pickTabsToDiscard(
      Array.from(this.tabs.values()).map((m) => ({
        id: m.tab.id,
        active: m.tab.id === this.activeId,
        loaded: m.view !== null,
        audible: m.tab.audible,
        isLoading: m.tab.isLoading,
        crashed: m.tab.crashed,
        lastActiveAt: m.lastActiveAt,
        busy: m.view !== null && busyWcIds.has(m.view.webContents.id),
      })),
      now,
      minutes,
    );
    for (const id of ids) this.unloadTab(id);
    return ids;
  }

  /**
   * Unload a background tab: snapshot its history (with page state) and
   * close its page. The tab stays in the strip and restores on activation.
   */
  unloadTab(id: string): boolean {
    const managed = this.tabs.get(id);
    if (!managed?.view || id === this.activeId) return false;
    managed.history = this.captureHistory(managed.view.webContents);
    this.destroyView(id, managed);
    this.updateTab(id, {
      loaded: false,
      isLoading: false,
      audible: false,
      crashed: null,
      ...snapshotNavState(managed.history),
    });
    return true;
  }

  /** E2E hook: whether the active tab's view is currently drawn. */
  getActiveViewVisibleForTest(): boolean | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId)?.view?.getVisible() ?? null;
  }

  /**
   * E2E hook: returns the active tab's view bounds, or null if no active tab.
   * Used by E2E specs to assert that suppression keeps the bounds (M17) and
   * that the top inset offsets y without changing height.
   */
  getActiveBoundsForTest(): { x: number; y: number; width: number; height: number } | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId)?.view?.getBounds() ?? null;
  }

  /**
   * Lookup helper for installMobileHeaderRewriter (M10 Task 7; extended M15).
   *   null                  → desktop tab / not a tab (chrome renderer, popup): headers untouched
   *   MobileRequestIdentity → mobile tab: rewrite User-Agent + Sec-CH-UA(-Mobile/Platform/…)
   *
   * Runs for every network request on the main thread: M16 uses a
   * wcId → tab map and caches the parsed identity per UA string.
   */
  getMobileEmulationState(wcId: number): MobileRequestIdentity | null {
    const tabId = this.wcToTab.get(wcId);
    if (tabId === undefined) return null;
    if (!this.tabs.get(tabId)?.tab.isMobile) return null;
    const ua = this.getBrowsingDefaults().mobileUserAgent;
    if (this.identityCache?.userAgent !== ua) {
      this.identityCache = { userAgent: ua, metadata: parseUaForMetadata(ua) };
    }
    return this.identityCache;
  }

  /** Tab id owning a webContents (M16 downloads attribution). */
  getTabIdForWebContents(wcId: number): string | null {
    return this.wcToTab.get(wcId) ?? null;
  }

  getWebContentsByUrlSubstring(substring: string): Electron.WebContents | null {
    for (const managed of this.tabs.values()) {
      if (managed.view && managed.tab.url.includes(substring)) return managed.view.webContents;
    }
    return null;
  }

  destroy(): void {
    this.window.removeListener('resize', this.onWindowResize);
    if (this.emulationReapplyTimer) {
      clearTimeout(this.emulationReapplyTimer);
      this.emulationReapplyTimer = null;
    }
    for (const [id, managed] of this.tabs) this.destroyView(id, managed);
    this.tabs.clear();
    this.activeId = null;
  }

  // ---------- private ----------

  /**
   * Create the page for a tab (no-op if it already has one): view, UA,
   * mobile emulation, listeners, audio state, then restore its history or
   * load its URL.
   */
  private ensureView(id: string): void {
    const managed = this.tabs.get(id);
    if (!managed || managed.view) return;
    const defaults = this.getBrowsingDefaults();
    const view = new WebContentsView({
      webPreferences: {
        session: getPersistentSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // M16: HTML fullscreen fills the view; we grow the view to cover the
        // chrome instead of turning the side window OS-fullscreen.
        disableHtmlFullscreenWindowResize: true,
      },
    });
    this.window.contentView.addChildView(view);
    const wc = view.webContents;
    // Per spec §5.4: set UA before loading so the very first request uses the
    // right UA. desktopUa() reads app.userAgentFallback (post-whenReady).
    wc.setUserAgent(managed.tab.isMobile ? defaults.mobileUserAgent : desktopUa());
    // M10 / M10.5: three-layer mobile emulation (Electron device emulation +
    // CDP overrides here; Sec-CH-UA header rewrite in index.ts). Must defer
    // to 'did-start-loading': enableDeviceEmulation on a fresh webContents
    // deadlocks the main process (M10 Task 4 spike); CDP attach also needs
    // the renderer alive.
    if (managed.tab.isMobile) {
      wc.once('did-start-loading', () => {
        const size = this.webviewSize();
        applyMobileEmulation(wc, size);
        const ua = this.getBrowsingDefaults().mobileUserAgent;
        void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, size, managed.zoom);
      });
    }

    managed.view = view;
    managed.detach = this.attachWebContentsEvents(id, view);
    this.wcToTab.set(wc.id, id);
    this.applyAudio(managed);
    // M13: emit AFTER the tab is registered so listeners (e.g. TabCycler)
    // that may call back into ViewManager observe a consistent state.
    this.emitTabAttach(wc);
    this.updateTab(id, { loaded: true, crashed: null });
    this.applyBounds();

    // Intentionally not awaited: events update the tab as the load proceeds.
    const history = managed.history;
    managed.history = null;
    if (history !== null && history.entries.length > 0) {
      wc.navigationHistory
        .restore({ entries: history.entries, index: history.index })
        .catch((err: unknown) => {
          console.error('[sidebrowser] history restore failed:', err);
        });
    } else {
      void wc.loadURL(managed.tab.url).catch((err: unknown) => {
        console.error('[sidebrowser] loadURL failed:', err);
      });
    }
  }

  /** Close a tab's page (if any) and forget its webContents. */
  private destroyView(id: string, managed: ManagedTab): void {
    const view = managed.view;
    if (!view) return;
    managed.detach?.();
    managed.detach = null;
    managed.view = null;
    this.wcToTab.delete(view.webContents.id);
    this.recorder?.forgetTab(id);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private captureHistory(wc: Electron.WebContents): HistorySnapshot | null {
    if (wc.isDestroyed()) return null;
    try {
      return buildHistorySnapshot(
        wc.navigationHistory.getAllEntries(),
        wc.navigationHistory.getActiveIndex(),
      );
    } catch {
      return null;
    }
  }

  private applyAudio(managed: ManagedTab): void {
    const wc = managed.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.setAudioMuted(
      effectiveMuted(managed.tab.muted, this.windowHidden, this.getBrowsingDefaults().muteWhenHidden),
    );
  }

  private exitFullscreen(managed: ManagedTab): void {
    this.fullscreenTabId = null;
    const wc = managed.view?.webContents;
    if (wc && !wc.isDestroyed()) {
      void wc
        .executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true)
        .catch(() => {});
    }
    this.applyBounds();
    this.reapplyMobileEmulationAll();
  }

  /**
   * Effective webview pixel area = host window content bounds minus the
   * chrome (TopBar) height — or the whole content area while the active tab
   * is in in-window fullscreen (M16). This is what gets passed as
   * `screenSize` / `viewSize` to enableDeviceEmulation and as `width`/`height`
   * to the CDP `setDeviceMetricsOverride` — the emulated viewport must match
   * the actually-rendered region, otherwise `position: fixed; bottom: 0`
   * elements fall outside the visible area (M10 regression).
   *
   * Height clamped to ≥1 because 0 deadlocks enableDeviceEmulation on
   * Electron 41 (mobile-emulation spec §6.2).
   */
  private webviewSize(): { width: number; height: number } {
    // Race guard: WebContents events can arrive after the host window starts
    // destroying (shutdown / E2E teardown).
    if (this.window.isDestroyed()) return { width: 0, height: 1 };
    const { width, height } = this.window.getContentBounds();
    const fullscreen = this.fullscreenTabId !== null && this.fullscreenTabId === this.activeId;
    return { width, height: Math.max(1, height - (fullscreen ? 0 : this.chromeHeightPx)) };
  }

  /**
   * Re-issue mobile emulation (Electron `enableDeviceEmulation` + CDP
   * `setDeviceMetricsOverride`) for every loaded mobile tab against the
   * current `webviewSize()`. Called when the size that emulation depends on
   * changes. The CDP path is skipped on tabs without the debugger attached
   * (F12 DevTools holds the same channel exclusively).
   */
  private reapplyMobileEmulationAll(): void {
    const size = this.webviewSize();
    const ua = this.getBrowsingDefaults().mobileUserAgent;
    const meta = parseUaForMetadata(ua);
    for (const managed of this.tabs.values()) {
      if (!managed.tab.isMobile || !managed.view) continue;
      const wc = managed.view.webContents;
      if (wc.isDestroyed()) continue;
      applyMobileEmulation(wc, size);
      if (wc.debugger.isAttached()) {
        void attachCdpEmulation(wc, meta, ua, size, managed.zoom);
      }
    }
  }

  /**
   * Trailing-edge debounce: drag-resize fires 'resize' continuously, but
   * `setDeviceMetricsOverride` is a CDP round-trip; coalesce to one reapply
   * 150 ms after the last event.
   */
  private scheduleEmulationReapply(): void {
    if (this.emulationReapplyTimer) clearTimeout(this.emulationReapplyTimer);
    this.emulationReapplyTimer = setTimeout(() => {
      this.emulationReapplyTimer = null;
      this.reapplyMobileEmulationAll();
    }, 150);
  }

  private applyBounds(): void {
    // Race guard — see webviewSize() comment.
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    for (const [id, managed] of this.tabs) {
      if (!managed.view) continue;
      const isActive = id === this.activeId;
      const { bounds, visible } = computeViewLayout({
        contentWidth: width,
        contentHeight: height,
        chromeHeightPx: this.chromeHeightPx,
        topInsetPx: this.topInsetPx,
        suppressed: this.suppressed,
        isActive,
        windowHidden: this.windowHidden,
        fullscreen: isActive && this.fullscreenTabId === id,
      });
      managed.view.setBounds(bounds);
      managed.view.setVisible(visible);
    }
  }

  private emitSnapshot(): void {
    const snap = this.snapshot();
    for (const listener of this.snapshotListeners) {
      try {
        listener(snap);
      } catch (err) {
        console.error('[sidebrowser] onSnapshot listener threw:', err);
      }
    }
  }

  private updateTab(id: string, patch: Partial<Tab>): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    managed.tab = { ...managed.tab, ...patch };
    const tabCopy = { ...managed.tab };
    for (const listener of this.tabUpdatedListeners) {
      try {
        listener(tabCopy);
      } catch (err) {
        console.error('[sidebrowser] onTabUpdated listener threw:', err);
      }
    }
  }

  /** Popup windows for window.open-with-features (OAuth etc.) — M16. */
  private popupWindowOptions(features: string): Electron.BrowserWindowConstructorOptions {
    const { width, height } = popupSizeFromFeatures(features);
    const opts: Electron.BrowserWindowConstructorOptions = {
      width,
      height,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
    };
    if (!this.window.isDestroyed()) {
      try {
        const { screen } = requireCjs('electron') as { screen: Electron.Screen };
        const wa = screen.getDisplayMatching(this.window.getBounds()).workArea;
        opts.x = Math.round(wa.x + (wa.width - width) / 2);
        opts.y = Math.round(wa.y + (wa.height - height) / 2);
      } catch {
        // Let Electron place it.
      }
    }
    if (process.env['SIDEBROWSER_E2E'] === '1' && process.env['SIDEBROWSER_E2E_VISIBLE'] !== '1') {
      opts.show = false; // shown inactive + transparent in setupPopup (E2E quiet mode)
    }
    return opts;
  }

  private setupPopup(child: BrowserWindow): void {
    child.setAlwaysOnTop(true, 'screen-saver', 1);
    if (process.env['SIDEBROWSER_E2E'] === '1' && process.env['SIDEBROWSER_E2E_VISIBLE'] !== '1') {
      child.setOpacity(0);
      child.setIgnoreMouseEvents(true);
      child.setSkipTaskbar(true);
      child.showInactive();
    }
    // A popup's own window.open goes to a tab in the main window.
    child.webContents.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });
  }

  private attachWebContentsEvents(id: string, view: WebContentsView): () => void {
    const wc = view.webContents;

    const navState = (): Pick<Tab, 'canGoBack' | 'canGoForward'> => ({
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
    const onStart = (): void => this.updateTab(id, { isLoading: true, crashed: null });
    const onStop = (): void => this.updateTab(id, { isLoading: false, ...navState() });
    const onNavigate = (_e: Electron.Event, url: string): void => {
      this.updateTab(id, { url, ...navState() });
      const managed = this.tabs.get(id);
      if (!managed) return;
      // M10.5: re-send the CDP overrides on every fresh navigation —
      // 'ontouchstart' in window is fixed when the window object is created,
      // and cross-process navigations may not carry browser-side CDP state.
      // attachCdpEmulation is idempotent. M16: carries the tab's zoom.
      if (managed.tab.isMobile) {
        if (wc.debugger.isAttached()) {
          const ua = this.getBrowsingDefaults().mobileUserAgent;
          void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, this.webviewSize(), managed.zoom);
        }
      } else if (managed.zoom !== 1) {
        // M11: Chromium resets zoomFactor on navigation; reapply ours.
        wc.setZoomFactor(managed.zoom);
      }
    };
    const onNavigateInPage = (_e: Electron.Event, url: string, isMainFrame: boolean): void => {
      // Subframe in-page navigations must not change the tab URL.
      if (isMainFrame) this.updateTab(id, { url, ...navState() });
    };
    const onTitle = (_e: Electron.Event, title: string): void => this.updateTab(id, { title });
    // Electron's page-favicon-updated supplies all discovered <link rel=icon>
    // candidates in priority order; we take the first as spec §5.3 dictates.
    const onFavicon = (_e: Electron.Event, favicons: string[]): void =>
      this.updateTab(id, { favicon: favicons[0] ?? null });

    // M16: audio indicator.
    const onAudio = (e: Electron.Event<Electron.WebContentsAudioStateChangedEventParams>): void =>
      this.updateTab(id, { audible: e.audible });

    // M16: crash / hang recovery (overlay in the renderer).
    const onGone = (): void => {
      if (this.fullscreenTabId === id) {
        this.fullscreenTabId = null;
        this.applyBounds();
      }
      this.updateTab(id, { crashed: 'crashed', isLoading: false, audible: false });
    };
    const onUnresponsive = (): void => this.updateTab(id, { crashed: 'unresponsive' });
    const onResponsive = (): void => {
      if (this.tabs.get(id)?.tab.crashed === 'unresponsive') this.updateTab(id, { crashed: null });
    };

    // M16: in-window HTML fullscreen.
    const onEnterFullscreen = (): void => {
      if (id !== this.activeId) {
        void wc.executeJavaScript('document.exitFullscreen()', true).catch(() => {});
        return;
      }
      this.fullscreenTabId = id;
      this.applyBounds();
      this.reapplyMobileEmulationAll();
    };
    const onLeaveFullscreen = (): void => {
      if (this.fullscreenTabId !== id) return;
      this.fullscreenTabId = null;
      this.applyBounds();
      this.reapplyMobileEmulationAll();
    };

    // M10.5: F12 DevTools and our wc.debugger CDP attach are mutually
    // exclusive. Opening F12 detaches ours; closing it re-attaches for mobile
    // tabs (a reload is needed for the page to re-evaluate userAgentData /
    // media queries — accepted in design §16).
    const onDevtoolsOpened = (): void => {
      detachCdpEmulation(wc);
    };
    const onDevtoolsClosed = (): void => {
      const managed = this.tabs.get(id);
      if (managed?.tab.isMobile) {
        const ua = this.getBrowsingDefaults().mobileUserAgent;
        void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, this.webviewSize(), managed.zoom);
      }
    };

    // M13 + M16: web context menu. Per-event deps carry this tab's nav
    // history, zoom and webContents actions.
    const onContextMenu = (e: Electron.Event, params: Electron.ContextMenuParams): void => {
      if (!this.contextMenuDeps) return;
      e.preventDefault();
      const managed = this.tabs.get(id);
      const currentUrl = managed?.tab.url ?? '';
      const edit = (command: EditCommand): void => {
        switch (command) {
          case 'undo': wc.undo(); return;
          case 'redo': wc.redo(); return;
          case 'cut': wc.cut(); return;
          case 'copy': wc.copy(); return;
          case 'paste': wc.paste(); return;
          case 'pasteAndMatchStyle': wc.pasteAndMatchStyle(); return;
          case 'selectAll': wc.selectAll(); return;
        }
      };
      const deps: ContextMenuDeps = {
        ...this.contextMenuDeps,
        ...navState(),
        edit,
        replaceMisspelling: (word) => wc.replaceMisspelling(word),
        addToDictionary: (word) => { wc.session.addWordToSpellCheckerDictionary(word); },
        copyImageAt: (x, y) => wc.copyImageAt(x, y),
        saveUrl: (url) => wc.downloadURL(url),
        zoom: (action) => {
          const z = managed?.zoom ?? 1;
          this.setZoom(id, action === 'reset' ? 1 : nextZoomFactor(z, action));
        },
        zoomPercent: Math.round((managed?.zoom ?? 1) * 100),
      };
      const template = buildContextMenuTemplate(params, deps, currentUrl);
      const { Menu } = requireCjs('electron') as {
        Menu: { buildFromTemplate(t: Electron.MenuItemConstructorOptions[]): Electron.Menu };
      };
      Menu.buildFromTemplate(template).popup({ window: this.window });
    };

    // M11: Ctrl+wheel zoom via Chromium's native zoom-changed event (desktop
    // tabs; device emulation swallows Ctrl+wheel on mobile tabs).
    const onZoomChanged = (_e: Electron.Event, dir: 'in' | 'out'): void => {
      const managed = this.tabs.get(id);
      if (managed) this.setZoom(id, nextZoomFactor(managed.zoom, dir));
    };

    // M16: route window.open / target=_blank by disposition.
    const onDidCreateWindow = (child: BrowserWindow): void => this.setupPopup(child);
    wc.setWindowOpenHandler((details) => {
      const decision = decideWindowOpen(details);
      if (decision.kind === 'popup') {
        return { action: 'allow', overrideBrowserWindowOptions: this.popupWindowOptions(details.features) };
      }
      // Note: Electron has no API to unregister setWindowOpenHandler — it's
      // cleaned up when the webContents closes.
      this.createTab(details.url, { activate: decision.activate });
      return { action: 'deny' };
    });

    wc.on('did-start-loading', onStart);
    wc.on('did-stop-loading', onStop);
    wc.on('did-navigate', onNavigate);
    wc.on('did-navigate-in-page', onNavigateInPage);
    wc.on('page-title-updated', onTitle);
    wc.on('page-favicon-updated', onFavicon);
    wc.on('audio-state-changed', onAudio);
    wc.on('render-process-gone', onGone);
    wc.on('unresponsive', onUnresponsive);
    wc.on('responsive', onResponsive);
    wc.on('enter-html-full-screen', onEnterFullscreen);
    wc.on('leave-html-full-screen', onLeaveFullscreen);
    wc.on('devtools-opened', onDevtoolsOpened);
    wc.on('devtools-closed', onDevtoolsClosed);
    wc.on('context-menu', onContextMenu);
    wc.on('zoom-changed', onZoomChanged);
    wc.on('did-create-window', onDidCreateWindow);

    const detachHistory = bindHistoryRecorderEvents(
      id,
      wc,
      this.recorder,
      () => this.tabs.get(id)?.tab.url ?? '',
    );

    return (): void => {
      wc.off('did-start-loading', onStart);
      wc.off('did-stop-loading', onStop);
      wc.off('did-navigate', onNavigate);
      wc.off('did-navigate-in-page', onNavigateInPage);
      wc.off('page-title-updated', onTitle);
      wc.off('page-favicon-updated', onFavicon);
      wc.off('audio-state-changed', onAudio);
      wc.off('render-process-gone', onGone);
      wc.off('unresponsive', onUnresponsive);
      wc.off('responsive', onResponsive);
      wc.off('enter-html-full-screen', onEnterFullscreen);
      wc.off('leave-html-full-screen', onLeaveFullscreen);
      wc.off('devtools-opened', onDevtoolsOpened);
      wc.off('devtools-closed', onDevtoolsClosed);
      wc.off('zoom-changed', onZoomChanged);
      wc.off('context-menu', onContextMenu);
      wc.off('did-create-window', onDidCreateWindow);
      detachHistory();    // M12: detach history listeners
    };
  }
}
