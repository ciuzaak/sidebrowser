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
      { label: '复制', click: () => deps.copyToClipboard(selection) },
      {
        label: `用 ${deps.activeSearchEngineName} 搜索 "${truncateForLabel(selection)}"`,
        click: () => deps.searchSelection(selection),
      },
      SEP,
    );
  }

  const linkURL = params.linkURL ?? '';
  if (linkURL !== '') {
    out.push(
      { label: '在新标签页打开链接', click: () => deps.openInNewTab(linkURL) },
      { label: '在系统浏览器打开链接', click: () => deps.openInSystemBrowser(linkURL) },
      { label: '复制链接地址', click: () => deps.copyToClipboard(linkURL) },
      SEP,
    );
  }

  out.push(
    { label: '后退', enabled: deps.canGoBack, click: () => deps.navigateActive('back') },
    { label: '前进', enabled: deps.canGoForward, click: () => deps.navigateActive('forward') },
    { label: '刷新', click: () => deps.navigateActive('reload') },
    SEP,
    { label: '在系统浏览器打开此页', click: () => deps.openInSystemBrowser(currentTabUrl) },
    { label: '复制此页 URL', click: () => deps.copyToClipboard(currentTabUrl) },
    SEP,
    { label: '查看源代码', click: () => deps.viewSource(currentTabUrl) },
  );

  return out;
}
