import { WebContentsView, type BrowserWindow } from 'electron';
import { getPersistentSession } from './session-manager';
import type { Tab } from '@shared/types';
import { INITIAL_TAB } from '@shared/types';

type TabListener = (tab: Tab) => void;

/**
 * Single-tab web view controller for M1.
 *
 * Owns exactly one WebContentsView attached to the given BrowserWindow, keeps a
 * mirrored Tab snapshot in memory, and emits changes to any subscribed listener.
 * M2 will generalize this to a map of views keyed by tab ID.
 */
export class ViewManager {
  private readonly view: WebContentsView;
  private readonly window: BrowserWindow;
  private tab: Tab = { ...INITIAL_TAB };
  private chromeHeightPx = 0;
  private listener: TabListener | null = null;

  constructor(window: BrowserWindow) {
    this.window = window;

    this.view = new WebContentsView({
      webPreferences: {
        session: getPersistentSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    window.contentView.addChildView(this.view);
    this.attachWebContentsEvents();

    // Recompute bounds when the window itself resizes.
    window.on('resize', () => this.applyBounds());
    window.once('ready-to-show', () => this.applyBounds());
  }

  /** Subscribe (single listener — renderer broadcasts via main's IPC). */
  onTabChange(listener: TabListener): void {
    this.listener = listener;
    listener(this.snapshot());
  }

  snapshot(): Tab {
    return { ...this.tab };
  }

  setChromeHeight(heightPx: number): void {
    const clamped = Math.max(0, Math.round(heightPx));
    if (clamped === this.chromeHeightPx) return;
    this.chromeHeightPx = clamped;
    this.applyBounds();
  }

  async navigate(url: string): Promise<void> {
    this.update({ url, isLoading: true });
    await this.view.webContents.loadURL(url).catch((err: unknown) => {
      // did-fail-load will also fire; swallow the promise rejection to avoid unhandled rejections.
      console.error('[sidebrowser] loadURL failed:', err);
    });
  }

  goBack(): void {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.view.webContents.reload();
  }

  destroy(): void {
    this.window.contentView.removeChildView(this.view);
    // Electron destroys the webContents when the parent window closes; no explicit destroy call needed.
  }

  // ---------- private ----------

  private applyBounds(): void {
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({
      x: 0,
      y: this.chromeHeightPx,
      width,
      height: Math.max(0, height - this.chromeHeightPx),
    });
  }

  private update(patch: Partial<Tab>): void {
    this.tab = { ...this.tab, ...patch };
    this.listener?.(this.snapshot());
  }

  private attachWebContentsEvents(): void {
    const wc = this.view.webContents;

    wc.on('did-start-loading', () => this.update({ isLoading: true }));
    wc.on('did-stop-loading', () =>
      this.update({
        isLoading: false,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );

    wc.on('did-navigate', (_e, url) =>
      this.update({
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );
    wc.on('did-navigate-in-page', (_e, url) =>
      this.update({
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );

    wc.on('page-title-updated', (_e, title) => this.update({ title }));

    // Block popups (new windows) in M1; route them into the current view instead.
    wc.setWindowOpenHandler(({ url }) => {
      void this.navigate(url);
      return { action: 'deny' };
    });
  }
}
