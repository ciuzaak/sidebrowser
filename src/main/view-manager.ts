import { WebContentsView, type BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { getPersistentSession } from './session-manager';
import { uaFor } from './user-agents';
import type { Tab, TabsSnapshot } from '@shared/types';
import { makeEmptyTab } from '@shared/types';

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
  private readonly tabUpdatedListeners = new Set<TabUpdatedListener>();
  private readonly snapshotListeners = new Set<SnapshotListener>();

  /** Stored resize handler so it can be removed in destroy(). */
  private readonly onWindowResize = (): void => this.applyBounds();

  constructor(window: BrowserWindow) {
    this.window = window;
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
   *  to preserve persisted ids; user-initiated `tab:create` IPC always gets a fresh nanoid. */
  createTab(url: string = 'about:blank', id: string = nanoid(), isMobile: boolean = true): Tab {
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
    view.webContents.setUserAgent(uaFor(isMobile));

    const managed: ManagedTab = {
      view,
      tab: makeEmptyTab(id, url, isMobile),
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
   * Toggle a tab between mobile and desktop UA. Per spec §5.4:
   *   1. setUserAgent so the next request uses the new UA
   *   2. updateTab so the renderer reflects the new isMobile (button state) immediately
   *      and clears the stale favicon (page-favicon-updated will re-populate post-reload)
   *   3. reloadIgnoringCache so the page re-fetches under the new UA without
   *      serving a cached response tied to the previous UA
   */
  setMobile(id: string, isMobile: boolean): void {
    const managed = this.tabs.get(id);
    if (!managed) return;
    const wc = managed.view.webContents;
    wc.setUserAgent(uaFor(isMobile));
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
    const onNavigate = (_e: Electron.Event, url: string): void =>
      this.updateTab(id, {
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    const onTitle = (_e: Electron.Event, title: string): void => this.updateTab(id, { title });
    // Electron's page-favicon-updated supplies all discovered <link rel=icon>
    // candidates in priority order; we take the first as spec §5.3 dictates.
    const onFavicon = (_e: Electron.Event, favicons: string[]): void =>
      this.updateTab(id, { favicon: favicons[0] ?? null });

    wc.on('did-start-loading', onStart);
    wc.on('did-stop-loading', onStop);
    wc.on('did-navigate', onNavigate);
    wc.on('did-navigate-in-page', onNavigate);
    wc.on('page-title-updated', onTitle);
    wc.on('page-favicon-updated', onFavicon);
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
    };
  }
}
