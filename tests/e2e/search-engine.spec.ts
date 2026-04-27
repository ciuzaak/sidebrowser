import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

// ---------------------------------------------------------------------------
// Minimal inline types — avoid importing from src/* because @shared alias
// isn't resolvable inside the e2e TS project.
// ---------------------------------------------------------------------------

interface SearchEngine {
  id: string;
  name: string;
  urlTemplate: string;
  builtin: boolean;
}

interface SearchSettings {
  engines: SearchEngine[];
  activeId: string;
}

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
// Main-side helper: read active WebContents URL.
// ---------------------------------------------------------------------------

async function getActiveUrl(app: ElectronApplication): Promise<string> {
  return app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    return h.getActiveWebContents()?.getURL() ?? '';
  });
}

// ---------------------------------------------------------------------------
// Per-test isolation: each test gets its own userData dir.
// ---------------------------------------------------------------------------

let userDataDir: string;
let app: ElectronApplication | null = null;

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-search-'));
});

test.afterEach(async () => {
  if (app) {
    try {
      await app.close();
    } catch {
      // ignore — app may already be closed (test 5)
    }
    app = null;
  }
  rmSync(userDataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 1 — default search engine routes to Google.
// ---------------------------------------------------------------------------

test('default search engine routes to Google', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  const bar = page.getByTestId('address-bar');
  await bar.fill('hello world');
  await bar.press('Enter');

  await expect.poll(
    () => getActiveUrl(app!),
    { timeout: 30_000 },
  ).toMatch(/google\.com\/search\?q=hello/);
});

// ---------------------------------------------------------------------------
// Test 2 — switching active engine to Bing routes via Bing.
// ---------------------------------------------------------------------------

test('switching active engine to Bing routes via Bing', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  // Switch active engine to Bing via main-side hook.
  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.updateSettings({ search: { activeId: 'bing' } });
  });

  const bar = page.getByTestId('address-bar');
  await bar.fill('foo bar');
  await bar.press('Enter');

  await expect.poll(
    () => getActiveUrl(app!),
    { timeout: 30_000 },
  ).toMatch(/bing\.com\/search\?q=foo/);
});

// ---------------------------------------------------------------------------
// Test 3 — add custom engine via the settings drawer UI.
// ---------------------------------------------------------------------------

test('add custom engine via drawer UI', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  // Open settings drawer.
  await page.getByTestId('topbar-settings-toggle').click();
  await page.getByTestId('settings-drawer').waitFor({ state: 'visible' });

  // Expand the add-engine form.
  await page.getByTestId('settings-search-add-toggle').click();

  // Fill name + template and confirm.
  await page.getByTestId('settings-search-add-name').fill('StackOverflow');
  await page.getByTestId('settings-search-add-template').fill(
    'https://stackoverflow.com/search?q={query}',
  );
  await page.getByTestId('settings-search-add-confirm').click();

  // The engine list should now contain the new engine name.
  await expect(page.getByTestId('settings-search-engines')).toContainText(
    'StackOverflow',
  );
});

// ---------------------------------------------------------------------------
// Test 4 — deleting the active custom engine falls back to google.
// ---------------------------------------------------------------------------

test('deleting active custom engine falls back to google', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  // Add a custom engine and set it as active via test hooks.
  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    const cur = h.getSettings();
    h.updateSettings({
      search: {
        engines: [
          ...cur.search.engines,
          {
            id: 'so-test',
            name: 'SO',
            urlTemplate: 'https://so.com/?q={query}',
            builtin: false,
          },
        ],
        activeId: 'so-test',
      },
    });
  });

  // Sanity check — active is now so-test.
  const beforeActive = await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    return (h.getSettings().search as SearchSettings).activeId;
  });
  expect(beforeActive).toBe('so-test');

  // Delete so-test from the engines list (no activeId in the patch so
  // clampSearch invariant 6 must fire and fall back to 'google').
  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    const cur = h.getSettings();
    h.updateSettings({
      search: {
        engines: cur.search.engines.filter(
          (e: SearchEngine) => e.id !== 'so-test',
        ),
      },
    });
  });

  // clampSearch should have fallen back to 'google'.
  const finalActive = await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    return (h.getSettings().search as SearchSettings).activeId;
  });
  expect(finalActive).toBe('google');
});

// ---------------------------------------------------------------------------
// Test 5 — active engine persists across app restart.
// ---------------------------------------------------------------------------

test('active engine persists across restart', async () => {
  // Launch 1: switch active engine to duckduckgo.
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.updateSettings({ search: { activeId: 'duckduckgo' } });
  });

  // Verify the store saw the change before closing.
  await expect.poll(
    async () => {
      const s = await app!.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (globalThis as any).__sidebrowserTestHooks;
        return (h.getSettings().search as SearchSettings).activeId;
      });
      return s;
    },
    { timeout: 5_000 },
  ).toBe('duckduckgo');

  await app.close();
  app = null;

  // Launch 2: same userDataDir — settings should restore from disk.
  app = await launch(userDataDir);
  const page2 = await getChromeWindow(app);
  await waitForAddressBarReady(page2);

  const restored = await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    return (h.getSettings().search as SearchSettings).activeId;
  });
  expect(restored).toBe('duckduckgo');
});
