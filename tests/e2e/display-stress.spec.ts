import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

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

async function setCloseAction(
  app: ElectronApplication,
  v: 'quit' | 'minimize-to-tray',
): Promise<void> {
  await app.evaluate(async (_e, val) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      setCloseAction: (v: string) => unknown;
    };
    h.setCloseAction(val);
  }, v);
}

async function getIsWindowVisible(app: ElectronApplication): Promise<boolean> {
  return callHook<boolean>(app, 'getIsWindowVisible');
}

async function getPrimaryWorkArea(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.evaluate(async ({ screen }) => screen.getPrimaryDisplay().workArea);
}

// ---------------------------------------------------------------------------
// Test 1 — HIDDEN_LEFT + offscreen display change → SNAP_TO_CENTER (spec §10)
// ---------------------------------------------------------------------------

test('display-stress: HIDDEN_LEFT + offscreen display change → DOCKED_NONE + snap to center', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-display-stress-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });

    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // Default closeAction is 'minimize-to-tray' — override to 'quit' so
      // app.close() in teardown doesn't hang waiting on a tray hide.
      await setCloseAction(app, 'quit');

      const workArea = await getPrimaryWorkArea(app);

      // Step 1: Dock window to the left edge.
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

      // Step 2: Trigger MOUSE_LEAVE → HIDING → HIDDEN_LEFT.
      await fireLeaveNow(app);
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('HIDDEN_LEFT');

      // Window is now hidden off the left edge at approximately:
      // x = workArea.x - 393 + 3 (triggerStripPx)
      // Verify the actual hidden position before we move it further.
      const hiddenLeftX = workArea.x - 393 + 3;
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(hiddenLeftX);

      // Step 3: Simulate display unplug by moving window far offscreen,
      // then fire the display-changed handler. The onDisplayChanged handler
      // reads real screen.getAllDisplays() and detects the window is outside
      // all display bounds → triggers SNAP_TO_CENTER.
      await setWindowBounds(app, {
        x: -10000,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitDisplayChanged(app);

      // Step 4: Assert reducer resets to DOCKED_NONE (snap-to-center clears dock).
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_NONE');

      // Step 5: Assert window is still visible (snap-to-center shows, not hides).
      await expect
        .poll(() => getIsWindowVisible(app), { timeout: 5_000 })
        .toBe(true);

      // Step 6: Assert window bounds are inside primary workArea, centered.
      // Executor: setWindowX(Math.round(workArea.x + (workArea.width - windowWidth) / 2)).
      // Poll the bounds read to match edge-dock.spec.ts style — win.setBounds → OS report
      // has tiny latency on Windows; polling eliminates theoretical races with the state poll.
      const expectedCenterX = Math.round(workArea.x + (workArea.width - 393) / 2);
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(expectedCenterX);
      const finalBounds = await getWindowBounds(app);
      expect(finalBounds.x).toBeGreaterThanOrEqual(workArea.x);
      expect(finalBounds.x + finalBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — DOCKED_LEFT + offscreen display change → SNAP_TO_CENTER (spec §10)
// Verifies snap-to-center works from a non-hidden docked state too.
// ---------------------------------------------------------------------------

test('display-stress: DOCKED_LEFT + offscreen display change → DOCKED_NONE + snap to center', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-display-stress-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });

    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // Default closeAction is 'minimize-to-tray' — override to 'quit' so
      // app.close() in teardown doesn't hang waiting on a tray hide.
      await setCloseAction(app, 'quit');

      const workArea = await getPrimaryWorkArea(app);

      // Step 1: Dock window to the left edge (stay in DOCKED_LEFT — no hide step).
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

      // Step 2: Simulate display unplug from DOCKED_LEFT state.
      await setWindowBounds(app, {
        x: -10000,
        y: workArea.y + 40,
        width: 393,
        height: 852,
      });
      await emitDisplayChanged(app);

      // Step 3: Assert reducer resets to DOCKED_NONE (snap-to-center clears dock).
      await expect
        .poll(async () => (await getState(app)).kind, { timeout: 5_000 })
        .toBe('DOCKED_NONE');

      // Step 4: Assert window is still visible.
      await expect
        .poll(() => getIsWindowVisible(app), { timeout: 5_000 })
        .toBe(true);

      // Step 5: Assert window bounds are inside primary workArea, centered.
      // Polled bounds read for parity with edge-dock.spec.ts (OS-report latency buffer).
      const expectedCenterX = Math.round(workArea.x + (workArea.width - 393) / 2);
      await expect
        .poll(async () => (await getWindowBounds(app)).x, { timeout: 5_000 })
        .toBe(expectedCenterX);
      const finalBounds = await getWindowBounds(app);
      expect(finalBounds.x).toBeGreaterThanOrEqual(workArea.x);
      expect(finalBounds.x + finalBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
