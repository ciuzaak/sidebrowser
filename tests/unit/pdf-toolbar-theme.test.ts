import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { buildPdfToolbarScript, isPdfViewerFrame, PdfToolbarThemes } from '../../src/main/pdf-toolbar-theme';

const PDF_FRAME = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html';

function fakeContents(url = PDF_FRAME) {
  const frame = { url, executeJavaScript: vi.fn().mockResolvedValue(undefined) };
  const wc = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { framesInSubtree: [frame] } });
  return { frame, wc, contents: wc as unknown as WebContents };
}

describe('PDF toolbar frame isolation and lifecycle', () => {
  it('only recognizes the built-in extension viewer frame', () => {
    expect(isPdfViewerFrame(PDF_FRAME)).toBe(true);
    for (const url of ['https://example.com/index.html', PDF_FRAME + '.html', 'chrome-extension://other/index.html', 'file:///index.html']) {
      expect(isPdfViewerFrame(url)).toBe(false);
    }
  });

  it('updates new frames, deduplicates unrelated updates and detaches on destroy', () => {
    const { wc, frame, contents } = fakeContents();
    let background = '#3c3c3c';
    const themes = new PdfToolbarThemes(() => ({ background, foreground: '#ffffff' }));
    themes.attach(contents);
    themes.attach(contents);
    expect(wc.listenerCount('did-frame-finish-load')).toBe(1);
    expect(frame.executeJavaScript).toHaveBeenCalledOnce();
    themes.refresh();
    frame.executeJavaScript.mockClear();
    themes.refresh();
    expect(frame.executeJavaScript).not.toHaveBeenCalled();
    background = '#abcdef';
    themes.refresh();
    expect(frame.executeJavaScript).toHaveBeenCalledOnce();
    wc.emit('did-frame-finish-load');
    expect(frame.executeJavaScript).toHaveBeenCalledTimes(2);
    wc.emit('destroyed');
    expect(wc.listenerCount('did-frame-finish-load')).toBe(0);
    background = '#123456';
    themes.refresh();
    expect(frame.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('leaves ordinary pages untouched and cleans up on window close', () => {
    const normal = fakeContents('https://example.com/');
    const pdf = fakeContents();
    const themes = new PdfToolbarThemes(() => ({ background: '#3c3c3c', foreground: '#ffffff' }));
    themes.attach(normal.contents);
    themes.attach(pdf.contents);
    themes.refresh();
    expect(normal.frame.executeJavaScript).not.toHaveBeenCalled();
    themes.dispose();
    expect(normal.wc.listenerCount('did-frame-finish-load')).toBe(0);
    expect(pdf.wc.listenerCount('did-frame-finish-load')).toBe(0);
  });

  it('does not serialize untrusted color strings into the injected script', () => {
    const script = buildPdfToolbarScript({ background: '#fff;alert(1)', foreground: 'malicious' });
    expect(script).not.toContain('alert(1)');
    expect(script).not.toContain('malicious');
    expect(script).toContain('"background":"#3c3c3c"');
  });
});
