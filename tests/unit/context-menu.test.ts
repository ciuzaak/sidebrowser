import { describe, it, expect, vi } from 'vitest';
import {
  buildContextMenuTemplate,
  type ContextMenuDeps,
} from '../../src/main/context-menu';

function makeDeps(overrides: Partial<ContextMenuDeps> = {}): ContextMenuDeps {
  return {
    openInSystemBrowser: vi.fn(),
    openInNewTab: vi.fn(),
    copyToClipboard: vi.fn(),
    searchSelection: vi.fn(),
    viewSource: vi.fn(),
    navigateActive: vi.fn(),
    canGoBack: true,
    canGoForward: true,
    activeSearchEngineName: 'Google',
    ...overrides,
  };
}

// Minimal ContextMenuParams stub — only the fields buildContextMenuTemplate reads.
function makeParams(
  overrides: Partial<{ linkURL: string; selectionText: string }> = {},
): Electron.ContextMenuParams {
  return {
    linkURL: '',
    selectionText: '',
    ...overrides,
  } as unknown as Electron.ContextMenuParams;
}

describe('buildContextMenuTemplate', () => {
  const URL = 'https://example.com/page';

  it('page-only: emits 8 entries (3 nav + sep + 2 page actions + sep + view source)', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const labels = tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));
    expect(labels).toEqual([
      '后退',
      '前进',
      '刷新',
      '---',
      '在系统浏览器打开此页',
      '复制此页 URL',
      '---',
      '查看源代码',
    ]);
  });

  it('page-only with !canGoBack disables 后退', () => {
    const deps = makeDeps({ canGoBack: false });
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const back = tpl.find((i) => i.label === '后退');
    expect(back?.enabled).toBe(false);
    const forward = tpl.find((i) => i.label === '前进');
    expect(forward?.enabled).toBe(true);
  });

  it('link present: prepends 3 link items + separator', () => {
    const deps = makeDeps();
    const linkURL = 'https://target.example/x';
    const tpl = buildContextMenuTemplate(makeParams({ linkURL }), deps, URL);
    const labels = tpl.slice(0, 4).map((i) => i.label ?? '---');
    expect(labels).toEqual([
      '在新标签页打开链接',
      '在系统浏览器打开链接',
      '复制链接地址',
      '---',
    ]);
    (tpl[0].click as () => void)();
    expect(deps.openInNewTab).toHaveBeenCalledWith(linkURL);
    (tpl[1].click as () => void)();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(linkURL);
    (tpl[2].click as () => void)();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(linkURL);
  });

  it('selection present: prepends 复制 + 用 {engine} 搜索 ... with truncation', () => {
    const deps = makeDeps({ activeSearchEngineName: 'Google' });
    const long = 'x'.repeat(45);
    const tpl = buildContextMenuTemplate(makeParams({ selectionText: long }), deps, URL);
    expect(tpl[0].label).toBe('复制');
    expect(tpl[1].label).toMatch(/^用 Google 搜索 "x{30}…"$/);
    expect(tpl[2].type).toBe('separator');
    (tpl[0].click as () => void)();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(long);
    (tpl[1].click as () => void)();
    expect(deps.searchSelection).toHaveBeenCalledWith(long);
  });

  it('selection collapses internal whitespace before truncating', () => {
    const deps = makeDeps();
    const noisy = '  foo\n\t  bar  baz  ';
    const tpl = buildContextMenuTemplate(makeParams({ selectionText: noisy }), deps, URL);
    expect(tpl[1].label).toBe('用 Google 搜索 "foo bar baz"');
  });

  it('link + selection: order is [复制, 搜索, sep, 链接3, sep, 页面...]', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(
      makeParams({ linkURL: 'https://l/', selectionText: 'q' }),
      deps,
      URL,
    );
    expect(tpl[0].label).toBe('复制');
    expect(tpl[1].label).toBe('用 Google 搜索 "q"');
    expect(tpl[2].type).toBe('separator');
    expect(tpl[3].label).toBe('在新标签页打开链接');
  });

  it('page-section navigation/view-source/copy/open clicks route to the right deps', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const byLabel = (l: string): import('electron').MenuItemConstructorOptions | undefined =>
      tpl.find((i) => i.label === l);
    (byLabel('后退')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('back');
    (byLabel('前进')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('forward');
    (byLabel('刷新')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('reload');
    (byLabel('在系统浏览器打开此页')!.click as () => void)();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(URL);
    (byLabel('复制此页 URL')!.click as () => void)();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(URL);
    (byLabel('查看源代码')!.click as () => void)();
    expect(deps.viewSource).toHaveBeenCalledWith(URL);
  });

  it('is pure: building does not invoke any deps callbacks', () => {
    const deps = makeDeps();
    buildContextMenuTemplate(makeParams({ linkURL: 'x', selectionText: 'y' }), deps, URL);
    expect(deps.openInSystemBrowser).not.toHaveBeenCalled();
    expect(deps.openInNewTab).not.toHaveBeenCalled();
    expect(deps.copyToClipboard).not.toHaveBeenCalled();
    expect(deps.searchSelection).not.toHaveBeenCalled();
    expect(deps.viewSource).not.toHaveBeenCalled();
    expect(deps.navigateActive).not.toHaveBeenCalled();
  });
});
