import type { WebContents } from 'electron';
import { normalizeHexColor, PDF_TOOLBAR_DARK, toolbarForeground, type PdfToolbarStyle } from '@shared/pdf-toolbar';

import { applyPdfPluginSurfaceStyle, applyPdfViewerStyle, type PdfPluginViewport } from './pdf-viewer-style';

const PDF_EXTENSION = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

export function isPdfViewerFrame(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.hostname === PDF_EXTENSION && parsed.pathname === '/index.html';
  } catch { return false; }
}

export function buildPdfToolbarScript(style: PdfToolbarStyle): string {
  // Persisted settings and IPC input never become arbitrary CSS or JavaScript.
  const background = normalizeHexColor(style.background) ?? PDF_TOOLBAR_DARK;
  return `(${applyPdfViewerStyle.toString()})(${JSON.stringify({ background, foreground: toolbarForeground(background) })})`;
}

/** Owns frame-load listeners and updates every loaded PDF, including background tabs. */
export class PdfToolbarThemes {
  private readonly contents = new Map<WebContents, () => void>();
  private lastScript = '';

  constructor(private readonly getStyle: () => PdfToolbarStyle) {}

  attach(wc: WebContents): void {
    if (this.contents.has(wc) || wc.isDestroyed()) return;
    const onLoad = (): void => this.apply(wc, buildPdfToolbarScript(this.getStyle()));
    const detach = (): void => {
      wc.off('did-frame-finish-load', onLoad);
      wc.off('destroyed', detach);
      this.contents.delete(wc);
    };
    this.contents.set(wc, detach);
    wc.on('did-frame-finish-load', onLoad);
    wc.on('destroyed', detach);
    onLoad();
  }

  refresh(): void {
    const script = buildPdfToolbarScript(this.getStyle());
    if (script === this.lastScript) return;
    this.lastScript = script;
    for (const wc of this.contents.keys()) this.apply(wc, script);
  }

  dispose(): void {
    for (const detach of this.contents.values()) detach();
  }

  private apply(wc: WebContents, script: string): void {
    if (wc.isDestroyed()) return;
    const frames = wc.mainFrame.framesInSubtree;
    if (!frames.some(frame => isPdfViewerFrame(frame.url))) return;
    const background = normalizeHexColor(this.getStyle().background) ?? PDF_TOOLBAR_DARK;
    const style = { background, foreground: toolbarForeground(background) };
    for (const frame of frames.filter(frame => isPdfViewerFrame(frame.url))) {
      void frame.executeJavaScript(script).then((value) => {
        if (wc.isDestroyed()) return;
        const viewport = value as PdfPluginViewport | null;
        const surfaceScript = `(${applyPdfPluginSurfaceStyle.toString()})(${JSON.stringify(style)},${JSON.stringify(viewport ?? null)})`;
        for (const surface of wc.mainFrame.framesInSubtree) {
          // Guarded inside the script: only Chromium's generated native plugin
          // document receives styles and the compensated shadow-cache refresh.
          if (!isPdfViewerFrame(surface.url)) void surface.executeJavaScript(surfaceScript).catch(() => {});
        }
      }).catch(() => {});
    }
  }
}
