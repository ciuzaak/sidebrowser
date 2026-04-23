import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  getActiveFilter,
  getChromeWindow,
  navigateActive,
  waitForAddressBarReady,
} from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

// Type alias used only inside app.evaluate string expressions (for clarity in code);
// the actual runtime type lives in the Electron main process.
type TestHooks = {
  fireLeaveNow: () => void;
  fireEnterNow: () => void;
  getActiveWebContents: () => Electron.WebContents | null;
  getWebContentsByUrlSubstring: (s: string) => Electron.WebContents | null;
};

function startDimServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/plain' || (url.startsWith('/plain') && !url.startsWith('/plain2'))) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body>hi</body></html>');
        return;
      }
      if (url.startsWith('/plain2')) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body>hi2</body></html>');
        return;
      }
      if (url === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByTestId('topbar-tabs-toggle').click();
  await page.getByTestId('tab-drawer').waitFor({ state: 'visible' });
}

async function createNewTab(page: Page): Promise<void> {
  await openDrawer(page);
  await page.getByTestId('tab-drawer-new').click();
  await page.getByTestId('tab-drawer').waitFor({ state: 'hidden' });
  await waitForAddressBarReady(page);
}

/**
 * Read computed CSS filter on the WebContents whose URL contains `urlSubstring`.
 * Returns null if no tab matches.
 */
async function getFilterByUrlSubstring(
  app: ElectronApplication,
  urlSubstring: string,
): Promise<string | null> {
  return app.evaluate(
    async (_electron, substring: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        getWebContentsByUrlSubstring: (s: string) => Electron.WebContents | null;
      };
      const wc = h.getWebContentsByUrlSubstring(substring);
      if (!wc) return null;
      return wc.executeJavaScript(
        'window.getComputedStyle(document.documentElement).filter',
      ) as Promise<string>;
    },
    urlSubstring,
  );
}

test('dim applies on leave, clears on enter, retargets on tab switch', async () => {
  const { server, baseUrl } = await startDimServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m4-dim-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });

    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // ---- Tab1: navigate to /plain ----
      await navigateActive(page, `${baseUrl}/plain`);

      // Wait for ViewManager to register the URL (did-navigate fires async after loadURL).
      await expect
        .poll(
          () => getFilterByUrlSubstring(app, '/plain'),
          { timeout: 10_000 },
        )
        .not.toBeNull();

      // ---- Assert initial filter is 'none' (no dim applied yet) ----
      // NOTE: plan says "断言空字符串" but that refers to inline style.filter which is
      // always ''. We use getComputedStyle which returns 'none' when no filter rule is
      // active. This is correct for insertCSS-based injection (stylesheet rule, not inline).
      const initialFilter = await getActiveFilter(app);
      expect(initialFilter).toBe('none');

      // ---- fireLeaveNow → dim should activate (apply blur CSS) ----
      await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((globalThis as any).__sidebrowserTestHooks as TestHooks).fireLeaveNow();
      });

      // insertCSS is async; poll until injected
      await expect
        .poll(() => getActiveFilter(app), { timeout: 10_000 })
        .toContain('blur');

      // ---- fireEnterNow → dim clears ----
      await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((globalThis as any).__sidebrowserTestHooks as TestHooks).fireEnterNow();
      });

      await expect
        .poll(() => getActiveFilter(app), { timeout: 10_000 })
        .toBe('none');

      // ---- Retarget: open tab2, navigate to /plain2 ----
      await createNewTab(page);
      await navigateActive(page, `${baseUrl}/plain2`);

      // Wait for tab2's WebContents to be discoverable by URL
      await expect
        .poll(
          () => getFilterByUrlSubstring(app, '/plain2'),
          { timeout: 10_000 },
        )
        .not.toBeNull();

      // tab2 is now active — fireLeaveNow → tab2 dims
      await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((globalThis as any).__sidebrowserTestHooks as TestHooks).fireLeaveNow();
      });

      await expect
        .poll(() => getFilterByUrlSubstring(app, '/plain2'), { timeout: 10_000 })
        .toContain('blur');

      // ---- Switch back to tab1 via the drawer ----
      await openDrawer(page);
      // Tab1's row text includes 'plain' but not 'plain2'. Iterate to find it.
      const rows = page.getByTestId('tab-drawer-item');
      const rowCount = await rows.count();
      let clicked = false;
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const text = (await row.textContent()) ?? '';
        if (text.toLowerCase().includes('plain') && !text.toLowerCase().includes('plain2')) {
          await row.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        // Fallback: first tab was created first, should be first row
        await rows.first().click();
      }
      await page.getByTestId('tab-drawer').waitFor({ state: 'hidden' });

      // Wait for address bar to show tab1's URL (/plain, not /plain2)
      await expect
        .poll(
          async () => {
            const val = await page.getByTestId('address-bar').inputValue();
            return val.includes('/plain') && !val.includes('/plain2');
          },
          { timeout: 10_000 },
        )
        .toBeTruthy();

      // After retarget (triggered by onSnapshot → dim.retarget(newActiveWc)):
      //   - tab1 (now active) filter → contains 'blur'
      //   - tab2 filter → 'none' (CSS removed from old target)
      await expect
        .poll(
          async () => {
            const activeFilter = await getActiveFilter(app);
            const tab2Filter = await getFilterByUrlSubstring(app, '/plain2');
            return { activeFilter, tab2Filter };
          },
          { timeout: 10_000 },
        )
        .toMatchObject({
          activeFilter: expect.stringContaining('blur'),
          tab2Filter: 'none',
        });

    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
