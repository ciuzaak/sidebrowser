import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('app launches with sidebrowser window title', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs')],
  });

  const window = await app.firstWindow();
  await expect(window).toHaveTitle('sidebrowser');

  await app.close();
});
