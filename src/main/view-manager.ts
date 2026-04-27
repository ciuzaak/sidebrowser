import { WebContentsView, type BrowserWindow } from 'electron';
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
  type UaMetadata,
} from './mobile-emulation';
import type { Tab, TabsSnapshot } from '@shared/types';
import { makeEmptyTab } from '@shared/types';

// ---------------------------------------------------------------------------
// Zoom helpers — M11 Task 8
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

/**
 * Pure helper for the zoom-changed handler. Computed step bounded by [0.5, 3.0]
 * so the handler can be unit-tested without a real WebContents.
 */
export function nextZoomFactor(current: number, dir: 'in' | 'out'): number {
  const delta = dir === 'in' ? +ZOOM_STEP : -ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta));
}

// ---------------------------------------------------------------------------

/**
 * Getter closure the main bootstrap injects so ViewManager can read live
 * browsing defaults (UA + mobile flag) from SettingsStore at each createTab
 * call without holding a direct SettingsStore reference. M6 Task 8.
 */
export type BrowsingDefaultsGetter = () => {
  defaultIsMobile: boolean;
  mobileUserAgent: string;
};

type TabUpdatedListener = (tab: Tab) => void;
type SnapshotListener = (snapshot: TabsSnapshot) => void;

interface ManagedTab {
  view: WebContentsView;
  tab: Tab;
  /** Detachable webContents listener cleanup for this tab. Called on close. */
  detach: () => void;
}

/**
 * Multi-tab web view controller.
 *
 * Each tab owns one WebContentsView attached to the host BrowserWindow, all
 * sharing the persistent session. Only the active tab's view has real bounds;
 * background tabs have `{0,0,0,0}` so they stay resident but invisible.
 */
export class ViewManager {
  private readonly window: BrowserWindow;
  private readonly tabs = new Map<string, ManagedTab>();
  private activeId: string | null = null;
  private chromeHeightPx = 0;
  private suppressed = false;
  /**
   * Per-tab zoom factor (1.0 = 100%). Default 1.0 is implicit (`get(...) ?? 1.0`).
   * Map entries are removed on closeTab. Not persisted by design (spec §6.1).
   */
  private readonly zoomFactors = new Map<string, number>();
  private readonly tabUpdatedListeners = new Set<TabUpdatedListener>();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly getBrowsingDefaults: BrowsingDefaultsGetter;

  /** Stored resize handler so it can be removed in destroy(). */
  private readonly onWindowResize = (): void => this.applyBounds();

  constructor(
    window: BrowserWindow,
    getBrowsingDefaults: BrowsingDefaultsGetter,
  ) {
    this.window = window;
    this.getBrowsingDefaults = getBrowsingDefaults;
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
  }

  /** Create a new tab, auto-activate it, return the full Tab object.
   *  `id` is optional and only used by the persistence-restore path in `seedTabs`
   *  to preserve persisted ids; user-initiated `tab:create` IPC always gets a fresh nanoid.
   *  `isMobile` defaults to `settings.browsing.defaultIsMobile` when omitted; an explicit
   *  caller value (e.g. the restore path preserving per-tab UA) always wins. */
  createTab(url: string = 'about:blank', id: string = nanoid(), isMobile?: boolean): Tab {
    // Whitelist guard (spec §10). Covers user-initiated createTab via IPC, the
    // setWindowOpenHandler popup path, AND the seedTabs replay path transitively
    // (seedTabs → createTab), so persisted javascript:/data:/chrome: URLs can't
    // reach the renderer even if they slipped past tab-persistence SAFE_SCHEME.
    url = sanitizeUrl(url);
    const defaults = this.getBrowsingDefaults();
    const resolvedIsMobile = isMobile ?? defaults.defaultIsMobile;
    const view = new WebContentsView({
      webPreferences: {
        session: getPersistentSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.window.contentView.addChildView(view);
    // Per spec §5.4: set UA before loadURL so the very first request uses the
    // correct (mobile-by-default) UA. desktopUa() reads app.userAgentFallback,
    // which requires app.whenReady() to have fired — all createTab call paths
    // (seedTabs under did-finish-load, setWindowOpenHandler, tab:create IPC)
    // originate post-whenReady, so this is safe.
    view.webContents.setUserAgent(
      resolvedIsMobile ? defaults.mobileUserAgent : desktopUa(),
    );
    // M10 / M10.5: 三层 mobile 模拟。
    //   1. enableDeviceEmulation：翻 Chromium 内部 mobile flag（viewport meta 解析等）
    //   2. CDP setUserAgentOverride/setTouchEmulation/setEmitTouchEventsForMouse：
    //      翻 navigator.userAgentData.mobile / (pointer:coarse) / (hover:none) /
    //      'ontouchstart' in window / 触摸事件——这些 enableDeviceEmulation 不动
    //   3. webRequest（在 index.ts 挂）：改 Sec-CH-UA-* HTTP 头
    //
    // 必须 defer 到 'did-start-loading'：在 fresh webContents 上同步调
    // enableDeviceEmulation 会死锁主进程（M10 Task 4 spike findings）。CDP attach
    // 也需要 wc 渲染端在线，同样 defer。
    if (resolvedIsMobile) {
      view.webContents.once('did-start-loading', () => {
        const b = this.window.getContentBounds();
        applyMobileEmulation(view.webContents, { width: b.width, height: b.height });
        const ua = this.getBrowsingDefaults().mobileUserAgent;
        void attachCdpEmulation(view.webContents, parseUaForMetadata(ua), ua, { width: b.width, height: b.height });
      });
    }

    const managed: ManagedTab = {
      view,
      tab: makeEmptyTab(id, url, resolvedIsMobile),
      detach: this.attachWebContentsEvents(id, view),
    };
    this.tabs.set(id, managed);

    this.activateTab(id);
    // Fire initial navigation. Intentionally not awaited: the load happens in the
    // background; events will fire tab:updated as state changes.
    void view.webContents.loadURL(url).catch((err: unknown) => {
      console.error('[sidebrowser] createTab loadURL failed:', err);
    });
    return { ...managed.tab };
  }

  closeTab(id: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    this.zoomFactors.delete(id);

    managed.detach();
    this.window.contentView.removeChildView(managed.view);
    managed.view.webContents.close();
    this.tabs.delete(id);

    if (this.activeId === id) {
      // Activate the most-recently-inserted remaining tab (last insertion wins).
      const remaining = Array.from(this.tabs.keys());
      this.activeId = remaining[remaining.length - 1] ?? null;
      this.applyBounds();
    }

    if (this.tabs.size === 0) {
      // Spec §10: never leave the user with zero tabs — auto-seed a blank.
      // createTab activates the new tab and emits the snapshot itself.
      this.createTab('about:blank');
      return;
    }
    this.emitSnapshot();
  }

  activateTab(id: string): void {
    if (!this.tabs.has(id)) return;
    if (this.activeId === id) return;
    this.activeId = id;
    this.applyBounds();
    this.emitSnapshot();
  }

  navigate(id: string, url: string): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    // Whitelist guard — spec §10. Final gate even though the address-bar
    // `normalizeUrlInput` already ran in shared/url.ts; keeps javascript:/data:
    // out of the renderer regardless of entry point.
    url = sanitizeUrl(url);
    this.updateTab(id, { url, isLoading: true });
    void managed.view.webContents.loadURL(url).catch((err: unknown) => {
      console.error('[sidebrowser] navigate loadURL failed:', err);
    });
  }

  goBack(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  goForward(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  reload(id: string): void {
    this.tabs.get(id)?.view.webContents.reload();
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
    const wc = managed.view.webContents;
    const defaults = this.getBrowsingDefaults();
    if (isMobile) {
      const b = this.window.getContentBounds();
      applyMobileEmulation(wc, { width: b.width, height: b.height });
      void attachCdpEmulation(wc, parseUaForMetadata(defaults.mobileUserAgent), defaults.mobileUserAgent, { width: b.width, height: b.height });
    } else {
      detachCdpEmulation(wc);
      removeMobileEmulation(wc);
    }
    wc.setUserAgent(isMobile ? defaults.mobileUserAgent : desktopUa());
    this.updateTab(id, { isMobile, favicon: null });
    wc.reloadIgnoringCache();
  }

  /** Shape for persistence layer — strips transient fields. */
  serializeForPersistence(): {
    tabs: { id: string; url: string; isMobile: boolean }[];
    activeId: string;
  } | null {
    if (this.tabs.size === 0 || !this.activeId) return null;
    return {
      tabs: Array.from(this.tabs.values()).map((m) => ({
        id: m.tab.id,
        url: m.tab.url,
        isMobile: m.tab.isMobile,
      })),
      activeId: this.activeId,
    };
  }

  getActiveWebContents(): Electron.WebContents | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId)?.view.webContents ?? null;
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
    this.getActiveWebContents()?.reload();
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

  /**
   * Toggle the "suppressed" flag. While suppressed, every tab's view is
   * shrunk to `{0,0,0,0}` so a renderer-layer overlay (e.g. the M6 settings
   * drawer) can paint over the WebContentsView layer. Idempotent.
   */
  setSuppressed(v: boolean): void {
    if (this.suppressed === v) return;
    this.suppressed = v;
    this.applyBounds();
  }

  /**
   * E2E hook: returns the active tab's view bounds, or null if no active tab.
   * Used by settings-drawer E2E specs to verify suppression actually shrinks
   * the view rect (visual blur alone is an insufficient signal — see
   * plan §Task 11 rationale).
   */
  getActiveBoundsForTest(): { x: number; y: number; width: number; height: number } | null {
    if (!this.activeId) return null;
    const m = this.tabs.get(this.activeId);
    return m ? m.view.getBounds() : null;
  }

  /**
   * Lookup helper for installMobileHeaderRewriter (M10 Task 7).
   * 返回值语义：
   *   null       → 该 wcId 对应 desktop tab / 不是 tab（chrome renderer 自己），头不动
   *   UaMetadata → mobile tab，按这份元数据改 Sec-CH-UA-Mobile/Platform/Platform-Version
   *
   * 每次 webRequest 命中都跑一次。parse 是几个 regex，tab 数 ≤ 几个，UA 字符串
   * 可被用户在 settings 改，实时 parse 比缓存失效逻辑简单（design §8）。
   */
  getMobileEmulationState(wcId: number): UaMetadata | null {
    for (const [, m] of this.tabs) {
      if (m.view.webContents.id === wcId) {
        if (!m.tab.isMobile) return null;
        return parseUaForMetadata(this.getBrowsingDefaults().mobileUserAgent);
      }
    }
    return null;
  }

  getWebContentsByUrlSubstring(substring: string): Electron.WebContents | null {
    for (const managed of this.tabs.values()) {
      if (managed.tab.url.includes(substring)) return managed.view.webContents;
    }
    return null;
  }

  destroy(): void {
    this.window.removeListener('resize', this.onWindowResize);
    for (const managed of this.tabs.values()) {
      managed.detach();
      this.window.contentView.removeChildView(managed.view);
      managed.view.webContents.close();
    }
    this.tabs.clear();
    this.activeId = null;
  }

  // ---------- private ----------

  private applyBounds(): void {
    // Suppressed: every tab shrinks to zero so the renderer-layer drawer
    // overlay can paint unobstructed. Background-tab bounds were already
    // zero; this extends the same treatment to the active tab.
    if (this.suppressed) {
      const zero = { x: 0, y: 0, width: 0, height: 0 };
      for (const [, managed] of this.tabs) managed.view.setBounds(zero);
      return;
    }

    const { width, height } = this.window.getContentBounds();
    const realBounds = {
      x: 0,
      y: this.chromeHeightPx,
      width,
      height: Math.max(0, height - this.chromeHeightPx),
    };
    const hiddenBounds = { x: 0, y: 0, width: 0, height: 0 };

    for (const [id, managed] of this.tabs) {
      managed.view.setBounds(id === this.activeId ? realBounds : hiddenBounds);
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

  private attachWebContentsEvents(id: string, view: WebContentsView): () => void {
    const wc = view.webContents;

    const onStart = (): void => this.updateTab(id, { isLoading: true });
    const onStop = (): void =>
      this.updateTab(id, {
        isLoading: false,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    const onNavigate = (_e: Electron.Event, url: string): void => {
      this.updateTab(id, {
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
      // M10.5: 每次 fresh navigation 重发 CDP 命令——'ontouchstart' in window 是
      // window 对象创建时一次性确定的，CDP override 必须在新 frame 渲染前到位。
      // 跨进程导航 / cross-origin 时 renderer 会 swap，CDP browser-side state 不一定
      // 自动传递到新 frame，重发是兜底。attachCdpEmulation 幂等。
      const tab = this.tabs.get(id)?.tab;
      if (tab?.isMobile && wc.debugger.isAttached()) {
        const ua = this.getBrowsingDefaults().mobileUserAgent;
        const b = this.window.getContentBounds();
        void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, { width: b.width, height: b.height });
      }
      // M11 zoom reapply: Chromium resets zoomFactor to 1.0 on did-navigate;
      // reapply our stored value so per-tab zoom survives navigation.
      const z = this.zoomFactors.get(id);
      if (z !== undefined && z !== 1.0) {
        wc.setZoomFactor(z);
      }
    };
    const onTitle = (_e: Electron.Event, title: string): void => this.updateTab(id, { title });
    // Electron's page-favicon-updated supplies all discovered <link rel=icon>
    // candidates in priority order; we take the first as spec §5.3 dictates.
    const onFavicon = (_e: Electron.Event, favicons: string[]): void =>
      this.updateTab(id, { favicon: favicons[0] ?? null });

    // M10.5: F12 DevTools 与 wc.debugger CDP attach 互斥（同一通道单客户端）。
    // 用户开 F12 → 主动 detach 我们的 CDP 让 DevTools 接管；关 F12 → 如果 tab
    // 仍是 mobile，重新 attach 恢复 emulation。重 attach 后页面已经渲染过，CDP
    // override 对当前 DOM 不会重新触发——用户需要手动 reload 才能让页面重新评估
    // userAgentData / 媒体查询。这是 design §16 接受的代价。
    const onDevtoolsOpened = (): void => {
      detachCdpEmulation(wc);
    };
    const onDevtoolsClosed = (): void => {
      const tab = this.tabs.get(id)?.tab;
      if (tab?.isMobile) {
        const ua = this.getBrowsingDefaults().mobileUserAgent;
        const b = this.window.getContentBounds();
        void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, { width: b.width, height: b.height });
      }
    };

    wc.on('did-start-loading', onStart);
    wc.on('did-stop-loading', onStop);
    wc.on('did-navigate', onNavigate);
    wc.on('did-navigate-in-page', onNavigate);
    wc.on('page-title-updated', onTitle);
    wc.on('page-favicon-updated', onFavicon);
    wc.on('devtools-opened', onDevtoolsOpened);
    wc.on('devtools-closed', onDevtoolsClosed);

    // M11: Ctrl+wheel zoom via Chromium's native zoom-changed event.
    const onZoomChanged = (_e: Electron.Event, dir: 'in' | 'out'): void => {
      const cur = this.zoomFactors.get(id) ?? 1.0;
      const next = nextZoomFactor(cur, dir);
      this.zoomFactors.set(id, next);
      wc.setZoomFactor(next);
    };
    wc.on('zoom-changed', onZoomChanged);

    wc.setWindowOpenHandler(({ url }) => {
      // M2: open popups as new tabs rather than redirecting current (fixes M1 OAuth breakage).
      // Note: Electron has no API to unregister setWindowOpenHandler — it's implicitly cleaned
      // up when webContents.close() runs in closeTab/destroy. Late-fire between detach and close
      // would still call createTab on this ViewManager (low-likelihood synchronous race).
      this.createTab(url);
      return { action: 'deny' };
    });

    return (): void => {
      wc.off('did-start-loading', onStart);
      wc.off('did-stop-loading', onStop);
      wc.off('did-navigate', onNavigate);
      wc.off('did-navigate-in-page', onNavigate);
      wc.off('page-title-updated', onTitle);
      wc.off('page-favicon-updated', onFavicon);
      wc.off('devtools-opened', onDevtoolsOpened);
      wc.off('devtools-closed', onDevtoolsClosed);
      wc.off('zoom-changed', onZoomChanged);
    };
  }
}
