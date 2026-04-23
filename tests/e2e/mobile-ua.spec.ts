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

interface UaServer {
  readonly server: Server;
  readonly baseUrl: string;
  /** All UA strings observed on /ua requests, in arrival order. */
  readonly log: string[];
}

function startUaServer(): Promise<UaServer> {
  const log: string[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/ua') {
      log.push(String(req.headers['user-agent'] ?? ''));
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>UA</title><pre id="ua"></pre>');
      return;
    }
    if (req.url === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}`, log });
    });
  });
}

async function waitForAddressBarReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
      return Boolean(el && !el.disabled);
    },
    { timeout: 10_000 },
  );
}

async function navigateActive(page: Page, url: string): Promise<void> {
  const bar = page.getByTestId('address-bar');
  await bar.fill(url);
  await bar.press('Enter');
  await expect
    .poll(async () => (await bar.inputValue()) === url, { timeout: 10_000 })
    .toBeTruthy();
}

test('per-tab UA toggle reloads under new UA and persists across restart', async () => {
  const { server, baseUrl, log } = await startUaServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m3-ua-'));

  try {
    // ---------- Phase 1: mobile (default) → toggle to desktop ----------
    {
      const app = await electron.launch({
        args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      });
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        // Navigate active tab to /ua; first request should carry the mobile UA.
        await navigateActive(page, `${baseUrl}/ua`);
        await expect.poll(() => log.length >= 1, { timeout: 10_000 }).toBeTruthy();
        const mobileUa = log[log.length - 1];
        expect(mobileUa).toMatch(/iPhone/);

        // Click the UA toggle → setMobile(false) → reloadIgnoringCache fires a
        // fresh /ua request carrying the desktop UA.
        const beforeToggle = log.length;
        await page.getByTestId('topbar-ua-toggle').click();
        await expect
          .poll(() => log.length > beforeToggle, { timeout: 10_000 })
          .toBeTruthy();
        const desktopUa = log[log.length - 1];
        expect(desktopUa).not.toMatch(/iPhone/);
        expect(desktopUa.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    }

    // ---------- Phase 2: restart, expect restored tab to reload as desktop ----------
    const snapshotBeforeRestart = log.length;
    {
      const app = await electron.launch({
        args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      });
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        // Address bar should reflect the restored /ua URL.
        await expect
          .poll(
            async () => (await page.getByTestId('address-bar').inputValue()).endsWith('/ua'),
            { timeout: 10_000 },
          )
          .toBeTruthy();

        // The restored tab auto-loads /ua; persisted isMobile=false ⇒ request
        // should carry the desktop UA.
        await expect
          .poll(() => log.length > snapshotBeforeRestart, { timeout: 10_000 })
          .toBeTruthy();
        const restoredUa = log[log.length - 1];
        expect(restoredUa).not.toMatch(/iPhone/);
        expect(restoredUa.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
