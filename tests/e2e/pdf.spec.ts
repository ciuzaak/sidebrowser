import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getChromeWindow, navigateActive, waitForAddressBarReady } from './helpers';

/** One-page, valid PDF with deterministic xref offsets; no external fixture. */
function samplePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 40 700 Td (Sidebrowser PDF test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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
  // parsed the fixture and reported a successful load with one page.
  await expect.poll(async () => app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __sidebrowserTestHooks: { getActiveWebContents: () => Electron.WebContents } }).__sidebrowserTestHooks;
    const frame = hooks.getActiveWebContents().mainFrame.framesInSubtree.find((f) => f.url.startsWith('chrome-extension://'));
    if (!frame) return null;
    return frame.executeJavaScript(`(() => {
      const viewer = document.querySelector('pdf-viewer');
      return { state: viewer?.loadState_, pages: viewer?.documentDimensions?.pageDimensions?.length };
    })()`);
  }), { timeout: 15_000 }).toEqual({ state: 'success', pages: 1 });
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
      const before = await chrome.evaluate(() => window.sidebrowser.requestTabsSnapshot());
      await chrome.evaluate(() => window.sidebrowser.openPdf());
      expect(await chrome.evaluate(() => window.sidebrowser.requestTabsSnapshot())).toEqual(before);
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
});
