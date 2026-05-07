import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow } from './helpers';
import type { HistoryEntry } from '../../src/shared/types';

/** Start a minimal HTTP server and return its base URL. */
function startHttp(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>away</title><body>away</body>');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Seed { url: string; title?: string }

/** Seed history through the SIDEBROWSER_E2E test hook (`__sidebrowserTestHooks.seedHistory`). */
async function seedHistory(app: ElectronApplication, urls: Seed[]): Promise<void> {
  const now = Date.now();
  const entries: HistoryEntry[] = urls.map((u, i) => ({
    url: u.url,
    title: u.title ?? '',
    favicon: null,
    firstVisitedAt: now - (urls.length - i) * 1000,
    lastVisitedAt: now - (urls.length - i) * 1000,
    visitCount: 1,
  }));
  await app.evaluate((_, payload: HistoryEntry[]) => {
    const hooks = (globalThis as { __sidebrowserTestHooks?: { seedHistory(e: HistoryEntry[]): void } }).__sidebrowserTestHooks;
    if (!hooks?.seedHistory) throw new Error('seedHistory hook not installed — was SIDEBROWSER_E2E=1 set?');
    hooks.seedHistory(payload);
  }, entries);
}

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

test.describe('NewTab', () => {
  test('shows empty-state when there is no history and active tab is about:blank', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await expect(window.getByTestId('newtab')).toBeVisible();
      await expect(window.getByTestId('newtab-empty')).toBeVisible();
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('shows seeded history list', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, [
        { url: 'https://example.org', title: 'Example' },
        { url: 'https://github.com', title: 'GitHub' },
      ]);
      // seed() schedules a 16ms-throttled notify → history:changed broadcast →
      // NewTab re-fetch. expect.poll absorbs that latency.
      await expect.poll(async () => (await window.getByTestId('newtab-item').count()), { timeout: 5_000 }).toBe(2);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('hides when navigating away from about:blank, returns when navigated back', async () => {
    // Use a real HTTP server — sanitizeUrl rejects data:/javascript: schemes,
    // so data: URLs would be silently redirected to about:blank (spec §10).
    const { server, url: awayUrl } = await startHttp();
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await expect(window.getByTestId('newtab')).toBeVisible();

      // Navigate to a real HTTP page; wait for NewTab to disappear (driven by
      // tab:updated IPC, not by address-bar poll value which would pass immediately).
      const bar = window.getByTestId('address-bar');
      await bar.fill(awayUrl);
      await bar.press('Enter');
      await expect(window.getByTestId('newtab')).toBeHidden({ timeout: 10_000 });

      // Navigate back to about:blank by submitting an empty address bar.
      await bar.fill('');
      await bar.press('Enter');
      await expect(window.getByTestId('newtab')).toBeVisible({ timeout: 10_000 });
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
      server.close();
    }
  });

  test('removes a single entry on × click', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, [
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
      ]);
      await expect.poll(async () => (await window.getByTestId('newtab-item').count()), { timeout: 5_000 }).toBe(2);
      // dispatchEvent bypasses opacity:0 — the button is in the DOM regardless of hover.
      await window.getByTestId('newtab-remove').first().dispatchEvent('mousedown');
      await expect(window.getByTestId('newtab-item')).toHaveCount(1);
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('clicking an item navigates the active tab to that URL', async () => {
    const { server, url: targetUrl } = await startHttp();
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      // Seed exactly one entry pointing at the local HTTP server so
      // sanitizeUrl + ViewManager actually load it (data:/javascript:
      // would be rejected). One entry keeps the dispatch target unambiguous.
      await seedHistory(app, [{ url: targetUrl, title: 'Target' }]);
      await expect.poll(async () => (await window.getByTestId('newtab-item').count()), { timeout: 5_000 }).toBe(1);

      await window.getByTestId('newtab-item').first().dispatchEvent('mousedown');

      // Address bar reflects the loaded URL after navigation completes;
      // NewTab unmounts because isNewTab flips false.
      const bar = window.getByTestId('address-bar');
      await expect.poll(async () => bar.inputValue(), { timeout: 10_000 }).toBe(targetUrl);
      await expect(window.getByTestId('newtab')).toBeHidden();
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
      server.close();
    }
  });
});
