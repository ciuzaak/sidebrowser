import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow, waitForAddressBarReady, navigateActive } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface ChObservation {
  ua: string;
  mobile: string | undefined;
  platform: string | undefined;
  platformVersion: string | undefined;
}

interface ChServer {
  readonly server: Server;
  readonly baseUrl: string;
  readonly log: ChObservation[];
}

function startChServer(): Promise<ChServer> {
  const log: ChObservation[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/ua') {
      log.push({
        ua: String(req.headers['user-agent'] ?? ''),
        mobile: req.headers['sec-ch-ua-mobile'] as string | undefined,
        platform: req.headers['sec-ch-ua-platform'] as string | undefined,
        platformVersion: req.headers['sec-ch-ua-platform-version'] as
          | string
          | undefined,
      });
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

test('mobile tab injects Sec-CH-UA-Mobile/Platform; desktop toggle clears them', async () => {
  const { server, baseUrl, log } = await startChServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m10-ch-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    });
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // ---------- Phase 1: 默认 mobile → 头注入 ----------
      await navigateActive(page, `${baseUrl}/ua`);
      await expect.poll(() => log.length >= 1, { timeout: 10_000 }).toBeTruthy();
      const mobileObs = log[log.length - 1]!;
      expect(mobileObs.ua).toMatch(/iPhone/);
      expect(mobileObs.mobile).toBe('?1');
      expect(mobileObs.platform).toBe('"iOS"');
      expect(mobileObs.platformVersion).toBe('"17.4"');

      // ---------- Phase 2: 切 desktop → 头不再被覆写 ----------
      const beforeToggle = log.length;
      await page.getByTestId('topbar-ua-toggle').click();
      await expect
        .poll(() => log.length > beforeToggle, { timeout: 10_000 })
        .toBeTruthy();
      const desktopObs = log[log.length - 1]!;
      expect(desktopObs.ua).not.toMatch(/iPhone/);
      // 切到 desktop 后，handler 的 lookup 返回 null → callback({}) 透传，
      // Chromium 自己发什么就发什么——关键断言：不是 ?1（说明我们的 mobile 注入已经停了）
      // 且 platform 不再被强行设为 "iOS"。
      expect(desktopObs.mobile).not.toBe('?1');
      expect(desktopObs.platform).not.toBe('"iOS"');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
