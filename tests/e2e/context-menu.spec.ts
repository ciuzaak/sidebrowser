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
      if (url === '/page') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<html><body><a id="lnk" href="https://target.example/x">target</a>' +
          '<p id="t">hello world example</p></body></html>',
        );
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

test.describe('context menu (M13)', () => {
  let app: ElectronApplication;
  let userDataDir: string;
  let server: Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
  });
  test.afterAll(async () => { server.close(); });

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'sb-ctx-'));
    app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
  });
  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('right-click on a link emits a menu including the link items', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/page`);

    const labels = await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        getActiveWebContents: () => Electron.WebContents | null;
        simulateContextMenu: (wc: Electron.WebContents, p: { linkURL?: string; selectionText?: string }) => string[];
      };
      const wc = h.getActiveWebContents();
      if (!wc) throw new Error('no active wc');
      return h.simulateContextMenu(wc, { linkURL: 'https://target.example/x' });
    });

    expect(labels.slice(0, 4)).toEqual([
      'Open link in new tab',
      'Open link in system browser',
      'Copy link address',
      '---',
    ]);
    expect(labels).toContain('Back');
    expect(labels).toContain('Open page in system browser');
    expect(labels).toContain('View source');
  });

  test('text selection right-click prepends Copy + Search Google', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/page`);

    const labels = await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        getActiveWebContents: () => Electron.WebContents | null;
        simulateContextMenu: (wc: Electron.WebContents, p: { linkURL?: string; selectionText?: string }) => string[];
      };
      const wc = h.getActiveWebContents();
      if (!wc) throw new Error('no active wc');
      return h.simulateContextMenu(wc, { selectionText: 'hello world example' });
    });

    expect(labels[0]).toBe('Copy');
    expect(labels[1]).toBe('Search Google for "hello world example"');
    expect(labels[2]).toBe('---');
  });

  test('page-only right-click (no link, no selection) returns the page block', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/page`);

    const labels = await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        getActiveWebContents: () => Electron.WebContents | null;
        simulateContextMenu: (wc: Electron.WebContents, p: { linkURL?: string; selectionText?: string }) => string[];
      };
      const wc = h.getActiveWebContents();
      if (!wc) throw new Error('no active wc');
      return h.simulateContextMenu(wc, {});
    });

    expect(labels).toEqual([
      'Back',
      'Forward',
      'Reload',
      '---',
      'Open page in system browser',
      'Copy page URL',
      '---',
      'View source',
    ]);
  });
});
