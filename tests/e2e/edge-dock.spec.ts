import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
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
// Minimal EdgeDockState shape — only .kind is checked in these tests.
// Avoids importing from src/main/ which uses @shared alias not resolvable here.
// ---------------------------------------------------------------------------

type EdgeDockStateKind =
  | 'DOCKED_NONE'
  | 'DOCKED_LEFT'
  | 'DOCKED_RIGHT'
  | 'HIDING'
  | 'REVEALING'
  | 'HIDDEN_LEFT'
  | 'HIDDEN_RIGHT';

interface EdgeDockState {
  kind: EdgeDockStateKind;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Minimal HTTP server — just /plain (for step 8 DOCKED_NONE dim regression)
// ---------------------------------------------------------------------------

function startMinimalServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/plain' || url.startsWith('/plain?') || url.startsWith('/plain/')) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body>plain</body></html>');
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
// Test-hook helpers — thin wrappers around app.evaluate / globalThis.__sidebrowserTestHooks
// ---------------------------------------------------------------------------

async function callHook<T>(app: ElectronApplication, fn: string): Promise<T> {
  return app.evaluate(async (_electron, fnName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as Record<string, () => unknown>;
    return h[fnName]() as T;
  }, fn);
}

async function getState(app: ElectronApplication): Promise<EdgeDockState> {
  return callHook<EdgeDockState>(app, 'getEdgeDockState');
}

async function getWindowBounds(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return callHook(app, 'getWindowBounds');
}

async function setWindowBounds(
  app: ElectronApplication,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await app.evaluate(
    async (_electron, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = (globalThis as any).__sidebrowserTestHooks as {
        setWindowBounds: (b: unknown) => void;
      };
      h.setWindowBounds(b);
    },
    bounds,
  );
}

async function emitWindowMoved(app: ElectronApplication): Promise<void> {
  await callHook<void>(app, 'emitWindowMoved');
}

async function emitDisplayChanged(app: ElectronApplication): Promise<void> {
  await callHook<void>(app, 'emitDisplayChanged');
}

async function fireLeaveNow(app: ElectronApplication): Promise<void> {
  await callHook<void>(app, 'fireLeaveNow');
}

async function fireEnterNow(app: ElectronApplication): Promise<void> {
  await callHook<void>(app, 'fireEnterNow');
}

async function getPrimaryWorkArea(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.evaluate(async ({ screen }) => screen.getPrimaryDisplay().workArea);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('EdgeDock: dock detection, hide/reveal animation, mid-hide cancel, display change, DOCKED_NONE dim regression', async () => {
  const { server, baseUrl } = await startMinimalServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m5-edge-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });

    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await navigateActive(page, `${baseUrl}/plain`);

      const workArea = await getPrimaryWorkArea(app);

      // ---- Step 2: Dock detection (left edge) ----
      // Place window flush against the left edge of the primary workArea.
      await setWindowBounds(app, {
        x: workArea.x,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitWindowMoved(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_LEFT');

      // ---- Step 3: Hide animation ----
      // MOUSE_LEAVE while DOCKED_LEFT → HIDING → HIDDEN_LEFT
      // Expected hidden x = workArea.x - windowWidth + triggerStripPx = workArea.x - 393 + 3
      const hiddenLeftX = workArea.x - 393 + 3;
      await fireLeaveNow(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('HIDDEN_LEFT');
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(hiddenLeftX);

      // ---- Step 4: Reveal ----
      // MOUSE_ENTER while HIDDEN_LEFT → REVEALING → DOCKED_LEFT
      await fireEnterNow(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_LEFT');
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(workArea.x);

      // ---- Step 5: Mid-hide cancel ----
      // Fire LEAVE to start HIDING, then immediately fire ENTER before the animation finishes.
      // The reducer transitions HIDING + MOUSE_ENTER → REVEALING, then ANIM_DONE → DOCKED_LEFT.
      // Final state must be DOCKED_LEFT with x back at workArea.x.
      await fireLeaveNow(app);
      // No explicit wait — fire ENTER immediately while HIDING interval may still be running.
      await fireEnterNow(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_LEFT');
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(workArea.x);

      // ---- Step 6: Undock (drag off edge) ----
      // Move window 200px inside workArea — no longer touching left edge.
      await setWindowBounds(app, {
        x: workArea.x + 200,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitWindowMoved(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_NONE');

      // ---- Step 7: Display change (offscreen → snap to primary workArea center) ----
      // Move far off-screen to simulate a display being unplugged / resolution change.
      await setWindowBounds(app, {
        x: -5000,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitDisplayChanged(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_NONE');
      // Executor does: setWindowX(workArea.x + (workArea.width - windowWidth) / 2) with Math.round.
      const expectedCenterX = Math.round(workArea.x + (workArea.width - 393) / 2);
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(expectedCenterX);

      // ---- Step 8: Regression — DOCKED_NONE + leave → dim only, no window move ----
      // Move window clearly off any edge so WINDOW_MOVED yields DOCKED_NONE.
      await setWindowBounds(app, {
        x: workArea.x + 200,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitWindowMoved(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_NONE');

      const xBefore = (await getWindowBounds(app)).x;

      await fireLeaveNow(app);

      // Dim should apply (blur filter injected via insertCSS — async, so poll with 10s budget).
      await expect
        .poll(() => getActiveFilter(app), { timeout: 10_000 })
        .toContain('blur');

      // Window position must NOT have changed (M4 DOCKED_NONE dim-only path).
      const xAfter = (await getWindowBounds(app)).x;
      expect(xAfter).toBe(xBefore);

      // Cleanup: clear dim so the app is in a clean state before close.
      await fireEnterNow(app);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
