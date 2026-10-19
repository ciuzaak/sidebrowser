import type { PdfToolbarStyle } from '@shared/pdf-toolbar';

export interface PdfPluginViewport {
  zoom: number;
  xOffset: number;
  yOffset: number;
  layoutOptions: unknown;
  deviceScale: number;
}

/** Self-contained: serialized and executed only inside Chromium's PDF viewer. */
export function applyPdfViewerStyle(style: PdfToolbarStyle): PdfPluginViewport | null {
  const scope = window as Window & {
    __sidebrowserPdfToolbarTheme?: { apply: (style: PdfToolbarStyle) => PdfPluginViewport | null };
  };
  if (scope.__sidebrowserPdfToolbarTheme) {
    return scope.__sidebrowserPdfToolbarTheme.apply(style);
  }
  let current = style;
  let styledPlugin: Element | null = null;
  let pluginColor = '';
  let queued = false;
  const pendingDefinitions = new Set<string>();
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; update(); });
  };
  const observer = new MutationObserver(schedule);
  const css = `
    :host {
      color: var(--sb-pdf-fg) !important;
      --pdf-toolbar-text-color: var(--sb-pdf-fg) !important;
      --primary-text-color: var(--sb-pdf-fg) !important;
      --cr-primary-text-color: var(--sb-pdf-fg) !important;
      --cr-secondary-text-color: var(--sb-pdf-fg) !important;
      --cr-menu-background-color: var(--sb-pdf-bg) !important;
      --cr-menu-background-focus-color: var(--sb-pdf-hover) !important;
      --cr-action-menu-disabled-item-color: var(--sb-pdf-fg) !important;
      --cr-dialog-background-color: var(--sb-pdf-bg) !important;
      --cr-toast-background: var(--sb-pdf-bg) !important;
      --cr-toast-text-color: var(--sb-pdf-fg) !important;
      --cr-input-background-color: var(--sb-pdf-hover) !important;
      --cr-input-color: var(--sb-pdf-fg) !important;
      --cr-input-label-color: var(--sb-pdf-fg) !important;
      --cr-input-placeholder-color: var(--sb-pdf-fg) !important;
      --cr-input-focus-color: var(--sb-pdf-fg) !important;
      --cr-focus-outline-color: var(--sb-pdf-fg) !important;
      --viewer-icon-focus-outline-color: var(--sb-pdf-fg) !important;
      --viewer-side-background-color: var(--sb-pdf-bg) !important;
      --viewer-pdf-toolbar-background-color: var(--sb-pdf-bg) !important;
      --viewer-border-color: var(--sb-pdf-border) !important;
      --sidenav-selected-tab-color: var(--sb-pdf-fg) !important;
      --focus-border-color: var(--sb-pdf-fg) !important;
      --active-button-bg: var(--sb-pdf-hover) !important;
      --viewer-icon-ink-fill-color: var(--sb-pdf-fg) !important;
      --viewer-icon-ink-selected-fill-color: var(--sb-pdf-fg) !important;
      --viewer-icon-ink-selected-background-color: var(--sb-pdf-hover) !important;
      --viewer-icon-ink-background-color: var(--sb-pdf-border) !important;
    }
    :host, * { scrollbar-color: var(--sb-pdf-scroll-thumb) var(--sb-pdf-bg); }
    ::-webkit-scrollbar { width: 14px; height: 14px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: var(--sb-pdf-bg); }
    ::-webkit-scrollbar-thumb { background: var(--sb-pdf-scroll-thumb); border: 3px solid var(--sb-pdf-bg); border-radius: 7px; }
    ::selection { background: var(--sb-pdf-fg) !important; color: var(--sb-pdf-bg) !important; }
    dialog, #toolbar { background-color: var(--sb-pdf-bg) !important; background-image: none !important; color: var(--sb-pdf-fg) !important; }
    :host(pdf-viewer) #content, :host(viewer-page-selector) #content, :host(viewer-pdf-sidenav) #content { color: var(--sb-pdf-fg) !important; }
    #pageNumber, #title, #warning, .name, .value { color: var(--sb-pdf-fg) !important; }
    input:not([type=range]):not([type=radio]):not([type=checkbox]):not([type=color]), textarea, select {
      color: var(--sb-pdf-fg) !important; background-color: var(--sb-pdf-hover) !important;
    }
    .md-select { --md-select-option-bg-color: var(--sb-pdf-bg); --md-select-text-color: var(--sb-pdf-fg); background-image: var(--sb-pdf-select-arrow) !important; }
    option, optgroup { color: var(--sb-pdf-fg) !important; background: var(--sb-pdf-bg) !important; }
    cr-action-menu { --cr-primary-text-color: var(--sb-pdf-fg) !important; --cr-menu-background-color: var(--sb-pdf-bg) !important; }
    cr-icon-button { --cr-icon-button-fill-color: var(--sb-pdf-fg) !important; --cr-icon-button-focus-outline-color: var(--sb-pdf-fg) !important; }
    cr-icon-button:hover, #item:hover, #item:active { background-color: var(--sb-pdf-hover) !important; }
    cr-icon-button[data-selected=true], selectable-icon-button[checked] cr-icon-button { background-color: var(--sb-pdf-hover) !important; }
    cr-button { --cr-button-text-color: var(--sb-pdf-fg); --cr-button-background-color: var(--sb-pdf-bg); --cr-button-border-color: var(--sb-pdf-border); }
    cr-button.action-button { --cr-button-text-color: var(--sb-pdf-bg); --cr-button-background-color: var(--sb-pdf-fg); }
    :host(cr-button.action-button) { color: var(--sb-pdf-bg) !important; }
    .vertical-separator { background: var(--sb-pdf-border) !important; }
    hr, .break > td { border-color: var(--sb-pdf-border) !important; }
  `;
  // Share parsed rules across thumbnail, icon and dialog shadow trees, rather
  // than duplicating a stylesheet for every page in a large document.
  const themeSheet = new CSSStyleSheet();
  themeSheet.replaceSync(css);
  const watch = (root: Document | ShadowRoot): void => {
    if (root instanceof ShadowRoot && !root.adoptedStyleSheets.includes(themeSheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, themeSheet];
    }
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) watch(element.shadowRoot);
      else if (element.localName.includes('-') && !customElements.get(element.localName) && !pendingDefinitions.has(element.localName)) {
        pendingDefinitions.add(element.localName);
        void customElements.whenDefined(element.localName).then(schedule);
      }
    }
    // Child lists catch lazy dialogs, nested bookmarks and annotation controls.
    // Attribute changes (focus, painting, progress) do not retrigger the walk.
    observer.observe(root, { childList: true, subtree: true });
  };
  const readViewport = (): PdfPluginViewport | null => {
    const viewer = document.querySelector<HTMLElement & {
      documentDimensions?: unknown;
      viewport?: { getZoom: () => number; position: { x: number; y: number }; getLayoutOptions: () => unknown };
    }>('pdf-viewer');
    const viewport = viewer?.viewport;
    return viewer?.documentDimensions && viewport ? {
      zoom: viewport.getZoom(), xOffset: viewport.position.x, yOffset: viewport.position.y,
      layoutOptions: viewport.getLayoutOptions(), deviceScale: window.devicePixelRatio,
    } : null;
  };
  // The native frame asks for current state rather than replaying a snapshot
  // captured before a concurrent user scroll/zoom. A port keeps replies private.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'sidebrowser-pdf-viewport' || !event.ports[0] || (event.source as Window | null)?.parent !== window) return;
    event.stopImmediatePropagation();
    if (event.data.repaint) {
      document.querySelector<HTMLElement & { pluginController_?: { afterZoom?: () => void } }>('pdf-viewer')?.pluginController_?.afterZoom?.();
    }
    event.ports[0].postMessage(readViewport());
    event.ports[0].close();
  }, true);
  const update = (): PdfPluginViewport | null => {
    observer.disconnect();
    const viewer = document.querySelector<HTMLElement & {
      documentDimensions?: unknown;
      viewport?: { getZoom: () => number; position: { x: number; y: number }; getLayoutOptions: () => unknown };
      pluginController_?: { setBackgroundColor?: (color: number) => void; afterZoom?: () => void };
    }>('pdf-viewer');
    const root = viewer?.shadowRoot;
    const rgb = current.foreground === '#ffffff' ? '255,255,255' : '0,0,0';
    const html = document.documentElement;
    for (const [name, value] of Object.entries({
      '--sb-pdf-bg': current.background,
      '--sb-pdf-fg': current.foreground,
      '--sb-pdf-hover': `rgba(${rgb},.14)`,
      '--sb-pdf-border': `rgba(${rgb},.3)`,
      '--sb-pdf-scroll-thumb': `rgba(${rgb},.45)`,
      '--sb-pdf-select-arrow': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath fill='%23${current.foreground.slice(1)}' d='M0 0h10L5 6z'/%3E%3C/svg%3E")`,
    })) html.style.setProperty(name, value);
    html.style.colorScheme = current.foreground === '#ffffff' ? 'dark' : 'light';
    html.style.backgroundColor = current.background;
    document.body.style.backgroundColor = current.background;
    if (viewer && root) {
      viewer.style.backgroundColor = current.background;
      // Reading surfaces surround the native plugin; its page artwork is untouched.
      let sheet = root.querySelector<HTMLStyleElement>('#sidebrowser-pdf-reading-colors');
      if (!sheet) { sheet = document.createElement('style'); sheet.id = 'sidebrowser-pdf-reading-colors'; root.append(sheet); }
      const readingCss = '#main, #scroller, #content { background-color: var(--sb-pdf-bg) !important; }';
      if (sheet.textContent !== readingCss) sheet.textContent = readingCss;
      const plugin = root.querySelector('embed#plugin');
      if (plugin && viewer.pluginController_?.setBackgroundColor && (plugin !== styledPlugin || current.background !== pluginColor)) {
        const color = (0xff000000 | parseInt(current.background.slice(1), 16)) >>> 0;
        viewer.pluginController_.setBackgroundColor(color);
        // Chromium stores the color without invalidating its native paint buffer.
        // Resending the unchanged layout repaints immediately, preserving position.
        if (viewer.documentDimensions) viewer.pluginController_.afterZoom?.();
        plugin.setAttribute('background-color', String(color));
        styledPlugin = plugin;
        pluginColor = current.background;
      }
    }
    watch(document);
    return readViewport();
  };
  scope.__sidebrowserPdfToolbarTheme = { apply: (next) => { current = next; return update(); } };
  return update();
}

/** OOPIF PDFs render the document scrollbar in a separate native-plugin frame. */
export function applyPdfPluginSurfaceStyle(style: PdfToolbarStyle, viewport: PdfPluginViewport | null = null): Promise<void> | void {
  const plugin = document.querySelector<HTMLEmbedElement & { postMessage?: (message: unknown) => void }>('embed[type="application/x-google-chrome-pdf"][original-url]');
  if (!plugin || !document.querySelector('body > #sizer')) return;
  // Only Chromium's generated plugin document has this extension stream URL.
  try {
    const src = new URL(plugin.src);
    if (src.protocol !== 'chrome-extension:' || src.hostname !== 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return;
  } catch { return; }
  const scope = window as Window & {
    __sidebrowserPdfSurfaceTheme?: { apply: (style: PdfToolbarStyle, viewport: PdfPluginViewport | null) => Promise<void> };
  };
  if (scope.__sidebrowserPdfSurfaceTheme) return scope.__sidebrowserPdfSurfaceTheme.apply(style, viewport);
  const html = document.documentElement;
  let sheet = document.querySelector<HTMLStyleElement>('#sidebrowser-pdf-plugin-colors');
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.id = 'sidebrowser-pdf-plugin-colors';
    document.head.append(sheet);
  }
  const css = `
    html, body { background-color: var(--sb-pdf-bg) !important; }
    html, body, * { scrollbar-color: var(--sb-pdf-scroll-thumb) var(--sb-pdf-bg); }
    ::-webkit-scrollbar { width: 14px; height: 14px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: var(--sb-pdf-bg) !important; }
    ::-webkit-scrollbar-thumb { background-color: var(--sb-pdf-scroll-thumb) !important; border: 3px solid var(--sb-pdf-bg); border-radius: 7px; }
  `;
  if (sheet.textContent !== css) sheet.textContent = css;
  let shadowColor = '';
  let pending: PdfToolbarStyle | null = null;
  let running: Promise<void> | null = null;
  const postMessage = plugin.postMessage?.bind(plugin);
  const requestViewport = (repaint = false): Promise<PdfPluginViewport | null> => new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (value: PdfPluginViewport | null): void => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), 1000);
    channel.port1.onmessage = event => finish(event.data as PdfPluginViewport | null);
    window.parent.postMessage({ type: 'sidebrowser-pdf-viewport', repaint }, '*', [channel.port2]);
  });
  const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const drain = async (): Promise<void> => {
    while (pending) {
      // Let the normal background/layout messages finish before warming the
      // native shadow cache. Coalesce rapid palette changes to the latest one.
      await paint();
      const next = pending;
      pending = null;
      if (next.background === shadowColor || !postMessage) continue;
      const v = await requestViewport();
      if (!v) continue;
      const depth = Math.ceil(7 * v.zoom * v.deviceScale);
      const scale = Math.ceil(7 * v.zoom * v.deviceScale * 0.5) !== depth ? 0.5 : 2;
      const properties = ['width', 'height', 'transform', 'transform-origin'];
      const saved = properties.map(name => [name, plugin.style.getPropertyValue(name), plugin.style.getPropertyPriority(name)]);
      const rect = plugin.getBoundingClientRect();
      const sendViewport = (factor: number): void => postMessage({
        type: 'viewport', zoom: v.zoom * factor, layoutOptions: v.layoutOptions,
        xOffset: v.xOffset * factor, yOffset: v.yOffset * factor, pinchPhase: 0, userInitiated: false,
      });
      const restore = (): void => {
        for (const [name, value, priority] of saved) {
          if (value) plugin.style.setProperty(name!, value, priority);
          else plugin.style.removeProperty(name!);
        }
      };
      try {
        // PDFium's shadow matrix is keyed by shadow depth, not background color.
        // Warm a different depth at a compensated render scale: the plugin's
        // CSS size and inverse transform keep its displayed size unchanged.
        // The viewer's zoom, page number and scroll state are never modified.
        plugin.style.setProperty('width', `${rect.width * scale}px`);
        plugin.style.setProperty('height', `${rect.height * scale}px`);
        plugin.style.setProperty('transform-origin', '0 0');
        plugin.style.setProperty('transform', `scale(${1 / scale})`);
        postMessage({ type: 'setBackgroundColor', color: (0xff000000 | parseInt(next.background.slice(1), 16)) >>> 0 });
        sendViewport(scale);
        await paint();
      } finally {
        restore();
        // Let the viewer send its live viewport after restoring CSS, so that
        // concurrent user navigation takes priority over the cache refresh.
        await requestViewport(true);
      }
      await paint();
      shadowColor = next.background;
    }
  };
  scope.__sidebrowserPdfSurfaceTheme = {
    apply: (next, nextViewport) => {
      const nextRgb = next.foreground === '#ffffff' ? '255,255,255' : '0,0,0';
      html.style.colorScheme = next.foreground === '#ffffff' ? 'dark' : 'light';
      html.style.setProperty('--sb-pdf-bg', next.background);
      html.style.setProperty('--sb-pdf-scroll-thumb', `rgba(${nextRgb},.45)`);
      if (nextViewport && (running || next.background !== shadowColor)) pending = next;
      if (!running && pending) running = drain().finally(() => { running = null; });
      return running ?? Promise.resolve();
    },
  };
  return scope.__sidebrowserPdfSurfaceTheme.apply(style, viewport);
}
