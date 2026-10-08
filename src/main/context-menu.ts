/**
 * context-menu.ts — Pure builder for the web context-menu template (M13, M16).
 *
 * Tiers stack top-to-bottom, each ending with a separator:
 *   spelling (misspelled word) → editable (inputs) — OR — selection →
 *   image → link → page (navigation, zoom, external, source).
 * Inside an editable field only the spelling + edit tiers are shown (like
 * Chrome): page actions there are noise.
 *
 * Like keyboard-shortcuts.ts this is type-only on `electron` — no runtime
 * import — so vitest can build the template without spinning up an Electron
 * runtime. The actual `Menu.buildFromTemplate` + `popup` happens in
 * view-manager's context-menu handler.
 */

import type { MenuItemConstructorOptions, ContextMenuParams } from 'electron';

export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll';

export interface ContextMenuDeps {
  /** shell.openExternal(url) (sanitized at the call site). */
  openInSystemBrowser: (url: string) => void;
  /** viewManager.createTab(url). */
  openInNewTab: (url: string) => void;
  /** clipboard.writeText(text). */
  copyToClipboard: (text: string) => void;
  /** Resolve active search engine + open as a new tab. */
  searchSelection: (text: string) => void;
  /** viewManager.createTab(`view-source:${url}`). */
  viewSource: (url: string) => void;
  /** Delegates to ViewManager.{goBackActive,goForwardActive,reloadActive}. */
  navigateActive: (action: 'back' | 'forward' | 'reload') => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Display name of the currently-active search engine — feeds the selection-search label. */
  activeSearchEngineName: string;
  // ── M16 (per-event; ViewManager fills these for the clicked tab) ──────────
  /** webContents edit commands (undo/cut/paste/…). */
  edit: (command: EditCommand) => void;
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  /** webContents.copyImageAt(x, y). */
  copyImageAt: (x: number, y: number) => void;
  /** webContents.downloadURL(url) — lands in the Downloads flow. */
  saveUrl: (url: string) => void;
  zoom: (action: 'in' | 'out' | 'reset') => void;
  /** Current zoom of the clicked tab, in percent. */
  zoomPercent: number;
}

/**
 * The bootstrap-time part of the deps (index.ts). ViewManager adds the
 * per-event fields (nav state, webContents actions, zoom) for the clicked tab.
 */
export type ContextMenuBaseDeps = Omit<
  ContextMenuDeps,
  | 'canGoBack'
  | 'canGoForward'
  | 'edit'
  | 'replaceMisspelling'
  | 'addToDictionary'
  | 'copyImageAt'
  | 'saveUrl'
  | 'zoom'
  | 'zoomPercent'
>;

const SEP: MenuItemConstructorOptions = { type: 'separator' };
const MAX_SPELLING_SUGGESTIONS = 5;

/** Collapse whitespace then truncate to 30 chars + ellipsis. */
function truncateForLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 30) return collapsed;
  return collapsed.slice(0, 30) + '…';
}

export function buildContextMenuTemplate(
  params: ContextMenuParams,
  deps: ContextMenuDeps,
  currentTabUrl: string,
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];

  // ── Spelling ──────────────────────────────────────────────────────────────
  const misspelled = params.misspelledWord ?? '';
  if (misspelled !== '') {
    const suggestions = (params.dictionarySuggestions ?? []).slice(0, MAX_SPELLING_SUGGESTIONS);
    if (suggestions.length === 0) {
      out.push({ label: 'No spelling suggestions', enabled: false });
    } else {
      for (const s of suggestions) {
        out.push({ label: s, click: () => deps.replaceMisspelling(s) });
      }
    }
    out.push({ label: 'Add to dictionary', click: () => deps.addToDictionary(misspelled) }, SEP);
  }

  // ── Editable field: edit commands only ────────────────────────────────────
  if (params.isEditable) {
    const f = params.editFlags ?? ({} as Partial<ContextMenuParams['editFlags']>);
    out.push(
      { label: 'Undo', enabled: f.canUndo ?? true, click: () => deps.edit('undo') },
      { label: 'Redo', enabled: f.canRedo ?? true, click: () => deps.edit('redo') },
      SEP,
      { label: 'Cut', enabled: f.canCut ?? true, click: () => deps.edit('cut') },
      { label: 'Copy', enabled: f.canCopy ?? true, click: () => deps.edit('copy') },
      { label: 'Paste', enabled: f.canPaste ?? true, click: () => deps.edit('paste') },
      {
        label: 'Paste as plain text',
        enabled: f.canPaste ?? true,
        click: () => deps.edit('pasteAndMatchStyle'),
      },
      { label: 'Select all', enabled: f.canSelectAll ?? true, click: () => deps.edit('selectAll') },
    );
    return out;
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  const selection = params.selectionText ?? '';
  if (selection.trim() !== '') {
    out.push(
      { label: 'Copy', click: () => deps.copyToClipboard(selection) },
      {
        label: `Search ${deps.activeSearchEngineName} for "${truncateForLabel(selection)}"`,
        click: () => deps.searchSelection(selection),
      },
      SEP,
    );
  }

  // ── Image ─────────────────────────────────────────────────────────────────
  const src = params.srcURL ?? '';
  if (params.mediaType === 'image' && src !== '') {
    // data: / blob: sources can't be opened as a tab (sanitized to blank)
    // and make a useless "address"; copy / save still work.
    const http = /^https?:/i.test(src);
    if (http) out.push({ label: 'Open image in new tab', click: () => deps.openInNewTab(src) });
    out.push({ label: 'Copy image', click: () => deps.copyImageAt(params.x, params.y) });
    if (http) out.push({ label: 'Copy image address', click: () => deps.copyToClipboard(src) });
    out.push({ label: 'Save image…', click: () => deps.saveUrl(src) }, SEP);
  }

  // ── Link ──────────────────────────────────────────────────────────────────
  const linkURL = params.linkURL ?? '';
  if (linkURL !== '') {
    out.push(
      { label: 'Open link in new tab', click: () => deps.openInNewTab(linkURL) },
      { label: 'Open link in system browser', click: () => deps.openInSystemBrowser(linkURL) },
      { label: 'Copy link address', click: () => deps.copyToClipboard(linkURL) },
      SEP,
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  out.push(
    { label: 'Back', enabled: deps.canGoBack, click: () => deps.navigateActive('back') },
    { label: 'Forward', enabled: deps.canGoForward, click: () => deps.navigateActive('forward') },
    { label: 'Reload', click: () => deps.navigateActive('reload') },
    SEP,
    { label: 'Zoom in', click: () => deps.zoom('in') },
    { label: 'Zoom out', click: () => deps.zoom('out') },
    {
      label: `Reset zoom (${deps.zoomPercent}%)`,
      enabled: deps.zoomPercent !== 100,
      click: () => deps.zoom('reset'),
    },
    SEP,
    { label: 'Open page in system browser', click: () => deps.openInSystemBrowser(currentTabUrl) },
    { label: 'Copy page URL', click: () => deps.copyToClipboard(currentTabUrl) },
    SEP,
    { label: 'View source', click: () => deps.viewSource(currentTabUrl) },
  );

  return out;
}
