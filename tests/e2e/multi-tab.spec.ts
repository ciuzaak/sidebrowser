import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

function startPageServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((res) => {
    const server = createServer((req, response) => {
      const match = /^\/page(\d+)$/.exec(req.url ?? '');
      if (match) {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><title>PAGE ${match[1]}</title><p>page ${match[1]}</p>`);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function waitForAddressBarReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
      return Boolean(input && !input.disabled);
    },
    { timeout: 10_000 },
  );
}

async function navigateActive(page: Page, url: string): Promise<void> {
  const addressBar = page.getByTestId('address-bar');
  await addressBar.fill(url);
  await addressBar.press('Enter');
  await expect
    .poll(async () => (await addressBar.inputValue()) === url, { timeout: 10_000 })
    .toBeTruthy();
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByTestId('topbar-tabs-toggle').click();
  await page.getByTestId('tab-drawer').waitFor({ state: 'visible' });
}

async function createNewTab(page: Page): Promise<void> {
  await openDrawer(page);
  await page.getByTestId('tab-drawer-new').click();
  // Drawer auto-closes after new-tab click.
  await page.getByTestId('tab-drawer').waitFor({ state: 'hidden' });
  await waitForAddressBarReady(page);
}

test('three tabs survive restart with correct active tab', async () => {
  const { server, baseUrl } = await startPageServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m2-e2e-'));

  try {
    // ---------- Launch 1: open 3 tabs and activate tab 2 ----------
    {
      const app = await electron.launch({
        args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      });
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        // Tab 1 (existing initial blank) → navigate to /page1.
        await navigateActive(page, `${baseUrl}/page1`);

        // New tab → /page2.
        await createNewTab(page);
        await navigateActive(page, `${baseUrl}/page2`);

        // New tab → /page3.
        await createNewTab(page);
        await navigateActive(page, `${baseUrl}/page3`);

        // Activate tab 2 by finding its drawer row (title "PAGE 2") and clicking.
        await openDrawer(page);
        const tab2Row = page
          .getByTestId('tab-drawer-item')
          .filter({ hasText: 'PAGE 2' })
          .first();
        await tab2Row.click();
        await page.getByTestId('tab-drawer').waitFor({ state: 'hidden' });

        // Confirm active tab's url is /page2.
        await expect
          .poll(
            async () => (await page.getByTestId('address-bar').inputValue()).endsWith('/page2'),
            { timeout: 10_000 },
          )
          .toBeTruthy();
      } finally {
        await app.close();
      }
    }

    // ---------- Launch 2: verify persistence ----------
    {
      const app = await electron.launch({
        args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      });
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        // Address bar should immediately reflect /page2 (the restored active tab).
        await expect
          .poll(
            async () => (await page.getByTestId('address-bar').inputValue()).endsWith('/page2'),
            { timeout: 10_000 },
          )
          .toBeTruthy();

        // Open drawer — expect 3 rows, one per restored page.
        await openDrawer(page);
        const rows = page.getByTestId('tab-drawer-item');
        await expect(rows).toHaveCount(3);

        // Each row's label is either "PAGE N" (title after load) or the URL
        // containing "/pageN". Match both forms case-insensitively.
        for (const n of [1, 2, 3]) {
          await expect(rows.filter({ hasText: new RegExp(`page\\s?${n}`, 'i') })).toHaveCount(1);
        }
      } finally {
        await app.close();
      }
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
