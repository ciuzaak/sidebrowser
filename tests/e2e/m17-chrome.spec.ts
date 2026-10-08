import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow, navigateActive, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      const page = (title: string): void => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`);
      };
      if (url === '/a') return page('A');
      if (url === '/b') return page('B');
      if (url === '/slow') {
        setTimeout(() => page('Slow'), 800);
        return;
      }
      res.statusCode = url === '/favicon.ico' ? 204 : 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Run `fn` with a fresh app (isolated profile, E2E mode) + local server. */
async function withApp(
  fn: (app: ElectronApplication, baseUrl: string) => Promise<void>,
): Promise<void> {
  const { server, baseUrl } = await startServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m17-'));
  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
    try {
      await fn(app, baseUrl);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

/** Call a no-arg __sidebrowserTestHooks function by name. */
async function hook<T>(app: ElectronApplication, name: string): Promise<T> {
  return app.evaluate((_e, n) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as Record<string, () => unknown>;
    return h[n]!();
  }, name) as Promise<T>;
}

test.describe('M17 chrome', () => {
  test('self-drawn window controls; minimize works', async () => {
    await withApp(async (app) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await expect(page.getByTestId('window-minimize')).toBeVisible();
      await expect(page.getByTestId('window-close')).toBeVisible();

      await page.getByTestId('window-minimize').click();
      await expect.poll(() => hook<boolean>(app, 'getIsMinimized'), { timeout: 5_000 }).toBe(true);
    });
  });

  test('Forward renders only when the tab can go forward', async () => {
    await withApp(async (app, baseUrl) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      const forward = page.getByRole('button', { name: 'Forward' });
      await expect(forward).toHaveCount(0);

      await navigateActive(page, `${baseUrl}/a`, app);
      await navigateActive(page, `${baseUrl}/b`, app);
      await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(forward).toBeVisible({ timeout: 10_000 });

      await forward.click();
      await expect(forward).toHaveCount(0, { timeout: 10_000 });
    });
  });

  test('tab-count badge appears with two tabs', async () => {
    await withApp(async (app) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await expect(page.getByTestId('topbar-tab-count')).toHaveCount(0);
      await page.evaluate(() => window.sidebrowser.createTab('about:blank'));
      await expect(page.getByTestId('topbar-tab-count')).toHaveText('2');
    });
  });

  test('TabDrawer offsets the active view without resizing it', async () => {
    await withApp(async (app, baseUrl) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await navigateActive(page, `${baseUrl}/a`, app);
      const initial = (await hook<Rect | null>(app, 'getActiveViewBounds'))!;
      expect(initial.height).toBeGreaterThan(0);

      await page.getByTestId('topbar-tabs-toggle').click();
      const drawer = page.getByTestId('tab-drawer');
      await drawer.waitFor({ state: 'visible' });
      const drawerH = (await drawer.boundingBox())!.height;

      await expect
        .poll(async () => {
          const b = (await hook<Rect | null>(app, 'getActiveViewBounds'))!;
          return Math.abs(b.y - (initial.y + drawerH)) <= 1 && b.height === initial.height;
        }, { timeout: 5_000 })
        .toBe(true);
      expect(await hook<boolean | null>(app, 'getActiveViewVisible')).toBe(true);

      await page.getByTestId('topbar-tabs-toggle').click();
      await expect
        .poll(async () => (await hook<Rect | null>(app, 'getActiveViewBounds'))!.y, { timeout: 5_000 })
        .toBe(initial.y);
    });
  });

  test('Spotlight over a page shows a snapshot backdrop and hides the view', async () => {
    await withApp(async (app, baseUrl) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await navigateActive(page, `${baseUrl}/a`, app);

      await page.getByTestId('search-pill').click();
      const backdrop = page.getByTestId('spotlight-backdrop');
      await expect(backdrop).toHaveAttribute('src', /^data:image\/jpeg;base64,/, { timeout: 5_000 });
      await expect
        .poll(() => hook<boolean | null>(app, 'getActiveViewVisible'), { timeout: 5_000 })
        .toBe(false);

      await page.keyboard.press('Escape');
      await expect
        .poll(() => hook<boolean | null>(app, 'getActiveViewVisible'), { timeout: 5_000 })
        .toBe(true);
    });
  });

  test('Dim shows only the slider for the selected effect', async () => {
    await withApp(async (app) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__sidebrowserTestHooks.updateSettings({ dim: { effect: 'dark' } });
      });
      await page.getByTestId('topbar-settings-toggle').click();
      await page.getByTestId('settings-drawer').waitFor({ state: 'visible' });
      await expect(page.getByTestId('settings-dim-dark-brightness')).toHaveCount(1);
      await expect(page.getByTestId('settings-dim-blur')).toHaveCount(0);
      await expect(page.getByTestId('settings-dim-light-brightness')).toHaveCount(0);
    });
  });

  test('top bar data-loading tracks a slow navigation', async () => {
    await withApp(async (app, baseUrl) => {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      const bar = page.getByTestId('topbar');
      await expect(bar).toHaveAttribute('data-loading', 'false');

      await page.evaluate(async (url) => {
        const snap = await window.sidebrowser.requestTabsSnapshot();
        void window.sidebrowser.navigate(snap.activeId!, url);
      }, `${baseUrl}/slow`);
      await expect(bar).toHaveAttribute('data-loading', 'true', { timeout: 5_000 });
      await expect(bar).toHaveAttribute('data-loading', 'false', { timeout: 10_000 });
    });
  });
});
