import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface CookieSpy {
  readonly server: Server;
  readonly baseUrl: string;
  readonly observed: Map<string, string[]>; // path → list of cookie headers seen
}

function startCookieServer(): Promise<CookieSpy> {
  return new Promise((res) => {
    const observed = new Map<string, string[]>();
    const server = createServer((req: IncomingMessage, response: ServerResponse) => {
      const path = req.url ?? '/';
      const cookie = req.headers.cookie ?? '';
      const list = observed.get(path) ?? [];
      list.push(cookie);
      observed.set(path, list);

      if (path === '/set') {
        response.setHeader(
          'Set-Cookie',
          'sidebrowser_test=persisted-value; Path=/; Max-Age=3600; SameSite=Lax',
        );
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>cookie set</title><p>cookie set</p>');
        return;
      }
      if (path === '/read') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>cookie read</title><p>cookie read</p>');
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}`, observed });
    });
  });
}

async function launchAndNavigate(baseUrl: string, subpath: string, userDataDir: string): Promise<void> {
  const app = await electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
  });
  try {
    const window = await getChromeWindow(app);
    const addressBar = window.getByTestId('address-bar');
    await addressBar.fill(`${baseUrl}${subpath}`);
    await addressBar.press('Enter');

    await expect
      .poll(async () => (await addressBar.inputValue()).endsWith(subpath), { timeout: 10_000 })
      .toBeTruthy();
  } finally {
    await app.close();
  }
}

test('cookies survive app restart (persistent session)', async () => {
  const spy = await startCookieServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-'));

  try {
    // Launch 1: set the cookie.
    await launchAndNavigate(spy.baseUrl, '/set', userDataDir);

    // Launch 2: navigate to /read; the request should carry the cookie set in launch 1.
    await launchAndNavigate(spy.baseUrl, '/read', userDataDir);

    const readRequests = spy.observed.get('/read') ?? [];
    expect(readRequests.length).toBeGreaterThan(0);
    expect(readRequests[0]).toContain('sidebrowser_test=persisted-value');
  } finally {
    spy.server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
