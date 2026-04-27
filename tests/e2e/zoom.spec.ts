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
import { getChromeWindow, waitForAddressBarReady, navigateActive } from './helpers';

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
// Main-side helper: read active zoom factor.
// ---------------------------------------------------------------------------

async function getActiveZoomFactor(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    return h.getActiveZoomFactor() as number;
  });
}

async function emitZoomChange(app: ElectronApplication, dir: 'in' | 'out'): Promise<void> {
  await app.evaluate((_, d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.emitZoomChange(d);
  }, dir);
}

async function triggerResetZoom(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.triggerResetZoom();
  });
}

// ---------------------------------------------------------------------------
// Per-test isolation: each test gets its own userData dir.
// ---------------------------------------------------------------------------

let userDataDir: string;
let app: ElectronApplication | null = null;

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-zoom-'));
});

test.afterEach(async () => {
  if (app) {
    try {
      await app.close();
    } catch {
      // ignore — app may already be closed
    }
    app = null;
  }
  rmSync(userDataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 1 — Ctrl+wheel "in" three times → zoom = 1.3
// ---------------------------------------------------------------------------

test('Ctrl+wheel "in" three times → zoom = 1.3', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  await emitZoomChange(app, 'in');
  await emitZoomChange(app, 'in');
  await emitZoomChange(app, 'in');

  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(1.3, 5);
});

// ---------------------------------------------------------------------------
// Test 2 — clamps at upper bound 3.0
// ---------------------------------------------------------------------------

test('clamps at upper bound 3.0', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  for (let i = 0; i < 25; i++) {
    await emitZoomChange(app, 'in');
  }

  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(3.0, 5);
});

// ---------------------------------------------------------------------------
// Test 3 — clamps at lower bound 0.5
// ---------------------------------------------------------------------------

test('clamps at lower bound 0.5', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  for (let i = 0; i < 10; i++) {
    await emitZoomChange(app, 'out');
  }

  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(0.5, 5);
});

// ---------------------------------------------------------------------------
// Test 4 — triggerResetZoom restores 100%
// ---------------------------------------------------------------------------

test('triggerResetZoom restores 100%', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  await emitZoomChange(app, 'in');
  await emitZoomChange(app, 'in');

  // Sanity: zoomed to 1.2
  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(1.2, 5);

  await triggerResetZoom(app);

  // After reset: back to 1.0
  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(1.0, 5);
});

// ---------------------------------------------------------------------------
// Test 5 — zoom survives navigation (did-navigate reapply)
// ---------------------------------------------------------------------------

test('zoom survives navigation (did-navigate reapply)', async () => {
  app = await launch(userDataDir);
  const page = await getChromeWindow(app);
  await waitForAddressBarReady(page);

  await emitZoomChange(app, 'in');
  await emitZoomChange(app, 'in');

  // Sanity: zoomed to 1.2
  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 5_000 },
  ).toBeCloseTo(1.2, 5);

  // Navigate to a data: URL — triggers did-navigate which should reapply stored zoom.
  await navigateActive(page, 'data:text/html,<h1>zoom-test</h1>');

  // After navigation, the did-navigate handler should reapply 1.2.
  await expect.poll(
    () => getActiveZoomFactor(app!),
    { timeout: 15_000 },
  ).toBeCloseTo(1.2, 5);
});
