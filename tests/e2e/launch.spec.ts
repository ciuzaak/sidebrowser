import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('app launches and ping IPC works', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs')],
  });

  const window = await app.firstWindow();
  await expect(window).toHaveTitle('sidebrowser');

  await window.getByRole('button', { name: 'Ping main' }).click();

  const resultLocator = window.getByTestId('ping-result');
  await expect(resultLocator).toContainText('pong: hello from renderer');

  await app.close();
});
