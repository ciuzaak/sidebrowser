import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('app launches with sidebrowser window title', async () => {
  // Isolated profile + E2E mode (quiet window, no real user data touched).
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-launch-'));
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });

  try {
    const window = await getChromeWindow(app);
    await expect(window).toHaveTitle('sidebrowser');
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
