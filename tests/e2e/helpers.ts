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

/**
 * Wait until the chrome's SearchPill is mounted and enabled (tabs have been
 * seeded). Replaces M14's prior `waitForAddressBarReady` — the inline address
 * bar input no longer exists; the pill is the always-visible chrome control
 * that opens the SearchSpotlight on click.
 */
export async function waitForAddressBarReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLButtonElement>('[data-testid="search-pill"]');
      return Boolean(el && !el.disabled);
    },
    { timeout: 10_000 },
  );
}

/**
 * Click the SearchPill so the SearchSpotlight mounts and its input
 * (data-testid="address-bar") becomes focusable. No-op if already open.
 */
export async function openSpotlight(page: Page): Promise<void> {
  const alreadyOpen = await page
    .locator('[data-testid="search-spotlight"]')
    .count()
    .then((c) => c > 0);
  if (alreadyOpen) return;
  await page.getByTestId('search-pill').click();
  await page.waitForSelector('[data-testid="address-bar"]', { timeout: 10_000 });
}

/**
 * Type `url` into the address bar and press Enter. Returns once the navigation
 * has actually committed on the main side (active WebContents URL matches).
 *
 * If `app` is provided, polls the active WebContents URL via the test hook
 * (requires SIDEBROWSER_E2E=1). Without it, only waits for the spotlight to
 * unmount — caller is responsible for verifying the navigation landed.
 */
export async function navigateActive(
  page: Page,
  url: string,
  app?: ElectronApplication,
): Promise<void> {
  await openSpotlight(page);
  const bar = page.getByTestId('address-bar');
  await bar.fill(url);
  await bar.press('Enter');
  // Spotlight unmounts on submit.
  await page.waitForSelector('[data-testid="address-bar"]', { state: 'detached', timeout: 10_000 });
  if (app !== undefined) {
    await expect
      .poll(async () => getActiveUrl(app), { timeout: 10_000 })
      .toBe(url);
  }
}

/**
 * Read the URL of the currently-active WebContents via the main-side test hook.
 * Used in place of the old `addressBar.inputValue()` assertion because the
 * spotlight input no longer reflects the live URL after submit.
 */
export async function getActiveUrl(app: ElectronApplication): Promise<string> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    return h.getActiveWebContents()?.getURL() ?? '';
  });
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
