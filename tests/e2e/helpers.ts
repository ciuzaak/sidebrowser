import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Resolve the chrome (TopBar) renderer window.
 *
 * The app exposes two CDP-addressable pages: the BrowserWindow renderer (loads
 * our index.html with the preload that injects `window.sidebrowser`) and the
 * WebContentsView (loads user content, starts at about:blank, has no preload).
 * `app.firstWindow()` does not distinguish between them, so we pick the one
 * where the preload API is present.
 */
export async function getChromeWindow(app: ElectronApplication, timeoutMs = 10_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const hasApi = await page.evaluate(
          () => typeof (globalThis as { sidebrowser?: unknown }).sidebrowser !== 'undefined',
        );
        if (hasApi) return page;
      } catch {
        // Page may be navigating or not yet ready; try the next candidate.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`getChromeWindow: chrome window (window.sidebrowser) not found within ${timeoutMs}ms`);
}
