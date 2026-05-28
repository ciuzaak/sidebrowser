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
  brands: string | undefined;
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
        brands: req.headers['sec-ch-ua'] as string | undefined,
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
      expect(mobileObs.ua).toMatch(/Android/);
      // M15: the rewriter now also forces a consistent Android-Chrome brand list
      // so cross-origin OOPIFs (Cloudflare Turnstile iframe) match the top frame.
      expect(mobileObs.brands).toContain('Google Chrome');
      expect(mobileObs.mobile).toBe('?1');
      expect(mobileObs.platform).toBe('"Android"');
      expect(mobileObs.platformVersion).toBe('"14"');

      // ---------- Phase 2: 切 desktop → 头不再被覆写 ----------
      const beforeToggle = log.length;
      await page.getByTestId('topbar-ua-toggle').click();
      await expect
        .poll(() => log.length > beforeToggle, { timeout: 10_000 })
        .toBeTruthy();
      const desktopObs = log[log.length - 1]!;
      expect(desktopObs.ua).not.toMatch(/Android/);
      // 切到 desktop 后，handler 的 lookup 返回 null → callback({}) 透传，
      // Chromium 自己发什么就发什么——关键断言：不是 ?1（说明我们的 mobile 注入已经停了）
      // 且 platform 不再被强行设为 "Android"。
      expect(desktopObs.mobile).not.toBe('?1');
      expect(desktopObs.platform).not.toBe('"Android"');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

interface FrameObs {
  host: string;
  ua: string;
  mobile: string | undefined;
  platform: string | undefined;
}

/**
 * Server whose `/top` page embeds a cross-SITE iframe (127.0.0.1 top → localhost
 * frame; different hosts ⇒ different sites ⇒ out-of-process iframe under
 * site-per-process — the exact Cloudflare-Turnstile shape). Logs the headers the
 * `/frame` subframe request actually sends so we can assert the rewriter reached
 * it (the OOPIF request carries the host tab's webContentsId).
 */
function startOopifServer(): Promise<{ server: Server; port: number; frameLog: FrameObs[] }> {
  const frameLog: FrameObs[] = [];
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === '/top') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<!doctype html><title>top</title><body><iframe src="http://localhost:${port}/frame"></iframe></body>`,
      );
      return;
    }
    if (req.url === '/frame') {
      frameLog.push({
        host: String(req.headers.host ?? ''),
        ua: String(req.headers['user-agent'] ?? ''),
        mobile: req.headers['sec-ch-ua-mobile'] as string | undefined,
        platform: req.headers['sec-ch-ua-platform'] as string | undefined,
      });
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>frame</title>ok');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((done) => {
    // Dual-stack bind ('::') so BOTH the IPv4 top origin (127.0.0.1) and the
    // iframe origin `localhost` — which may resolve to ::1 or 127.0.0.1 — reach
    // this one server. Binding to 127.0.0.1 only would flake on IPv6-localhost
    // hosts (the iframe request would never connect).
    server.listen(0, '::', () => {
      port = (server.address() as AddressInfo).port;
      done({ server, port, frameLog });
    });
  });
}

test('M15: cross-site subframe (OOPIF) request also carries the mobile UA + Client Hints', async () => {
  const { server, port, frameLog } = await startOopifServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m15-oopif-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // Top page on 127.0.0.1 embeds an iframe from localhost (cross-site → OOPIF).
      await navigateActive(page, `http://127.0.0.1:${port}/top`);
      await expect.poll(() => frameLog.length >= 1, { timeout: 15_000 }).toBeTruthy();

      const frame = frameLog[frameLog.length - 1]!;
      // The subframe is served from the localhost origin (proves it's the iframe,
      // not the top frame) and must still present the mobile Android identity.
      expect(frame.host).toContain('localhost');
      expect(frame.ua).toMatch(/Android/);
      expect(frame.ua).not.toMatch(/Electron/);
      expect(frame.mobile).toBe('?1');
      expect(frame.platform).toBe('"Android"');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
