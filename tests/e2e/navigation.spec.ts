import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((res) => {
    const server = createServer((req, response) => {
      if (req.url === '/page1') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE ONE</title><p>page one</p>');
        return;
      }
      if (req.url === '/page2') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE TWO</title><p>page two</p>');
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Wait for the loading spinner (animate-spin) inside the Reload button to
 * appear then disappear.  This is the most reliable "navigation committed"
 * fence available in the renderer: it corresponds to the did-stop-loading
 * Electron event flowing through IPC → Zustand → React.
 *
 * We first wait for the spinner to be present (so we don't declare "done"
 * before the load even starts) and then wait for it to be absent.
 */
async function waitForLoadComplete(window: Awaited<ReturnType<typeof getChromeWindow>>): Promise<void> {
  const spinner = window.locator('.animate-spin');
  // The spinner may flicker on very fast responses, so we give it a generous
  // window to appear and then to go away.
  await expect(spinner).toBeVisible({ timeout: 5_000 }).catch(() => {
    // Spinner may have already disappeared if the load was extremely fast —
    // that's fine; we just fall through and check it's gone.
  });
  await expect(spinner).not.toBeVisible({ timeout: 10_000 });
}

test('address bar navigation updates URL and history', async () => {
  const { server, baseUrl } = await startTestServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-nav-e2e-'));
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs'), `--user-data-dir=${userDataDir}`],
  });

  try {
    const window = await getChromeWindow(app);

    const addressBar = window.getByTestId('address-bar');
    const backButton = window.getByRole('button', { name: 'Back' });

    // Initially on about:blank — Back disabled.
    await expect(backButton).toBeDisabled();

    // Navigate to /page1. Use the loading-spinner disappearance as the
    // "navigation committed" fence — Electron's did-stop-loading flows through
    // IPC → Zustand → React and is reliable where URL polling is not.
    // Note: about:blank → first real page does NOT create a back entry, so
    // canGoBack stays false here; we cannot use toBeEnabled() as the fence.
    await addressBar.fill(`${baseUrl}/page1`);
    await addressBar.press('Enter');
    await waitForLoadComplete(window);
    await expect
      .poll(async () => (await addressBar.inputValue()).endsWith('/page1'), { timeout: 10_000 })
      .toBeTruthy();

    // Navigate to /page2. After this commit page1→page2 history exists, so
    // Back will be enabled. Wait for spinner → gone, then assert Back.
    await addressBar.fill(`${baseUrl}/page2`);
    await addressBar.press('Enter');
    await waitForLoadComplete(window);
    await expect
      .poll(async () => (await addressBar.inputValue()).endsWith('/page2'), { timeout: 10_000 })
      .toBeTruthy();
    await expect(backButton).toBeEnabled();

    // Go back → /page1 should reappear in the address bar.
    await backButton.click();
    await expect
      .poll(async () => (await addressBar.inputValue()).endsWith('/page1'), { timeout: 10_000 })
      .toBeTruthy();
  } finally {
    await app.close();
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
