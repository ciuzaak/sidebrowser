import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

test.describe('tab UX (M13)', () => {
  let app: ElectronApplication;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'sb-tabux-'));
    app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
  });
  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('Ctrl+Tab cycles to next tab and shows drawer; release closes drawer', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    // Seed a second tab so we have two to cycle between.
    await chrome.evaluate(() => window.sidebrowser.createTab('about:blank'));
    await expect
      .poll(async () => chrome.evaluate(async () => (await window.sidebrowser.requestTabsSnapshot()).tabs.length))
      .toBe(2);

    // Drawer not visible to start.
    await expect(chrome.getByTestId('tab-drawer')).toBeHidden();

    // CDP keyboard events from Playwright don't trip Electron's
    // before-input-event (used by TabCycler in production). Use the test hook
    // that mirrors what TabCycler does — exercises the cycle:state → store →
    // drawer-open derivation end-to-end.
    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).triggerCycle(+1);
    });

    // Drawer visible while cycle is "active".
    await expect(chrome.getByTestId('tab-drawer')).toBeVisible();

    await app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).__sidebrowserTestHooks).endCycle();
    });
    // Drawer hides on cycle end.
    await expect(chrome.getByTestId('tab-drawer')).toBeHidden();
  });

  test('outside-click closes the TabDrawer', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    await chrome.getByTestId('topbar-tabs-toggle').click();
    await expect(chrome.getByTestId('tab-drawer')).toBeVisible();

    // mousedown on the SearchPill — outside drawer + outside the toggle.
    // The pill also opens the Spotlight; only the drawer state matters here.
    await chrome.getByTestId('search-pill').click();
    await expect(chrome.getByTestId('tab-drawer')).toBeHidden();
  });

  test('opening a tab from the drawer while settings is open auto-closes settings', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    await chrome.evaluate(() => window.sidebrowser.createTab('about:blank'));
    await expect
      .poll(async () => chrome.evaluate(async () => (await window.sidebrowser.requestTabsSnapshot()).tabs.length))
      .toBe(2);

    // Open settings.
    await chrome.getByTestId('topbar-settings-toggle').click();
    await expect(chrome.getByTestId('settings-drawer')).toBeVisible();

    // Open tab drawer + click the inactive tab.
    await chrome.getByTestId('topbar-tabs-toggle').click();
    const inactive = chrome.locator('[data-testid="tab-drawer-item"][data-active="false"]').first();
    await inactive.click();

    // Settings auto-closes (active tab changed).
    await expect(chrome.getByTestId('settings-drawer')).toBeHidden();
  });
});
