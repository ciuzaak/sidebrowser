import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

// ---------------------------------------------------------------------------
// Shared launch helper.
// ---------------------------------------------------------------------------

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

// ---------------------------------------------------------------------------
// Hook helpers — thin wrappers over __sidebrowserTestHooks (main process).
// ---------------------------------------------------------------------------

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

async function requestWindowClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      requestWindowClose: () => void;
    };
    h.requestWindowClose();
  });
}

async function getIsWindowVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getIsWindowVisible: () => boolean;
    };
    return h.getIsWindowVisible();
  });
}

// ---------------------------------------------------------------------------
// Test 1 — closeAction='minimize-to-tray' hides the window without quitting.
// ---------------------------------------------------------------------------

test('closeAction=minimize-to-tray hides window without quitting', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-tray-'));
  try {
    const app = await launch(userDataDir);
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // Set the close action explicitly (it's the default, but be explicit for
      // test clarity and self-documentation).
      await setCloseAction(app, 'minimize-to-tray');

      // Trigger a window close via the test hook.
      await requestWindowClose(app);

      // The window should become hidden (not destroyed, not quitting).
      await expect
        .poll(() => getIsWindowVisible(app), { timeout: 5_000 })
        .toBe(false);

      // Main process must still be alive — app.evaluate() must not throw.
      await expect(app.evaluate(() => 1)).resolves.toBe(1);
    } finally {
      try {
        await app.close();
      } catch {
        // app.close() may throw if already exited; swallow.
      }
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — closeAction='quit' terminates the process.
// ---------------------------------------------------------------------------

test('closeAction=quit terminates the process', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-tray-'));
  try {
    const app = await launch(userDataDir);
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // Override the close action to 'quit' so the window-close proceeds to
      // destroy (bypasses the hide branch).
      await setCloseAction(app, 'quit');

      // Trigger a window close. The close handler resolves to 'destroy',
      // window-all-closed fires, app.quit() runs, and the process exits.
      // Race: start listening for the 'close' event BEFORE calling close so
      // we don't miss a fast exit.
      const closedPromise = app.waitForEvent('close', { timeout: 10_000 });
      await requestWindowClose(app);

      // Wait for the ElectronApplication 'close' event — fires when the
      // underlying process has terminated.
      await closedPromise;
    } finally {
      // Process has already exited; app.close() will throw — swallow it.
      try {
        await app.close();
      } catch {
        // Expected: process is gone.
      }
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
