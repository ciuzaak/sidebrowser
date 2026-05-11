/**
 * context-menu.ts — Pure builder for the web context-menu template (M13).
 *
 * Three context tiers stack top-to-bottom: selection block (if any selection
 * text) → link block (if right-clicked element has a link URL) → page block
 * (always). Each block ends with its own separator before the next block.
 *
 * Like keyboard-shortcuts.ts this is type-only on `electron` — no runtime
 * import — so vitest can build the template without spinning up an Electron
 * runtime. The actual `Menu.buildFromTemplate` + `popup` happens in
 * view-manager's context-menu handler.
 */

import type { MenuItemConstructorOptions, ContextMenuParams } from 'electron';

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
}

const SEP: MenuItemConstructorOptions = { type: 'separator' };

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

  const linkURL = params.linkURL ?? '';
  if (linkURL !== '') {
    out.push(
      { label: 'Open link in new tab', click: () => deps.openInNewTab(linkURL) },
      { label: 'Open link in system browser', click: () => deps.openInSystemBrowser(linkURL) },
      { label: 'Copy link address', click: () => deps.copyToClipboard(linkURL) },
      SEP,
    );
  }

  out.push(
    { label: 'Back', enabled: deps.canGoBack, click: () => deps.navigateActive('back') },
    { label: 'Forward', enabled: deps.canGoForward, click: () => deps.navigateActive('forward') },
    { label: 'Reload', click: () => deps.navigateActive('reload') },
    SEP,
    { label: 'Open page in system browser', click: () => deps.openInSystemBrowser(currentTabUrl) },
    { label: 'Copy page URL', click: () => deps.copyToClipboard(currentTabUrl) },
    SEP,
    { label: 'View source', click: () => deps.viewSource(currentTabUrl) },
  );

  return out;
}
