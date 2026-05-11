import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  getChromeWindow,
  navigateActive,
  waitForAddressBarReady,
} from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/plain') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body>hi</body></html>');
        return;
      }
      if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
      res.statusCode = 404; res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test.describe('chrome dim + window title (M13)', () => {
  let app: ElectronApplication;
  let userDataDir: string;
  let server: Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
  });
  test.afterAll(async () => { server.close(); });

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'sb-chrome-dim-'));
    app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
  });
  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('chrome root acquires filter style + window title clears on dim', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/plain`);

    // Default dim.effect is 'blur'. Trigger the leave watcher.
    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).fireLeaveNow();
    });

    // Chrome root style picks up the inline filter from computeChromeDimStyle.
    await expect.poll(
      () => chrome.evaluate(() => {
        const root = document.querySelector<HTMLDivElement>('[data-testid="chrome-root"]');
        return root?.style.filter ?? '';
      }),
      { timeout: 5_000 },
    ).toMatch(/blur\(\d+px\)/);

    // OS title text is empty while dimmed.
    await expect.poll(
      () => app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return ((globalThis as any).__sidebrowserTestHooks).getWindowTitle();
      }),
      { timeout: 5_000 },
    ).toBe('');

    // Re-enter clears dim.
    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).fireEnterNow();
    });

    await expect.poll(
      () => chrome.evaluate(() => {
        const root = document.querySelector<HTMLDivElement>('[data-testid="chrome-root"]');
        return root?.style.filter ?? '';
      }),
      { timeout: 5_000 },
    ).toBe('');

    await expect.poll(
      () => app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return ((globalThis as any).__sidebrowserTestHooks).getWindowTitle();
      }),
      { timeout: 5_000 },
    ).toBe('sidebrowser');
  });

  test('light effect — chrome overlay div appears at full opacity', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/plain`);

    // Switch dim.effect to 'light' with opacity 1 via test hook.
    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).updateSettings({
        dim: { effect: 'light', lightBrightness: 1 },
      });
    });

    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).fireLeaveNow();
    });

    await expect.poll(
      () => chrome.evaluate(() => {
        const ov = document.querySelector<HTMLDivElement>('[data-testid="chrome-dim-overlay"]');
        if (!ov) return 'missing';
        const cs = getComputedStyle(ov);
        return `${cs.backgroundColor}|${cs.opacity}`;
      }),
      { timeout: 5_000 },
    ).toBe('rgb(255, 255, 255)|1');
  });
});
