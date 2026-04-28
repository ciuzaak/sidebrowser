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

/**
 * Regression: M10 mobile emulation passed `host window contentBounds` as
 * `screenSize`/`viewSize` to enableDeviceEmulation, but the actual webview area
 * is `contentBounds.height - chromeHeightPx`. The emulated viewport was taller
 * than the rendered region, so `position: fixed; bottom: 0` elements (e.g.
 * x.com mobile bottom nav) rendered at the emulated bottom — past the visible
 * cutoff. The fix is to use the webview's actual bounds and re-apply on resize
 * + chromeHeight changes.
 */

function startPage(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>vp</title><body>ok</body>');
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readInnerHeight(app: ElectronApplication): Promise<number | null> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    const wc = h.getActiveWebContents();
    if (!wc) return null;
    return wc.executeJavaScript('window.innerHeight') as Promise<number>;
  });
}

interface Bounds { x: number; y: number; width: number; height: number }

async function readViewBounds(app: ElectronApplication): Promise<Bounds | null> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveViewBounds: () => Bounds | null;
    };
    return h.getActiveViewBounds();
  });
}

async function readWindowBounds(app: ElectronApplication): Promise<Bounds> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getWindowBounds: () => Bounds;
    };
    return h.getWindowBounds();
  });
}

async function setWindowBounds(app: ElectronApplication, b: Bounds): Promise<void> {
  // app.evaluate calls `pageFunction(electronApp, arg)`, so the first param is
  // the electron module — the user arg is the second.
  await app.evaluate(
    async (_electron, bounds) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        setWindowBounds: (b: unknown) => void;
      };
      h.setWindowBounds(bounds);
    },
    b,
  );
}

test('mobile tab innerHeight matches webview height initially and after window resize', async () => {
  const { server, baseUrl } = await startPage();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-mobile-vp-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      // CDP attach + setChromeHeight IPC race the initial about:blank load;
      // give them time to settle before the first real navigation.
      await new Promise((r) => setTimeout(r, 1_500));

      await navigateActive(page, baseUrl);

      // Phase 1: emulated viewport (window.innerHeight) tracks the actual
      // webview pixel height, not the host window content height. With the
      // pre-fix code this fails by ~chromeHeightPx (typically 80–120 px).
      await expect
        .poll(
          async () => {
            const inner = await readInnerHeight(app);
            const view = await readViewBounds(app);
            if (inner == null || view == null) return null;
            return Math.abs(inner - view.height);
          },
          { timeout: 15_000 },
        )
        .toBeLessThanOrEqual(1);

      // Phase 2: resize the host window taller. The webview height changes via
      // applyBounds; the emulated viewport must follow (debounced reapply).
      const initial = await readWindowBounds(app);
      await setWindowBounds(app, { ...initial, height: initial.height + 200 });

      await expect
        .poll(
          async () => {
            const inner = await readInnerHeight(app);
            const view = await readViewBounds(app);
            if (inner == null || view == null) return null;
            return Math.abs(inner - view.height);
          },
          { timeout: 5_000 },
        )
        .toBeLessThanOrEqual(1);

      // Sanity: the webview actually grew (rules out "both stayed at the old
      // value" passing the equality check).
      const finalView = await readViewBounds(app);
      expect(finalView!.height).toBeGreaterThan(initial.height);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
