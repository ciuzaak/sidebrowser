import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getActiveUrl, getChromeWindow, navigateActive, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Rect { x: number; y: number; width: number; height: number }
interface TabLike { id: string; url: string; loaded: boolean; canGoBack: boolean; crashed: string | null }

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      const html = (body: string, title = 'T'): void => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
      };
      if (url === '/a' || url === '/b' || url === '/c') return html(url.slice(1).toUpperCase(), url.slice(1));
      if (url === '/find') return html('apple banana apple cherry apple', 'find');
      if (url === '/mobile') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>m</title></head><body>m</body></html>');
        return;
      }
      if (url === '/fs') return html('<div id="v" style="width:100px;height:50px;background:#f80">v</div>', 'fs');
      if (url === '/opener') {
        return html('<a id="l" href="/c" style="display:block;width:100vw;height:100vh">link</a>', 'opener');
      }
      if (url === '/evil.scf') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="evil.scf"');
        res.end('[Shell]\nIconFile=\\\\attacker\\share\\x.ico');
        return;
      }
      if (url === '/file.bin') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="file.bin"');
        res.end(Buffer.alloc(64 * 1024, 7));
        return;
      }
      res.statusCode = url === '/favicon.ico' ? 204 : 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function launch(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1', ...env },
  });
}

/** Fresh app (isolated profile, E2E mode) + local server. */
async function withApp(
  fn: (app: ElectronApplication, page: Page, baseUrl: string, userDataDir: string) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const { server, baseUrl } = await startServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m16-'));
  try {
    const app = await launch(userDataDir, env);
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);
      await fn(app, page, baseUrl, userDataDir);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

/** Call a __sidebrowserTestHooks function by name with JSON-able args. */
async function hook<T>(app: ElectronApplication, name: string, ...args: unknown[]): Promise<T> {
  return app.evaluate((_e, [n, a]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as Record<string, (...x: unknown[]) => unknown>;
    return h[n as string]!(...(a as unknown[]));
  }, [name, args] as const) as Promise<T>;
}

/** Run JS in the active tab (optionally as a user gesture). */
async function activeEval<T>(app: ElectronApplication, code: string, userGesture = false): Promise<T> {
  return app.evaluate(async (_e, [c, g]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      getActiveWebContents: () => Electron.WebContents | null;
    };
    return h.getActiveWebContents()!.executeJavaScript(c as string, g as boolean);
  }, [code, userGesture] as const) as Promise<T>;
}

async function snapshot(page: Page): Promise<{ tabs: TabLike[]; activeId: string | null }> {
  return page.evaluate(() => window.sidebrowser.requestTabsSnapshot()) as Promise<{
    tabs: TabLike[];
    activeId: string | null;
  }>;
}

test.describe('M16 browser essentials', () => {
  test('permission requests are denied by default', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      expect(await activeEval<string>(app, 'Notification.requestPermission()', true)).toBe('denied');
      expect(
        await activeEval<string>(app, "navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)"),
      ).not.toBe('granted');
    });
  });

  test('IP:port typed in the address bar opens over http', async () => {
    await withApp(async (app, page, base) => {
      const hostPath = base.replace('http://', '') + '/a';
      await navigateActive(page, hostPath);
      await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/a`);
    });
  });

  test('find in page counts and steps through matches', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/find`, app);
      await hook(app, 'sendShortcut', 'open-find');
      const input = page.getByTestId('find-input');
      await input.waitFor({ state: 'visible' });
      await input.fill('apple');
      await expect(page.getByTestId('find-count')).toHaveText('1/3', { timeout: 5_000 });
      await input.press('Enter');
      await expect(page.getByTestId('find-count')).toHaveText('2/3', { timeout: 5_000 });
      await input.press('Escape');
      await expect(page.getByTestId('find-bar')).toHaveCount(0);
    });
  });

  test('downloads land in the downloads dir with unique names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-dl-'));
    try {
      await withApp(async (app, page, base) => {
        await navigateActive(page, `${base}/a`, app);
        for (let i = 0; i < 2; i++) {
          await page.evaluate(async (url) => {
            const s = await window.sidebrowser.requestTabsSnapshot();
            await window.sidebrowser.navigate(s.activeId!, url);
          }, `${base}/file.bin`);
          await expect
            .poll(async () => page.locator('[data-testid="download-item"][data-state="completed"]').count(), { timeout: 10_000 })
            .toBe(i + 1);
        }
        expect(existsSync(join(dir, 'file.bin'))).toBe(true);
        expect(existsSync(join(dir, 'file (1).bin'))).toBe(true);
        await expect(page.getByTestId('topbar-downloads-toggle')).toBeVisible();

        // Shortcut / shell-handler types are refused and never written.
        await page.evaluate(async (url) => {
          const s = await window.sidebrowser.requestTabsSnapshot();
          await window.sidebrowser.navigate(s.activeId!, url);
        }, `${base}/evil.scf`);
        await expect(page.locator('[data-testid="download-item"][data-state="blocked"]')).toHaveCount(1, { timeout: 10_000 });
        expect(existsSync(join(dir, 'evil.scf'))).toBe(false);
      }, { SIDEBROWSER_E2E_DOWNLOADS_DIR: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('crashed tab shows the overlay and Reload recovers', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      await hook(app, 'crashActive');
      await expect(page.getByTestId('crash-overlay')).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => hook<boolean | null>(app, 'getActiveViewVisible')).toBe(false);
      await page.getByTestId('crash-reload').click();
      await expect(page.getByTestId('crash-overlay')).toHaveCount(0, { timeout: 10_000 });
      await expect.poll(() => hook<boolean | null>(app, 'getActiveViewVisible')).toBe(true);
    });
  });

  test('HTML fullscreen fills the window (covers the chrome) and exits back', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/fs`, app);
      const before = (await hook<Rect | null>(app, 'getActiveViewBounds'))!;
      await activeEval(app, "document.getElementById('v').requestFullscreen().then(() => true)", true);
      await expect.poll(async () => (await hook<Rect | null>(app, 'getActiveViewBounds'))!.y, { timeout: 5_000 }).toBe(0);
      const full = (await hook<Rect | null>(app, 'getActiveViewBounds'))!;
      expect(full.height).toBe(before.height + before.y);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
      await activeEval(app, 'document.exitFullscreen().then(() => true)', true);
      await expect.poll(async () => (await hook<Rect | null>(app, 'getActiveViewBounds'))!.y, { timeout: 5_000 }).toBe(before.y);
    });
  });

  test('window.open with features opens a real popup that keeps window.opener', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      await activeEval(app, `window.open('${base}/b', 'p', 'width=400,height=500'); true`, true);
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10_000 })
        .toBe(2);
      const hasOpener = await app.evaluate(async ({ BrowserWindow }) => {
        const popup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/b'));
        if (!popup) {
          await new Promise((r) => setTimeout(r, 500));
        }
        const p = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/b'));
        return p ? ((await p.webContents.executeJavaScript('!!window.opener')) as boolean) : null;
      });
      expect(hasOpener).toBe(true);
      expect((await snapshot(page)).tabs).toHaveLength(1);
    });
  });

  test("window.open('') with features is a real popup too", async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      await activeEval(app, "window.__p = window.open('', 'p', 'width=400,height=500'); !!window.__p", true);
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10_000 })
        .toBe(2);
      expect(await activeEval<boolean>(app, '!!window.__p && !window.__p.closed')).toBe(true);
      expect((await snapshot(page)).tabs).toHaveLength(1);
    });
  });

  test('Ctrl+click opens a background tab', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/opener`, app);
      const before = await snapshot(page);
      await app.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (globalThis as any).__sidebrowserTestHooks as { getActiveWebContents: () => Electron.WebContents };
        const wc = h.getActiveWebContents();
        wc.focus();
        wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 40, button: 'left', clickCount: 1, modifiers: ['control'] });
        wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 40, button: 'left', clickCount: 1, modifiers: ['control'] });
      });
      await expect.poll(async () => (await snapshot(page)).tabs.length, { timeout: 10_000 }).toBe(2);
      const after = await snapshot(page);
      expect(after.activeId).toBe(before.activeId);
      expect(after.tabs.some((t) => t.url.endsWith('/c'))).toBe(true);
    });
  });

  test('restart restores tabs lazily, with back/forward history', async () => {
    const { server, baseUrl: base } = await startServer();
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m16-restore-'));
    try {
      {
        const app = await launch(userDataDir);
        try {
          const page = await getChromeWindow(app);
          await waitForAddressBarReady(page);
          await navigateActive(page, `${base}/a`, app);
          await navigateActive(page, `${base}/b`, app);
          await page.evaluate((url) => window.sidebrowser.createTab(url), `${base}/c`);
          await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/c`);
          const s = await snapshot(page);
          await page.evaluate((id) => window.sidebrowser.activateTab(id), s.tabs[0]!.id);
          await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/b`);
          await new Promise((r) => setTimeout(r, 1_500)); // tab-save debounce
        } finally {
          await app.close();
        }
      }
      {
        const app = await launch(userDataDir);
        try {
          const page = await getChromeWindow(app);
          await waitForAddressBarReady(page);
          await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/b`);
          const s = await snapshot(page);
          expect(s.tabs).toHaveLength(2);
          const [first, second] = s.tabs as [TabLike, TabLike];
          expect(first.loaded).toBe(true);
          expect(second.loaded).toBe(false);
          await expect.poll(async () => (await snapshot(page)).tabs[0]!.canGoBack, { timeout: 10_000 }).toBe(true);
          await page.evaluate((id) => window.sidebrowser.activateTab(id), second.id);
          await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/c`);
          expect((await snapshot(page)).tabs[1]!.loaded).toBe(true);
        } finally {
          await app.close();
        }
      }
    } finally {
      server.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('unloaded tab restores its page and history on activation', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      await navigateActive(page, `${base}/b`, app);
      const first = (await snapshot(page)).activeId!;
      await page.evaluate(() => window.sidebrowser.createTab('about:blank'));
      await expect.poll(async () => (await snapshot(page)).activeId).not.toBe(first);
      expect(await hook<boolean>(app, 'unloadTab', first)).toBe(true);
      expect((await snapshot(page)).tabs.find((t) => t.id === first)!.loaded).toBe(false);
      await page.evaluate((id) => window.sidebrowser.activateTab(id), first);
      await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/b`);
      await expect
        .poll(async () => (await snapshot(page)).tabs.find((t) => t.id === first)!.canGoBack, { timeout: 10_000 })
        .toBe(true);
    });
  });

  test('Ctrl+Shift+T reopens the last closed tab', async () => {
    await withApp(async (app, page, base) => {
      const created = await page.evaluate((url) => window.sidebrowser.createTab(url), `${base}/c`);
      await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/c`);
      await page.evaluate((id) => window.sidebrowser.closeTab(id), created.id);
      await expect.poll(async () => (await snapshot(page)).tabs.length).toBe(1);
      expect(await hook<boolean>(app, 'reopenClosedTab')).toBe(true);
      await expect.poll(() => getActiveUrl(app), { timeout: 10_000 }).toBe(`${base}/c`);
      expect((await snapshot(page)).tabs).toHaveLength(2);
    });
  });

  test('mobile tab zoom reflows the layout viewport', async () => {
    await withApp(async (app, page, base) => {
      // Real mobile sites declare a device-width viewport; without one Chromium
      // lays the page out at the 980 px desktop default.
      await navigateActive(page, `${base}/mobile`, app);
      await expect.poll(() => activeEval<number>(app, 'innerWidth'), { timeout: 10_000 }).toBeGreaterThan(300);
      const w0 = await activeEval<number>(app, 'innerWidth');
      for (let i = 0; i < 5; i++) await hook(app, 'zoomActive', 'in');
      await expect
        .poll(async () => Math.abs((await activeEval<number>(app, 'innerWidth')) - Math.round(w0 / 1.5)), { timeout: 5_000 })
        .toBeLessThanOrEqual(2);
      await hook(app, 'zoomActive', 'reset');
      await expect.poll(() => activeEval<number>(app, 'innerWidth'), { timeout: 5_000 }).toBe(w0);
    });
  });

  test('Settings → Storage shows usage and clears the cache', async () => {
    await withApp(async (_app, page) => {
      await page.getByTestId('topbar-settings-toggle').click();
      const total = page.getByTestId('settings-storage-total');
      await total.scrollIntoViewIfNeeded();
      await expect(total).not.toHaveText('…', { timeout: 10_000 });
      await page.getByTestId('settings-clear-cache').click();
      await expect(page.getByTestId('settings-storage-note')).toHaveText('Cache cleared', { timeout: 10_000 });
      await page.getByTestId('settings-clear-site-data').click();
      await expect(page.getByTestId('settings-clear-site-data')).toHaveText('Click again to confirm');
    });
  });

  test('auto-mute while hidden at the edge follows the setting', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      expect(await hook<boolean>(app, 'isActiveAudioMuted')).toBe(false);
      await hook(app, 'setWindowHidden', true);
      expect(await hook<boolean>(app, 'isActiveAudioMuted')).toBe(true);
      expect(await hook<boolean | null>(app, 'getActiveViewVisible')).toBe(false);
      await hook(app, 'setWindowHidden', false);
      expect(await hook<boolean>(app, 'isActiveAudioMuted')).toBe(false);
      await hook(app, 'updateSettings', { browsing: { muteWhenHidden: false } });
      await hook(app, 'setWindowHidden', true);
      expect(await hook<boolean>(app, 'isActiveAudioMuted')).toBe(false);
    });
  });

  test('SPA pushState navigations are recorded in history', async () => {
    await withApp(async (app, page, base) => {
      await navigateActive(page, `${base}/a`, app);
      await activeEval(app, "history.pushState({}, '', '/spa/2'); true");
      await expect
        .poll(async () => (await hook<{ url: string }[]>(app, 'getHistoryAll')).some((e) => e.url === `${base}/spa/2`), { timeout: 5_000 })
        .toBe(true);
    });
  });
});
