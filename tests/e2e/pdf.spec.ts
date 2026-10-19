import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { getChromeWindow, navigateActive, waitForAddressBarReady } from './helpers';

/** Two-page PDF so theme checks exercise the native plugin's page gaps. */
function samplePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 40 700 Td (Sidebrowser PDF test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 7\n0000000000 65535 f \n';
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function withApp(run: (app: ElectronApplication, chrome: Page, path: string, base: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-pdf-'));
  const path = join(dir, '报告 #100%.PDF');
  const pdf = samplePdf();
  writeFileSync(path, pdf);
  const server = createServer((req, res) => {
    if (req.url === '/links') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><title>PDF links</title></head><body><a id="inline" href="/inline.pdf">Read PDF</a><a id="attachment" href="/attachment.pdf">Download PDF</a></body></html>');
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/inline.pdf' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    if (req.url === '/attachment.pdf') res.setHeader('Content-Disposition', 'attachment; filename="download.PDF"');
    res.end(pdf);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      timeout: 30_000,
      args: [resolve('out/main/index.cjs'), `--user-data-dir=${join(dir, 'profile')}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1', SIDEBROWSER_E2E_DOWNLOADS_DIR: join(dir, 'downloads') },
    });
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await run(app, chrome, path, `http://127.0.0.1:${address.port}`);
  } finally {
    if (app) await app.close();
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function stubPicker(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: path === null, filePaths: path === null ? [] : [path] })) as typeof dialog.showOpenDialog;
  }, path);
}

async function expectReader(app: ElectronApplication, chrome: Page, url: string): Promise<void> {
  await expect.poll(async () => {
    const snapshot = await chrome.evaluate(() => window.sidebrowser.requestTabsSnapshot());
    const tab = snapshot.tabs.find((t) => t.id === snapshot.activeId);
    // Node and Chromium may encode unreserved characters (e.g. DOS ~ names)
    // differently; compare equivalent URLs without decoding reserved #/? delimiters.
    return { url: decodeURI(tab?.url ?? ''), mobile: tab?.isMobile, crashed: tab?.crashed };
  }).toEqual({ url: decodeURI(url), mobile: false, crashed: null });
  // Inspect the extension frame, not just its URL: the PDF plugin must have
  // parsed the fixture and reported a successful load with two pages.
  await expect.poll(async () => app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
    const frame = hooks.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'));
    if (!frame) return null;
    return frame.executeJavaScript(`(() => {
      const viewer = document.querySelector('pdf-viewer');
      return { state: viewer?.loadState_, pages: viewer?.documentDimensions?.pageDimensions?.length };
    })()`);
  }), { timeout: 15_000 }).toEqual({ state: 'success', pages: 2 });
}

interface PdfColors {
  background: string; foreground: string; icon: string;
  pageForeground: string; pageInputForeground: string;
  documentBackground: string; viewerBackground: string; pluginBackground: number;
  sidebarBackground: string; sidebarForeground: string; thumbnailOutline: string;
}

async function pdfColors(app: ElectronApplication): Promise<PdfColors | null> {
  return app.evaluate(async () => {
    const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
    const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'));
    if (!frame) return null;
    return frame.executeJavaScript(`(() => {
      const viewer = document.querySelector('pdf-viewer');
      const toolbar = viewer?.shadowRoot?.querySelector('viewer-toolbar');
      const bar = toolbar?.shadowRoot?.querySelector('#toolbar');
      const print = toolbar?.shadowRoot?.querySelector('#print');
      const pageRoot = toolbar?.shadowRoot?.querySelector('viewer-page-selector')?.shadowRoot;
      const pageContent = pageRoot?.querySelector('#content');
      const pageInput = pageRoot?.querySelector('input');
      const sidebar = viewer?.shadowRoot?.querySelector('viewer-pdf-sidenav');
      const thumbnail = sidebar?.shadowRoot?.querySelector('viewer-thumbnail-bar')?.shadowRoot?.querySelector('viewer-thumbnail');
      const thumbnailPage = thumbnail?.shadowRoot?.querySelector('#pageNumber');
      if (!bar || !print) return null;
      return {
        background: getComputedStyle(bar).backgroundColor,
        foreground: getComputedStyle(bar).color,
        icon: getComputedStyle(print).getPropertyValue('--cr-icon-button-fill-color').trim(),
        pageForeground: pageContent ? getComputedStyle(pageContent).color : '',
        pageInputForeground: pageInput ? getComputedStyle(pageInput).color : '',
        documentBackground: getComputedStyle(document.body).backgroundColor,
        viewerBackground: getComputedStyle(viewer).backgroundColor,
        pluginBackground: Number(viewer.shadowRoot.querySelector('#plugin')?.getAttribute('background-color')),
        sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundColor : '',
        sidebarForeground: thumbnailPage ? getComputedStyle(thumbnailPage).color : '',
        thumbnailOutline: thumbnail ? getComputedStyle(thumbnail).getPropertyValue('--focus-border-color').trim() : '',
      };
    })()`);
  }) as Promise<PdfColors | null>;
}

async function inPdf<T = unknown>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async (_electron, script) => {
    const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
    const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
    return frame.executeJavaScript(script);
  }, script) as Promise<T>;
}

test.describe('PDF reader', () => {
  test('NewTab picker opens a PDF in a new desktop tab', async () => {
    await withApp(async (app, chrome, path) => {
      await stubPicker(app, path);
      await chrome.getByTestId('open-pdf').click();
      await expectReader(app, chrome, pathToFileURL(path).href);
      expect((await chrome.evaluate(() => window.sidebrowser.requestTabsSnapshot())).tabs).toHaveLength(2);
      await expect(chrome.getByTestId('topbar-ua-toggle')).toBeDisabled();
      await chrome.evaluate(async () => {
        const s = await window.sidebrowser.requestTabsSnapshot();
        await window.sidebrowser.setMobile(s.activeId!, true);
      });
      await expectReader(app, chrome, pathToFileURL(path).href);
      const png = await app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
      });
      writeFileSync(test.info().outputPath('pdf-view.png'), Buffer.from(png, 'base64'));
    });
  });

  test('Ctrl+O menu action opens the same reader', async () => {
    await withApp(async (app, chrome, path) => {
      await stubPicker(app, path);
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()!.items[0].submenu!.items.find((i) => i.accelerator === 'CmdOrCtrl+O')!;
        item.click(undefined, undefined, {});
      });
      await expectReader(app, chrome, pathToFileURL(path).href);
    });
  });

  test('cancelling leaves the tab list unchanged', async () => {
    await withApp(async (app, chrome) => {
      await stubPicker(app, null);
      // Loading may finish during the dialog; cancellation must preserve tab
      // identity, navigation and activation rather than freeze transient state.
      const tabState = () => chrome.evaluate(async () => {
        const s = await window.sidebrowser.requestTabsSnapshot();
        return { activeId: s.activeId, tabs: s.tabs.map(({ id, url, isMobile }) => ({ id, url, isMobile })) };
      });
      const before = await tabState();
      await chrome.evaluate(() => window.sidebrowser.openPdf());
      expect(await tabState()).toEqual(before);
    });
  });

  test('mouse leave cannot hide or dim the window while the picker is open', async () => {
    await withApp(async (app, chrome) => {
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = (() => new Promise((resolve) => {
          (globalThis as unknown as { cancelPdfPicker: () => void }).cancelPdfPicker = () => resolve({ canceled: true, filePaths: [] });
        })) as typeof dialog.showOpenDialog;
      });
      await chrome.evaluate(() => { void window.sidebrowser.openPdf(); });
      await expect.poll(() => app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { isPdfDialogOpen: () => boolean } }).__sidebrowserTestHooks;
        return h.isPdfDialogOpen();
      })).toBe(true);
      const state = await app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: {
          fireLeaveNow: () => void; getEdgeDockState: () => { dimmed: boolean; kind: string };
        } }).__sidebrowserTestHooks;
        h.fireLeaveNow();
        return h.getEdgeDockState();
      });
      expect(state.dimmed).toBe(false);
      expect(state.kind).not.toMatch(/HID/);
      await app.evaluate(() => (globalThis as unknown as { cancelPdfPicker: () => void }).cancelPdfPicker());
      await expect.poll(() => app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { isPdfDialogOpen: () => boolean } }).__sidebrowserTestHooks;
        return h.isPdfDialogOpen();
      })).toBe(false);
    });
  });

  test('a missing selected file reports an error without opening a tab', async () => {
    await withApp(async (app, chrome, path) => {
      await stubPicker(app, path + '.missing.pdf');
      await app.evaluate(({ dialog }) => {
        const state = globalThis as unknown as { pdfError: string };
        dialog.showMessageBox = (async (_window: Electron.BrowserWindow, options: Electron.MessageBoxOptions) => {
          state.pdfError = options.message;
          return { response: 0, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      });
      await chrome.evaluate(() => window.sidebrowser.openPdf());
      expect(await app.evaluate(() => (globalThis as unknown as { pdfError: string }).pdfError)).toContain('could not be opened');
      expect((await chrome.evaluate(() => window.sidebrowser.requestTabsSnapshot())).tabs).toHaveLength(1);
    });
  });

  test('a quoted Windows path typed in Spotlight opens the PDF', async () => {
    await withApp(async (app, chrome, path) => {
      await navigateActive(chrome, `"${path}"`);
      await expectReader(app, chrome, pathToFileURL(path).href);
    });
  });

  test('an inline web PDF renders without being downloaded', async () => {
    await withApp(async (app, chrome, _path, base) => {
      await navigateActive(chrome, `${base}/inline.pdf?view=1#page=1`);
      await expectReader(app, chrome, `${base}/inline.pdf?view=1#page=1`);
      expect(await chrome.evaluate(() => window.sidebrowser.downloadsList())).toEqual([]);
    });
  });

  test('a PDF link in a mobile webpage switches to the desktop reader', async () => {
    await withApp(async (app, chrome, _path, base) => {
      await navigateActive(chrome, `${base}/links`, app);
      await app.evaluate(async () => {
        const hooks = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        await hooks.getActiveWebContents().executeJavaScript('document.getElementById("inline").click()');
      });
      await expectReader(app, chrome, `${base}/inline.pdf`);
    });
  });

  test('a redirect to a PDF switches to the desktop reader', async () => {
    await withApp(async (app, chrome, _path, base) => {
      await navigateActive(chrome, `${base}/redirect`);
      await expectReader(app, chrome, `${base}/inline.pdf`);
    });
  });

  test('an attachment downloads and then opens inside sidebrowser', async () => {
    await withApp(async (app, chrome, _path, base) => {
      await navigateActive(chrome, `${base}/links`, app);
      await chrome.evaluate(async (url) => {
        const s = await window.sidebrowser.requestTabsSnapshot();
        await window.sidebrowser.navigate(s.activeId!, url);
      }, `${base}/attachment.pdf`);
      await expect.poll(async () => (await chrome.evaluate(() => window.sidebrowser.downloadsList()))[0]?.state).toBe('completed');
      const [download] = await chrome.evaluate(() => window.sidebrowser.downloadsList());
      // The existing download flow opens the drawer automatically.
      await expect(chrome.getByTestId('downloads-drawer')).toBeVisible();
      await chrome.getByRole('button', { name: `Open ${download.filename}`, exact: true }).click();
      await expectReader(app, chrome, pathToFileURL(download.path).href);
    });
  });

  test('PDF colors update the toolbar, sidebar and native page gaps live', async () => {
    await withApp(async (app, chrome, path) => {
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'dark' } }));
      await app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: {
          getWindowBounds: () => Electron.Rectangle; setWindowBounds: (bounds: Electron.Rectangle) => void;
        } }).__sidebrowserTestHooks;
        h.setWindowBounds({ ...h.getWindowBounds(), width: 900 });
      });
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(60, 60, 60)');
      const initial = (await pdfColors(app))!;
      expect(initial.foreground).toBe('rgb(255, 255, 255)');
      expect(initial.icon).toBe('#ffffff');
      expect(initial.pluginBackground).toBe(0xff3c3c3c);
      // Establish the viewport once. Theme changes must repaint without zoom,
      // scrolling, resizing, or reloading to trigger native plugin invalidation.
      const gap = await app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
        return frame.executeJavaScript(`(() => {
          const v = document.querySelector('pdf-viewer');
          v.viewport.setZoom(0.5);
          const first = v.viewport.getPageScreenRect(0);
          const second = v.viewport.getPageScreenRect(1);
          const scroller = v.shadowRoot.querySelector('#scroller').getBoundingClientRect();
          return { x: Math.round(scroller.x + first.x + first.width / 2), y: Math.round(scroller.y + (first.y + first.height + second.y) / 2), zoom: v.viewport.getZoom(), position: v.viewport.position };
        })()`) as Promise<{ x: number; y: number; zoom: number; position: { x: number; y: number } }>;
      });
      for (const [mode, color, expected, foreground] of [
        ['light', '#3c3c3c', 'rgb(246, 246, 247)', 'rgb(0, 0, 0)'],
        ['custom', '#ffd966', 'rgb(255, 217, 102)', 'rgb(0, 0, 0)'],
        ['custom', '#7c3aed', 'rgb(124, 58, 237)', 'rgb(255, 255, 255)'],
        ['dark', '#3c3c3c', 'rgb(60, 60, 60)', 'rgb(255, 255, 255)'],
      ] as const) {
        await chrome.evaluate(({ mode, color }) => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: mode, pdfToolbarColor: color } }), { mode, color });
        await expect.poll(async () => (await pdfColors(app))?.background).toBe(expected);
        const colors = (await pdfColors(app))!;
        expect(colors.foreground).toBe(foreground);
        expect(colors.pageForeground).toBe(foreground);
        expect(colors.pageInputForeground).toBe(foreground);
        expect(colors.documentBackground).toBe(expected);
        expect(colors.viewerBackground).toBe(expected);
        expect(colors.sidebarBackground).toBe(expected);
        expect(colors.sidebarForeground).toBe(foreground);
        expect(colors.thumbnailOutline).toBe(foreground === 'rgb(0, 0, 0)' ? '#000000' : '#ffffff');
        const expectedRgb = expected.match(/\d+/g)!.map(Number);
        expect(colors.pluginBackground).toBe(0xff000000 + (expectedRgb[0]! << 16) + (expectedRgb[1]! << 8) + expectedRgb[2]!);
        // Check pixels painted by the native plugin, not only its DOM attributes.
        await expect.poll(async () => {
          const png = await app.evaluate(async () => {
            const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
            return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
          });
          const { data, info } = await sharp(Buffer.from(png, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          writeFileSync(test.info().outputPath(`pdf-reading-${mode}-${color.slice(1)}.png`), Buffer.from(png, 'base64'));
          const pixel = (x: number, y: number): number[] => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
          return { sidebar: pixel(20, 150), margin: pixel(info.width - 30, 150), gap: pixel(gap.x, gap.y), page: pixel(gap.x, 200) };
        }).toEqual({ sidebar: expectedRgb, margin: expectedRgb, gap: expectedRgb, page: [255, 255, 255] });
        const viewport = await app.evaluate(async () => {
          const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
          const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
          return frame.executeJavaScript(`(() => {
            const viewport = document.querySelector('pdf-viewer').viewport;
            return { zoom: viewport.getZoom(), position: viewport.position };
          })()`);
        });
        expect(viewport).toEqual({ zoom: gap.zoom, position: gap.position });
      }
      const toggleSidebar = (): Promise<unknown> => app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
        return frame.executeJavaScript(`document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('#sidenavToggle').click()`);
      });
      await toggleSidebar();
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#0f766e' } }));
      await toggleSidebar();
      await expect.poll(async () => {
        const colors = await pdfColors(app);
        return { background: colors?.sidebarBackground, foreground: colors?.sidebarForeground };
      }).toEqual({ background: 'rgb(15, 118, 110)', foreground: 'rgb(255, 255, 255)' });
      await expect.poll(() => app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
        return frame.executeJavaScript(`(() => {
          const bar = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-pdf-sidenav').shadowRoot.querySelector('viewer-thumbnail-bar');
          const thumbnails = bar.shadowRoot.querySelectorAll('viewer-thumbnail');
          thumbnails[1].shadowRoot.querySelector('#thumbnail').click();
          return thumbnails[1].hasAttribute('is-active');
        })()`);
      })).toBe(true);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'system' } }));
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(246, 246, 247)');
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(60, 60, 60)');
    });
  });

  test('page-edge shadows match a fresh PDF after changing colors without zooming', async () => {
    await withApp(async (app, chrome, path) => {
      await app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getWindowBounds: () => Electron.Rectangle; setWindowBounds: (b: Electron.Rectangle) => void } }).__sidebrowserTestHooks;
        h.setWindowBounds({ ...h.getWindowBounds(), width: 1000 });
      });
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      const original = await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      const setup = async (zoom: number, y: number): Promise<void> => {
        await inPdf(app, `(() => { const v = document.querySelector('pdf-viewer').viewport; v.setZoom(${zoom}); v.setPosition({ x: 0, y: ${y} }); })()`);
        await expect.poll(() => inPdf(app, `(() => { const v = document.querySelector('pdf-viewer').viewport; return { zoom: v.getZoom(), ...v.position }; })()`)).toEqual({ zoom, x: 0, y });
      };
      await setup(0.5, 0);
      const edges = async (): Promise<number[]> => {
        const points = await inPdf<Array<{ x: number; y: number }>>(app, `(() => {
          const v = document.querySelector('pdf-viewer');
          const r = v.viewport.getPageScreenRect(0);
          const c = v.shadowRoot.querySelector('#scroller').getBoundingClientRect();
          const x = Math.round(c.x + r.x), y = Math.round(c.y + r.y);
          const right = Math.round(c.x + r.x + r.width), bottom = Math.round(c.y + r.y + r.height);
          const p = [];
          for (let offset = -5; offset <= 5; offset++) {
            const sideY = Math.max(c.y + 100, y + 100);
            p.push({ x: x + offset, y: sideY }, { x: right + offset, y: sideY }, { x: x + 100, y: bottom + offset });
          }
          return p.filter(p => p.x > c.x + 10 && p.x < c.right - 15 && p.y > c.y + 10 && p.y < c.bottom - 15);
        })()`);
        const png = await app.evaluate(async () => {
          const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
          return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
        });
        const { data, info } = await sharp(Buffer.from(png, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        return points.flatMap(({ x, y }) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]);
      };
      for (const [color, zoom, y] of [
        ['#7c3aed', 0.5, 0], ['#ffd966', 0.5, 0], ['#3c3c3c', 0.5, 0],
        ['#ffd966', 0.75, 120], ['#3c3c3c', 0.625, 220],
      ] as const) {
        await setup(zoom, y);
        await chrome.evaluate((color) => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: color } }), color);
        if (y) {
          // Exercise real navigation while the asynchronous shadow refresh is
          // pending. Its final native rendering must match the viewer's state.
          await Promise.all([
            chrome.evaluate(async () => {
              for (const color of ['#0f766e', '#7c3aed', '#ffd966']) {
                await window.sidebrowser.updateSettings({ appearance: { pdfToolbarColor: color } });
                await new Promise(resolve => setTimeout(resolve, 20));
              }
            }),
            inPdf(app, `(async () => {
              const v = document.querySelector('pdf-viewer').viewport;
              for (let i = 0; i < 6; i++) {
                v.setZoom(${zoom} + (i % 2 ? 0 : 0.1));
                v.setPosition({ x: 0, y: ${y} + i });
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              v.setPosition({ x: 0, y: ${y} });
            })()`),
          ]);
          await chrome.evaluate((color) => window.sidebrowser.updateSettings({ appearance: { pdfToolbarColor: color } }), color);
        }
        // Capture the still-active reader before opening or activating any
        // other tab, so a later visibility change cannot mask stale shadows.
        await new Promise(resolve => setTimeout(resolve, 300));
        const immediate = await edges();
        expect(immediate.length).toBeGreaterThan(30);
        const reference = await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
        await expectReader(app, chrome, pathToFileURL(path).href);
        await setup(zoom, y);
        let expected: number[] = [];
        await expect.poll(async () => { const next = await edges(); const same = JSON.stringify(next) === JSON.stringify(expected); expected = next; return same; }).toBe(true);
        expect(immediate).toEqual(expected);
        await chrome.evaluate((id) => window.sidebrowser.activateTab(id), original.id);
        await expect.poll(edges).toEqual(expected);
        await expect.poll(() => inPdf(app, `(() => { const v = document.querySelector('pdf-viewer').viewport; return { zoom: v.getZoom(), ...v.position }; })()`)).toEqual({ zoom, x: 0, y });
        await expect.poll(() => app.evaluate(async () => {
          const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
          for (const frame of h.getActiveWebContents().mainFrame.framesInSubtree) {
            const result = await frame.executeJavaScript(`(() => {
              const p = document.querySelector('body > embed[type="application/x-google-chrome-pdf"]');
              return p ? [p.style.width, p.style.height, p.style.transform, p.style.transformOrigin] : null;
            })()`);
            if (result) return result;
          }
          return null;
        })).toEqual(['', '', '', '']);
        await chrome.evaluate((id) => window.sidebrowser.closeTab(id), reference.id);
      }
    });
  });

  test('open PDF menus and lazy dialogs change colors immediately', async () => {
    await withApp(async (app, chrome, path) => {
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await inPdf(app, `document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('#more').click()`);
      const menuColors = `(() => {
        const menu = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('#menu');
        const dialog = menu.shadowRoot.querySelector('dialog');
        return { open: dialog.open, background: getComputedStyle(dialog).backgroundColor, foreground: getComputedStyle(menu.querySelector('button')).color };
      })()`;
      await expect.poll(() => inPdf(app, menuColors)).toEqual({ open: true, background: 'rgb(246, 246, 247)', foreground: 'rgb(0, 0, 0)' });
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#7c3aed' } }));
      await expect.poll(() => inPdf(app, menuColors)).toEqual({ open: true, background: 'rgb(124, 58, 237)', foreground: 'rgb(255, 255, 255)' });
      await inPdf(app, `(() => {
        const toolbar = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar');
        toolbar.shadowRoot.querySelector('#menu').close();
        toolbar.shadowRoot.querySelector('#properties-button').click();
      })()`);
      const dialogColors = `(() => {
        const properties = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-properties-dialog');
        const dialog = properties?.shadowRoot.querySelector('cr-dialog')?.shadowRoot.querySelector('dialog');
        const close = properties?.shadowRoot.querySelector('#close');
        if (!dialog || !close) return null;
        return { open: dialog.open, background: getComputedStyle(dialog).backgroundColor, foreground: getComputedStyle(properties.shadowRoot.querySelector('.value')).color, buttonText: getComputedStyle(close.shadowRoot.querySelector('#content')).color, buttonBackground: getComputedStyle(close).backgroundColor };
      })()`;
      await expect.poll(() => inPdf(app, dialogColors)).toEqual({ open: true, background: 'rgb(124, 58, 237)', foreground: 'rgb(255, 255, 255)', buttonText: 'rgb(124, 58, 237)', buttonBackground: 'rgb(255, 255, 255)' });
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await expect.poll(() => inPdf(app, dialogColors)).toEqual({ open: true, background: 'rgb(246, 246, 247)', foreground: 'rgb(0, 0, 0)', buttonText: 'rgb(246, 246, 247)', buttonBackground: 'rgb(0, 0, 0)' });
      await inPdf(app, `(() => {
        const viewer = document.querySelector('pdf-viewer');
        viewer.shadowRoot.querySelector('viewer-properties-dialog').shadowRoot.querySelector('cr-dialog').close();
        const downloads = viewer.shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('viewer-download-controls');
        downloads.shadowRoot.querySelector('#menu').showAt(downloads.shadowRoot.querySelector('#save'));
      })()`);
      await expect.poll(() => inPdf(app, `(() => {
        const menu = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('viewer-download-controls').shadowRoot.querySelector('#menu');
        return getComputedStyle(menu.shadowRoot.querySelector('dialog')).backgroundColor;
      })()`)).toBe('rgb(246, 246, 247)');
    });
  });

  test('PDF annotation panels, selections and scrollbars follow live colors', async () => {
    await withApp(async (app, chrome, path) => {
      await app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getWindowBounds: () => Electron.Rectangle; setWindowBounds: (b: Electron.Rectangle) => void } }).__sidebrowserTestHooks;
        h.setWindowBounds({ ...h.getWindowBounds(), width: 1000 });
      });
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await inPdf(app, `document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-toolbar').shadowRoot.querySelector('#annotate').click()`);
      const panelColors = `(() => {
        const root = document.querySelector('pdf-viewer').shadowRoot;
        const panels = [...root.querySelectorAll('viewer-side-panel, viewer-text-side-panel')];
        if (!panels.length) return null;
        const input = root.querySelector('viewer-toolbar').shadowRoot.querySelector('input');
        return { panels: panels.map(p => ({ background: getComputedStyle(p).backgroundColor, foreground: getComputedStyle(p).color })), selection: getComputedStyle(input, '::selection').backgroundColor, scrollbar: getComputedStyle(root.querySelector('#scroller')).scrollbarColor };
      })()`;
      for (const [color, background, foreground, thumb] of [
        ['#f6f6f7', 'rgb(246, 246, 247)', 'rgb(0, 0, 0)', 'rgba(0, 0, 0, 0.45)'],
        ['#7c3aed', 'rgb(124, 58, 237)', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 0.45)'],
      ] as const) {
        await chrome.evaluate((color) => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: color } }), color);
        await expect.poll(() => inPdf(app, panelColors)).toEqual({ panels: [{ background, foreground }, { background, foreground }], selection: foreground, scrollbar: `${thumb} ${background}` });
        // The actual document scrollbar is in the OOPIF plugin document, not
        // the viewer's proxy scroller. Assert that frame and its painted track.
        await expect.poll(() => app.evaluate(async () => {
          const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
          const colors = await Promise.all(h.getActiveWebContents().mainFrame.framesInSubtree.map(f => f.executeJavaScript(`document.querySelector('body > #sizer') && document.querySelector('embed[type="application/x-google-chrome-pdf"]') ? getComputedStyle(document.documentElement).scrollbarColor : null`)));
          return colors.filter(Boolean);
        })).toEqual([`${thumb} ${background}`]);
        const point = await inPdf<{ x: number; y: number }>(app, `(() => {
          const r = document.querySelector('pdf-viewer').shadowRoot.querySelector('#scroller').getBoundingClientRect();
          return { x: Math.floor(r.right - 1), y: 150 };
        })()`);
        await expect.poll(async () => {
          const png = await app.evaluate(async () => {
            const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
            return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
          });
          const { data, info } = await sharp(Buffer.from(png, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const offset = (point.y * info.width + point.x) * info.channels;
          return [...data.subarray(offset, offset + 3)];
        }).toEqual(background.match(/\d+/g)!.map(Number));
      }
    });
  });

  test('PDF find bar follows live PDF and system colors and resets on ordinary tabs', async () => {
    await withApp(async (app, chrome, _path, base) => {
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ browsing: { defaultIsMobile: false } }));
      // The response is PDF even though its URL has no .pdf suffix.
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), `${base}/document`);
      await expectReader(app, chrome, `${base}/document`);
      await expect.poll(() => chrome.evaluate(async () => {
        const s = await window.sidebrowser.requestTabsSnapshot();
        return s.tabs.find(t => t.id === s.activeId)?.isPdf;
      })).toBe(true);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { theme: 'light', pdfToolbarTheme: 'custom', pdfToolbarColor: '#7c3aed' } }));
      const openFind = (): Promise<void> => app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { sendShortcut: (action: string) => void } }).__sidebrowserTestHooks;
        h.sendShortcut('open-find');
      });
      await openFind();
      const find = chrome.getByTestId('find-bar');
      await expect(find).toBeVisible();
      await expect(find).toHaveCSS('background-color', 'rgb(124, 58, 237)');
      await expect(chrome.getByTestId('find-input')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await expect(find).toHaveCSS('background-color', 'rgb(246, 246, 247)');
      await expect(chrome.getByTestId('find-input')).toHaveCSS('color', 'rgb(0, 0, 0)');
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'system' } }));
      await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
      await expect(find).toHaveCSS('background-color', 'rgb(60, 60, 60)');
      await chrome.evaluate(() => window.sidebrowser.createTab());
      await openFind();
      await expect(find).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    });
  });

  test('PDF password, error and late sidebar components inherit live colors', async () => {
    await withApp(async (app, chrome, path) => {
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      // Exercise the viewer's normal reactive UI flags without needing an
      // encrypted/corrupt fixture or downloading an embedded attachment.
      await inPdf(app, `(() => {
        const v = document.querySelector('pdf-viewer');
        v.attachments_ = [{ name: 'notes.txt', size: 5, isReadable: true }];
        v.bookmarks_ = [{ title: 'Section', page: 0, children: [{ title: 'Nested', page: 1, children: [] }] }];
        v.showPasswordDialog_ = true;
      })()`);
      const dialogs = `(() => {
        const colors = [];
        const walk = root => {
          for (const d of root.querySelectorAll('dialog[open]')) colors.push({ background: getComputedStyle(d).backgroundColor, foreground: getComputedStyle(d).color });
          for (const e of root.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot);
        };
        walk(document.querySelector('pdf-viewer').shadowRoot);
        return colors;
      })()`;
      for (const [color, background, foreground] of [
        ['#f6f6f7', 'rgb(246, 246, 247)', 'rgb(0, 0, 0)'],
        ['#7c3aed', 'rgb(124, 58, 237)', 'rgb(255, 255, 255)'],
      ] as const) {
        await chrome.evaluate((color) => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: color } }), color);
        await expect.poll(() => inPdf(app, dialogs)).toEqual([{ background, foreground }]);
      }
      await inPdf(app, `(() => {
        const v = document.querySelector('pdf-viewer');
        v.showPasswordDialog_ = false;
        v.showErrorDialog = true;
      })()`);
      await expect.poll(() => inPdf(app, dialogs)).toEqual([{ background: 'rgb(124, 58, 237)', foreground: 'rgb(255, 255, 255)' }]);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await expect.poll(() => inPdf(app, dialogs)).toEqual([{ background: 'rgb(246, 246, 247)', foreground: 'rgb(0, 0, 0)' }]);
      await expect.poll(() => inPdf(app, `(() => {
        const nav = document.querySelector('pdf-viewer').shadowRoot.querySelector('viewer-pdf-sidenav');
        const bookmark = nav.shadowRoot.querySelector('viewer-document-outline').shadowRoot.querySelector('viewer-bookmark');
        const attachment = nav.shadowRoot.querySelector('viewer-attachment-bar').shadowRoot.querySelector('viewer-attachment');
        return { bookmark: bookmark?.shadowRoot.querySelector('#title') ? getComputedStyle(bookmark.shadowRoot.querySelector('#title')).color : '', attachment: attachment?.shadowRoot.querySelector('#title') ? getComputedStyle(attachment.shadowRoot.querySelector('#title')).color : '' };
      })()`)).toEqual({ bookmark: 'rgb(0, 0, 0)', attachment: 'rgb(0, 0, 0)' });
    });
  });

  test('palette, hue, spectrum, HEX and reset controls work in Settings', async () => {
    await withApp(async (app, chrome, path) => {
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      const appTheme = await chrome.evaluate(() => document.documentElement.dataset.theme);
      await chrome.getByTestId('topbar-settings-toggle').click();
      await chrome.getByTestId('settings-pdf-toolbar-theme').selectOption('custom');
      await expect(chrome.getByTestId('pdf-toolbar-palette')).toBeVisible();
      await chrome.getByRole('button', { name: 'Use Teal', exact: true }).click();
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(15, 118, 110)');
      const hex = chrome.getByTestId('pdf-color-hex');
      await hex.fill('#FFD966');
      await hex.press('Enter');
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(255, 217, 102)');
      await chrome.getByTestId('pdf-color-hue').press('Home');
      const spectrum = chrome.getByTestId('pdf-color-spectrum');
      const bounds = (await spectrum.boundingBox())!;
      await spectrum.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      await expect(hex).toHaveValue('#804040');
      await spectrum.press('ArrowLeft');
      await expect(hex).toHaveValue('#804343');
      await hex.fill('invalid');
      await hex.press('Tab');
      await expect(hex).toHaveValue('#804343');
      expect(await chrome.evaluate(() => document.documentElement.dataset.theme)).toBe(appTheme);
      await chrome.screenshot({ path: test.info().outputPath('pdf-toolbar-palette.png') });
      await chrome.getByTestId('settings-close').click();
      await expect.poll(() => app.evaluate(() => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveViewVisible: () => boolean } }).__sidebrowserTestHooks;
        return h.getActiveViewVisible();
      })).toBe(true);
      const png = await app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
      });
      writeFileSync(test.info().outputPath('pdf-toolbar-custom.png'), Buffer.from(png, 'base64'));
      await chrome.getByTestId('topbar-settings-toggle').click();
      await chrome.getByTestId('reset-pdf-toolbar').click();
      await expect(chrome.getByTestId('settings-pdf-toolbar-theme')).toHaveValue('system');
      await expect(chrome.getByTestId('pdf-toolbar-palette')).toHaveCount(0);
      await expect(chrome.getByTestId('reset-pdf-toolbar')).not.toBeVisible();
      expect((await chrome.evaluate(() => window.sidebrowser.getSettings())).appearance.pdfToolbarColor).toBe('#3c3c3c');
    });
  });

  test('closing Settings reveals the latest PDF color without moving the viewport', async () => {
    await withApp(async (app, chrome, path) => {
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: {
          getActiveWebContents: () => Electron.WebContents;
          getWindowBounds: () => Electron.Rectangle;
          setWindowBounds: (bounds: Electron.Rectangle) => void;
        } }).__sidebrowserTestHooks;
        h.setWindowBounds({ ...h.getWindowBounds(), width: 900 });
        const frame = h.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'))!;
        await frame.executeJavaScript(`document.querySelector('pdf-viewer').viewport.setZoom(0.5)`);
      });
      for (const [name, expected] of [['Teal', [15, 118, 110]], ['Yellow', [253, 224, 71]], ['Purple', [124, 58, 237]]] as const) {
        await chrome.getByTestId('topbar-settings-toggle').click();
        await chrome.getByTestId('settings-pdf-toolbar-theme').selectOption('custom');
        await chrome.getByRole('button', { name: `Use ${name}`, exact: true }).click();
        await chrome.getByTestId('settings-close').click();
        await expect.poll(async () => {
          const png = await app.evaluate(async () => {
            const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
            return (await h.getActiveWebContents().capturePage()).toPNG().toString('base64');
          });
          const { data, info } = await sharp(Buffer.from(png, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const offset = (150 * info.width + info.width - 30) * info.channels;
          return [...data.subarray(offset, offset + 3)];
        }).toEqual([...expected]);
      }
    });
  });

  test('color applies to new and background PDF tabs, reload and lazy restore', async () => {
    await withApp(async (app, chrome, path, base) => {
      const first = await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#0f766e' } }));
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), `${base}/inline.pdf`);
      await expectReader(app, chrome, `${base}/inline.pdf`);
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(15, 118, 110)');
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'light' } }));
      await chrome.evaluate((id) => window.sidebrowser.activateTab(id), first.id);
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(246, 246, 247)');
      await app.evaluate(async () => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
        const wc = h.getActiveWebContents();
        await new Promise<void>((done) => { wc.once('did-finish-load', done); wc.reload(); });
      });
      await expectReader(app, chrome, pathToFileURL(path).href);
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(246, 246, 247)');
      await chrome.evaluate(() => window.sidebrowser.createTab());
      await app.evaluate((_electron, id) => {
        const h = (globalThis as unknown as { __sidebrowserTestHooks: { unloadTab: (id: string) => boolean } }).__sidebrowserTestHooks;
        h.unloadTab(id);
      }, first.id);
      await chrome.evaluate((id) => window.sidebrowser.activateTab(id), first.id);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await expect.poll(async () => (await pdfColors(app))?.background).toBe('rgb(246, 246, 247)');
    });
  });

  test('custom toolbar color persists across app restart', async () => {
    await withApp(async (app, chrome, path) => {
      const profile = await app.evaluate(({ app }) => app.getPath('userData'));
      await chrome.evaluate((url) => window.sidebrowser.createTab(url), pathToFileURL(path).href);
      await expectReader(app, chrome, pathToFileURL(path).href);
      await chrome.evaluate(() => window.sidebrowser.updateSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#fb923c' } }));
      await app.close();
      const restored = await electron.launch({ args: [resolve('out/main/index.cjs'), `--user-data-dir=${profile}`], env: { ...process.env, SIDEBROWSER_E2E: '1' } });
      try {
        const restoredChrome = await getChromeWindow(restored);
        await waitForAddressBarReady(restoredChrome);
        await expectReader(restored, restoredChrome, pathToFileURL(path).href);
        await expect.poll(async () => (await pdfColors(restored))?.background).toBe('rgb(251, 146, 60)');
        const settings = await restoredChrome.evaluate(() => window.sidebrowser.getSettings());
        expect(settings.appearance.pdfToolbarTheme).toBe('custom');
        expect(settings.appearance.pdfToolbarColor).toBe('#fb923c');
      } finally { await restored.close(); }
    });
  });
});
