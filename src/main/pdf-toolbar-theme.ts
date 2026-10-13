import type { WebContents } from 'electron';
import { normalizeHexColor, PDF_TOOLBAR_DARK, toolbarForeground, type PdfToolbarStyle } from '@shared/pdf-toolbar';

const PDF_EXTENSION = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

export function isPdfViewerFrame(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.hostname === PDF_EXTENSION && parsed.pathname === '/index.html';
  } catch { return false; }
}

/** Executes only in Chromium's PDF extension; every selector stays inside its toolbar. */
function applyToolbarStyle(style: PdfToolbarStyle): void {
  const scope = window as Window & {
    __sidebrowserPdfToolbarTheme?: { apply: (style: PdfToolbarStyle) => void };
  };
  if (scope.__sidebrowserPdfToolbarTheme) {
    scope.__sidebrowserPdfToolbarTheme.apply(style);
    return;
  }
  let current = style;
  const observer = new MutationObserver(() => update());
  const update = (): void => {
    const viewer = document.querySelector('pdf-viewer');
    const toolbar = viewer?.shadowRoot?.querySelector<HTMLElement>('viewer-toolbar');
    if (!toolbar?.shadowRoot) {
      if (viewer?.shadowRoot) observer.observe(viewer.shadowRoot, { childList: true, subtree: true });
      return;
    }
    observer.disconnect();
    toolbar.style.setProperty('--viewer-pdf-toolbar-background-color', current.background);
    toolbar.style.setProperty('--pdf-toolbar-text-color', current.foreground);
    let sheet = toolbar.shadowRoot.querySelector<HTMLStyleElement>('#sidebrowser-pdf-toolbar-colors');
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'sidebrowser-pdf-toolbar-colors';
      toolbar.shadowRoot.append(sheet);
    }
    const rgb = current.foreground === '#ffffff' ? '255,255,255' : '0,0,0';
    const css = `
      #toolbar { background-color: ${current.background} !important; color: ${current.foreground} !important; }
      :host { --active-button-bg: rgba(${rgb},.16); --viewer-icon-focus-outline-color: ${current.foreground}; }
      .vertical-separator { background: rgba(${rgb},.3) !important; }
      #toolbar input { background: rgba(${rgb},.1); color: ${current.foreground}; }
      #toolbar cr-icon-button:hover { background: rgba(${rgb},.1); }
    `;
    if (sheet.textContent !== css) sheet.textContent = css;
    // Page numbers have their own shadow tree and hardcoded white text.
    const pageSelector = toolbar.shadowRoot.querySelector('viewer-page-selector');
    if (pageSelector?.shadowRoot) {
      let pageSheet = pageSelector.shadowRoot.querySelector<HTMLStyleElement>('#sidebrowser-pdf-page-selector-colors');
      if (!pageSheet) {
        pageSheet = document.createElement('style');
        pageSheet.id = 'sidebrowser-pdf-page-selector-colors';
        pageSelector.shadowRoot.append(pageSheet);
      }
      const pageCss = `#content, input { color: ${current.foreground} !important; } input { background: rgba(${rgb},.1) !important; }`;
      if (pageSheet.textContent !== pageCss) pageSheet.textContent = pageCss;
    }
  };
  scope.__sidebrowserPdfToolbarTheme = {
    apply: (next) => { current = next; update(); },
  };
  observer.observe(document, { childList: true, subtree: true });
  void customElements.whenDefined('pdf-viewer').then(update);
  void customElements.whenDefined('viewer-toolbar').then(update);
  void customElements.whenDefined('viewer-page-selector').then(update);
  update();
}

export function buildPdfToolbarScript(style: PdfToolbarStyle): string {
  // Persisted settings and IPC input never become arbitrary CSS or JavaScript.
  const background = normalizeHexColor(style.background) ?? PDF_TOOLBAR_DARK;
  return `(${applyToolbarStyle.toString()})(${JSON.stringify({ background, foreground: toolbarForeground(background) })})`;
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
    for (const frame of wc.mainFrame.framesInSubtree) {
      if (isPdfViewerFrame(frame.url)) {
        // Navigation/unloading can destroy a frame while the promise is pending.
        void frame.executeJavaScript(script).catch(() => {});
      }
    }
  }
}
