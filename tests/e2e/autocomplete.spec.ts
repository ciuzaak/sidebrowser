import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady, openSpotlight, getActiveUrl } from './helpers';
import type { HistoryEntry } from '../../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Seed { url: string; title: string }

async function seedHistory(app: ElectronApplication, urls: Seed[]): Promise<void> {
  const now = Date.now();
  const entries: HistoryEntry[] = urls.map((u, i) => ({
    url: u.url,
    title: u.title,
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

const FIXTURE: Seed[] = [
  { url: 'https://github.com', title: 'GitHub' },
  { url: 'https://gitlab.com', title: 'GitLab' },
  { url: 'https://example.com', title: 'Example' },
  { url: 'https://example.org', title: 'Example Org' },
];

test.describe('AddressSuggestions', () => {
  test('shows recent history when spotlight opens with empty input', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      await openSpotlight(window);
      await expect(window.getByTestId('address-suggestions')).toBeVisible();
      const items = window.getByTestId('address-suggestions-item');
      await expect(items).toHaveCount(4);
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('filters items as user types', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      await openSpotlight(window);
      const bar = window.getByTestId('address-bar');
      await bar.fill('git');
      const items = window.getByTestId('address-suggestions-item');
      await expect(items).toHaveCount(2);
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Down arrow x2 + Enter navigates to a git* highlighted item', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      await openSpotlight(window);
      const bar = window.getByTestId('address-bar');
      await bar.fill('git');
      // After 'git' filter: github + gitlab (tier 0), ranked by frecency.
      // With identical visitCount=1 and adjacent timestamps, exact ranking
      // is implementation-detail; we only assert keyboard nav lands on a
      // git* URL (not on the search-engine fallback).
      await bar.press('ArrowDown');
      await bar.press('ArrowDown');
      await bar.press('Enter');
      await expect
        .poll(async () => getActiveUrl(app), { timeout: 10_000 })
        .toMatch(/^https:\/\/git/);
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Esc closes the spotlight entirely', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      await openSpotlight(window);
      const bar = window.getByTestId('address-bar');
      await bar.fill('git');
      await expect(window.getByTestId('search-spotlight')).toBeVisible();
      await window.keyboard.press('Escape');
      await expect(window.getByTestId('search-spotlight')).toBeHidden();
      // Re-opening yields a fresh draft seeded from tab.url (no persistence
      // of the 'git' fragment) — captured by the next test rather than here.
    } finally {
      try { await app.close(); } catch { /* already closed */ }
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
