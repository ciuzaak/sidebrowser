import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('app launches with sidebrowser window title', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs')],
  });

  try {
    const window = await getChromeWindow(app);
    await expect(window).toHaveTitle('sidebrowser');
  } finally {
    await app.close();
  }
});
