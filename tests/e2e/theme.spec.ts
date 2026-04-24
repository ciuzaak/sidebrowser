import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ElectronApplication } from '@playwright/test';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

// ---------------------------------------------------------------------------
// Main-side updateSettings helper — drives settings changes without UI clicks.
// ---------------------------------------------------------------------------

async function updateSettings(
  app: ElectronApplication,
  patch: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(async (_electron, p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      updateSettings: (patch: unknown) => unknown;
    };
    h.updateSettings(p);
  }, patch);
}

// ---------------------------------------------------------------------------
// M9 Task 8 — theme switch updates <html data-theme>.
// ---------------------------------------------------------------------------

test.describe('M9 theme switch', () => {
  test('default theme=system resolves to dark or light', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-theme-'));

    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);

        // On launch with default theme='system', the resolved data-theme must
        // be one of 'dark' or 'light' (OS-driven resolution).
        const initial = await win.evaluate(
          () => document.documentElement.dataset.theme,
        );
        expect(['dark', 'light']).toContain(initial);
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('switch to dark updates <html data-theme>', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-theme-'));

    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);

        await updateSettings(app, { appearance: { theme: 'dark' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('switch to light updates <html data-theme>', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-theme-'));

    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);

        await updateSettings(app, { appearance: { theme: 'light' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'light',
        );
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
