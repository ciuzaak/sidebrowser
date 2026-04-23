import { expect, type ElectronApplication, type Page } from '@playwright/test';

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

/** Wait for the address-bar input to exist and be enabled (tabs seeded). */
export async function waitForAddressBarReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
      return Boolean(el && !el.disabled);
    },
    { timeout: 10_000 },
  );
}

/** Type `url` into the address bar and press Enter; poll until the input reflects the submitted value. */
export async function navigateActive(page: Page, url: string): Promise<void> {
  const bar = page.getByTestId('address-bar');
  await bar.fill(url);
  await bar.press('Enter');
  await expect
    .poll(async () => (await bar.inputValue()) === url, { timeout: 10_000 })
    .toBeTruthy();
}

/**
 * Read computed CSS filter on the active WebContents via app.evaluate (main process).
 * Uses getComputedStyle because insertCSS injects a stylesheet rule, not inline style —
 * document.documentElement.style.filter would always return '' in that case.
 */
export async function getActiveFilter(app: ElectronApplication): Promise<string | null> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    const wc = h.getActiveWebContents();
    if (!wc) return null;
    return wc.executeJavaScript(
      'window.getComputedStyle(document.documentElement).filter',
    ) as Promise<string>;
  });
}
