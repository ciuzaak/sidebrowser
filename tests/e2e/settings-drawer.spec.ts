import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  getActiveFilter,
  getChromeWindow,
  navigateActive,
  waitForAddressBarReady,
} from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

// ---------------------------------------------------------------------------
// Minimal inline types — avoid importing from src/* because @shared alias
// isn't resolvable inside the e2e TS project (see edge-dock.spec.ts §20).
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SettingsLike {
  dim: { blurPx: number; effect: string; [k: string]: unknown };
  lifecycle: { restoreTabsOnLaunch: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tiny HTTP server — serves a couple of plain-HTML paths so tests have
// something to navigate to (needed to observe live blur filter + bounds).
// ---------------------------------------------------------------------------

function startPlainServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/plain' || url.startsWith('/plain?') || url.startsWith('/plain/')) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><body>plain</body></html>');
        return;
      }
      if (url === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared launch helper — same args + env that persistence.spec.ts uses.
// ---------------------------------------------------------------------------

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

// ---------------------------------------------------------------------------
// Drawer helpers.
// ---------------------------------------------------------------------------

async function openSettingsDrawer(page: Page): Promise<void> {
  await page.getByTestId('topbar-settings-toggle').click();
  await page.getByTestId('settings-drawer').waitFor({ state: 'visible' });
}

async function closeSettingsDrawer(page: Page): Promise<void> {
  await page.getByTestId('settings-close').click();
  await page.getByTestId('settings-drawer').waitFor({ state: 'hidden' });
}

/**
 * React's synthetic onChange on `<input type="range">` doesn't always fire
 * from Playwright's `.fill(...)` — the native value setter bypasses React's
 * internal tracking. Use the standard prototype-setter + dispatchEvent dance.
 */
async function setRangeValue(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('HTMLInputElement.prototype.value setter missing');
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// ---------------------------------------------------------------------------
// Main-side observation helpers — thin wrappers over __sidebrowserTestHooks.
// ---------------------------------------------------------------------------

async function getActiveViewBounds(app: ElectronApplication): Promise<Rect | null> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveViewBounds: () => Rect | null;
    };
    return h.getActiveViewBounds();
  });
}

async function getSettings(app: ElectronApplication): Promise<SettingsLike> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getSettings: () => SettingsLike;
    };
    return h.getSettings();
  });
}

async function getWindowBounds(app: ElectronApplication): Promise<Rect> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getWindowBounds: () => Rect;
    };
    return h.getWindowBounds();
  });
}

async function setWindowBounds(app: ElectronApplication, b: Rect): Promise<void> {
  await app.evaluate(async (_electron, bounds: Rect) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      setWindowBounds: (b: Rect) => void;
    };
    h.setWindowBounds(bounds);
  }, b);
}

async function flushWindowBounds(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      flushWindowBounds: () => void;
    };
    h.flushWindowBounds();
  });
}

async function fireLeaveNow(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      fireLeaveNow: () => void;
    };
    h.fireLeaveNow();
  });
}

// ---------------------------------------------------------------------------
// Test 1 — drawer open/close suppresses and restores the active WebContentsView.
// ---------------------------------------------------------------------------

test('drawer open suppresses active view bounds; close restores them', async () => {
  const { server, baseUrl } = await startPlainServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-settings-'));

  try {
    const app = await launch(userDataDir);
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await navigateActive(page, `${baseUrl}/plain`);

      // Baseline: active view occupies non-zero area.
      const initial = await getActiveViewBounds(app);
      expect(initial).not.toBeNull();
      expect(initial!.width).toBeGreaterThan(0);
      expect(initial!.height).toBeGreaterThan(0);

      // Open drawer → IPC view:set-suppressed fires → bounds shrink to zero.
      await openSettingsDrawer(page);
      await expect
        .poll(async () => (await getActiveViewBounds(app))?.width ?? -1, { timeout: 10_000 })
        .toBe(0);
      const suppressed = await getActiveViewBounds(app);
      expect(suppressed).toEqual({ x: 0, y: 0, width: 0, height: 0 });

      // Close drawer → bounds restored to non-zero.
      await closeSettingsDrawer(page);
      await expect
        .poll(async () => (await getActiveViewBounds(app))?.width ?? 0, { timeout: 10_000 })
        .toBeGreaterThan(0);
      const restored = await getActiveViewBounds(app);
      expect(restored!.height).toBeGreaterThan(0);
      expect(restored!.width).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — live blur: dragging the Dim → Blur slider re-renders the CSS
// filter on the active WebContents while dim is active.
// ---------------------------------------------------------------------------

test('dim blur slider live-updates active WebContents filter', async () => {
  const { server, baseUrl } = await startPlainServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-settings-'));

  try {
    const app = await launch(userDataDir);
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await navigateActive(page, `${baseUrl}/plain`);

      // Activate dim (default effect='blur', blurPx=8).
      await fireLeaveNow(app);
      await expect
        .poll(() => getActiveFilter(app), { timeout: 10_000 })
        .toContain('blur(8px)');

      // Open drawer and drive the slider via the React-aware helper.
      await openSettingsDrawer(page);
      await setRangeValue(page.getByTestId('settings-dim-blur'), 16);

      // restyle() path: settings broadcast → DimController.restyle → insertCSS
      // with blur(16px). Poll — the round-trip is async.
      await expect
        .poll(() => getActiveFilter(app), { timeout: 10_000 })
        .toContain('blur(16px)');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — settings persist across restart (dim.blurPx round-trips through
// electron-store on disk in the shared userDataDir).
// ---------------------------------------------------------------------------

test('dim.blurPx persists across app restart', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-settings-'));

  try {
    // Launch 1: drive the slider via the DOM so we exercise onChange +
    // IPC + store.update + backend.set end-to-end.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        await openSettingsDrawer(page);
        await setRangeValue(page.getByTestId('settings-dim-blur'), 24);

        // Wait for the settings:changed round-trip to land in the main store
        // (slider onChange → IPC → store.update → onChanged fires → persisted
        // to disk synchronously inside store.update).
        await expect
          .poll(async () => (await getSettings(app)).dim.blurPx, { timeout: 10_000 })
          .toBe(24);
      } finally {
        await app.close();
      }
    }

    // Launch 2: same userDataDir. electron-store should rehydrate dim.blurPx=24.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        const s = await getSettings(app);
        expect(s.dim.blurPx).toBe(24);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — window bounds persist across restart.
// ---------------------------------------------------------------------------

test('window bounds persist across app restart', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-settings-'));
  const target: Rect = { x: 100, y: 100, width: 500, height: 700 };

  try {
    // Launch 1: move/resize window, flush the debounced persister, close.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        await setWindowBounds(app, target);
        // win.setBounds is synchronous on the main side, but the OS may clamp
        // width/height and fire `resize` asynchronously. Poll until the
        // window reports the target bounds before flushing.
        await expect
          .poll(async () => (await getWindowBounds(app)).width, { timeout: 5_000 })
          .toBe(target.width);

        // Force immediate persist (don't depend on before-quit ordering).
        await flushWindowBounds(app);
      } finally {
        await app.close();
      }
    }

    // Launch 2: bounds should rehydrate to `target`, not default-centered.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        const b = await getWindowBounds(app);
        expect(b).toEqual(target);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — restoreTabsOnLaunch=false → relaunch starts with a blank tab, not
// the previously-navigated URL.
// ---------------------------------------------------------------------------

test('restoreTabsOnLaunch=false relaunches with about:blank, not persisted tab', async () => {
  const { server, baseUrl } = await startPlainServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-settings-'));

  try {
    // Launch 1: navigate, then uncheck restoreTabsOnLaunch.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        await navigateActive(page, `${baseUrl}/plain`);

        await openSettingsDrawer(page);
        await page.getByTestId('settings-lifecycle-restore-tabs').uncheck();

        // Verify the store saw the toggle before we close.
        await expect
          .poll(
            async () => (await getSettings(app)).lifecycle.restoreTabsOnLaunch,
            { timeout: 10_000 },
          )
          .toBe(false);
      } finally {
        await app.close();
      }
    }

    // Launch 2: same userDataDir. Active tab should be about:blank.
    {
      const app = await launch(userDataDir);
      try {
        const page = await getChromeWindow(app);
        await waitForAddressBarReady(page);

        // Address bar reflects the active tab's URL — for a blank tab it's
        // either empty string or 'about:blank'. Both signal the /plain URL
        // was NOT restored.
        await expect
          .poll(
            async () => {
              const val = await page.getByTestId('address-bar').inputValue();
              return val.includes('/plain');
            },
            { timeout: 5_000 },
          )
          .toBe(false);

        const addressValue = await page.getByTestId('address-bar').inputValue();
        expect(['', 'about:blank']).toContain(addressValue);
      } finally {
        await app.close();
      }
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
