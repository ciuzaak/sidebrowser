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

async function updateSettings(
  app: ElectronApplication,
  patch: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(async (_e, p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      updateSettings: (patch: unknown) => unknown;
    };
    h.updateSettings(p);
  }, patch);
}

function rgbToHex(rgb: string): string {
  // "rgb(91, 141, 255)" -> "#5b8dff" / pass-through if already hex.
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return rgb.toLowerCase();
  const to2 = (n: string): string => parseInt(n, 10).toString(16).padStart(2, '0');
  return ('#' + to2(m[1]!) + to2(m[2]!) + to2(m[3]!)).toLowerCase();
}

/**
 * Vite's CSS minifier may shorten `#RRGGBB` to `#RGB` when the long form's
 * pairs are identical (e.g. `#0066cc` → `#06c`). Both are equivalent CSS.
 * Normalize before comparing so we test design intent, not minifier output.
 */
function normalizeHex(hex: string): string {
  const trimmed = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const [r, g, b] = [trimmed[1]!, trimmed[2]!, trimmed[3]!];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

test.describe('M14 macOS-style tokens', () => {
  test('dark theme exposes --accent #5b8dff and --surface #1c1e24', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'dark' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );

        const accent = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--accent')
            .trim(),
        );
        const surface = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--surface')
            .trim(),
        );
        expect(normalizeHex(accent)).toBe('#5b8dff');
        expect(normalizeHex(surface)).toBe('#1c1e24');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('light theme exposes --accent #0066cc and --surface #f6f6f7', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'light' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'light',
        );

        const accent = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--accent')
            .trim(),
        );
        const surface = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--surface')
            .trim(),
        );
        expect(normalizeHex(accent)).toBe('#0066cc');
        expect(normalizeHex(surface)).toBe('#f6f6f7');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('address bar uses --surface-sunken background in dark theme', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'dark' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );

        const addressBg = await win.evaluate(() => {
          const el = document.querySelector('[data-testid="address-bar"]');
          return el ? getComputedStyle(el).backgroundColor : '';
        });
        // --surface-sunken (dark) = #14161b = rgb(20, 22, 27)
        expect(rgbToHex(addressBg)).toBe('#14161b');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
