import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { getChromeWindow } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((res) => {
    const server = createServer((req, response) => {
      if (req.url === '/page1') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE ONE</title><p>page one</p>');
        return;
      }
      if (req.url === '/page2') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE TWO</title><p>page two</p>');
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test('address bar navigation updates URL and history', async () => {
  const { server, baseUrl } = await startTestServer();
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs')],
  });

  try {
    const window = await getChromeWindow(app);

    // Navigate to page1 via the address bar.
    const addressBar = window.getByTestId('address-bar');
    await addressBar.fill(`${baseUrl}/page1`);
    await addressBar.press('Enter');

    // The Tab state broadcast should update the title; give the WebContentsView time to load.
    await expect
      .poll(
        async () => {
          // Title should be reflected on the window via page-title-updated → Tab → ...
          // But the renderer doesn't render the title; instead we just wait for a navigate round-trip
          // by re-reading the address bar (which useEffect syncs to tab.url).
          return (await addressBar.inputValue()).endsWith('/page1');
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();

    // Navigate to page2.
    await addressBar.fill(`${baseUrl}/page2`);
    await addressBar.press('Enter');

    await expect
      .poll(
        async () => (await addressBar.inputValue()).endsWith('/page2'),
        { timeout: 10_000 },
      )
      .toBeTruthy();

    // Back button should now be enabled.
    const backButton = window.getByRole('button', { name: 'Back' });
    await expect(backButton).toBeEnabled();

    await backButton.click();
    await expect
      .poll(
        async () => (await addressBar.inputValue()).endsWith('/page1'),
        { timeout: 10_000 },
      )
      .toBeTruthy();
  } finally {
    await app.close();
    server.close();
  }
});
