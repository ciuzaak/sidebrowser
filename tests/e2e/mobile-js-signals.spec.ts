import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow, waitForAddressBarReady, navigateActive } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface MobileSignals {
  uaDataMobile: boolean | null;
  uaDataPlatform: string | null;
  pointerCoarse: boolean;
  hoverNone: boolean;
  hasTouch: boolean;
}

/** Tiny static page so the active webContents has a real document for matchMedia / navigator queries. */
function startPage(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>signals</title><body>ok</body>');
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Read the four mobile-emulation signals from the active webContents via main-process test hooks. */
async function readSignals(app: ElectronApplication): Promise<MobileSignals | null> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    const wc = h.getActiveWebContents();
    if (!wc) return null;
    return wc.executeJavaScript(`
      (function() {
        const uad = navigator.userAgentData;
        return {
          uaDataMobile: uad ? uad.mobile : null,
          uaDataPlatform: uad ? uad.platform : null,
          pointerCoarse: matchMedia('(pointer: coarse)').matches,
          hoverNone: matchMedia('(hover: none)').matches,
          hasTouch: 'ontouchstart' in window,
        };
      })();
    `) as Promise<MobileSignals>;
  });
}

test('mobile tab flips userAgentData / pointer / hover / touch signals; desktop toggle restores defaults', async () => {
  const { server, baseUrl } = await startPage();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m10-signals-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      // CDP attach + 4 commands take a few hundred ms over the debugger channel.
      // Real users take seconds typing a URL — this approximates that. Without
      // the wait, the first navigation can race the attach and 'ontouchstart'
      // (frozen at window creation time) misses the touch state.
      await new Promise((r) => setTimeout(r, 1_500));

      // ---------- Phase 1: 默认 mobile → 4 信号全 true ----------
      await navigateActive(page, baseUrl);
      await expect
        .poll(async () => {
          const s = await readSignals(app);
          return s && s.hasTouch === true;
        }, { timeout: 15_000 })
        .toBeTruthy();
      const mobileSignals = await readSignals(app);
      expect(mobileSignals).not.toBeNull();
      expect(mobileSignals!.uaDataMobile).toBe(true);
      expect(mobileSignals!.uaDataPlatform).toBe('iOS');
      expect(mobileSignals!.pointerCoarse).toBe(true);
      expect(mobileSignals!.hoverNone).toBe(true);
      expect(mobileSignals!.hasTouch).toBe(true);

      // ---------- Phase 2: 切 desktop → 4 信号回 Chromium 默认 ----------
      await page.getByTestId('topbar-ua-toggle').click();
      // 切换会 reloadIgnoringCache；等到 page reload 完成且信号反转
      await expect
        .poll(async () => {
          const s = await readSignals(app);
          return s && s.hasTouch === false;
        }, { timeout: 15_000 })
        .toBeTruthy();
      const desktopSignals = await readSignals(app);
      expect(desktopSignals).not.toBeNull();
      expect(desktopSignals!.uaDataMobile).toBe(false);
      expect(desktopSignals!.uaDataPlatform).not.toBe('iOS');
      expect(desktopSignals!.pointerCoarse).toBe(false);
      expect(desktopSignals!.hoverNone).toBe(false);
      expect(desktopSignals!.hasTouch).toBe(false);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
