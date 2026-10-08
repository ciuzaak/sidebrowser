import { describe, it, expect, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
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
    edit: vi.fn(),
    replaceMisspelling: vi.fn(),
    addToDictionary: vi.fn(),
    copyImageAt: vi.fn(),
    saveUrl: vi.fn(),
    zoom: vi.fn(),
    zoomPercent: 100,
    ...overrides,
  };
}

// Minimal ContextMenuParams stub — only the fields buildContextMenuTemplate reads.
function makeParams(
  overrides: Partial<{
    linkURL: string;
    selectionText: string;
    isEditable: boolean;
    editFlags: Partial<Electron.EditFlags>;
    misspelledWord: string;
    dictionarySuggestions: string[];
    mediaType: string;
    srcURL: string;
    x: number;
    y: number;
  }> = {},
): Electron.ContextMenuParams {
  return {
    linkURL: '',
    selectionText: '',
    ...overrides,
  } as unknown as Electron.ContextMenuParams;
}

describe('buildContextMenuTemplate', () => {
  const URL = 'https://example.com/page';

  it('page-only: nav + zoom + page actions + view source', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const labels = tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));
    expect(labels).toEqual([
      'Back',
      'Forward',
      'Reload',
      '---',
      'Zoom in',
      'Zoom out',
      'Reset zoom (100%)',
      '---',
      'Open page in system browser',
      'Copy page URL',
      '---',
      'View source',
    ]);
  });

  it('page-only with !canGoBack disables Back', () => {
    const deps = makeDeps({ canGoBack: false });
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const back = tpl.find((i) => i.label === 'Back');
    expect(back?.enabled).toBe(false);
    const forward = tpl.find((i) => i.label === 'Forward');
    expect(forward?.enabled).toBe(true);
  });

  it('link present: prepends 3 link items + separator', () => {
    const deps = makeDeps();
    const linkURL = 'https://target.example/x';
    const tpl = buildContextMenuTemplate(makeParams({ linkURL }), deps, URL);
    const labels = tpl.slice(0, 4).map((i) => i.label ?? '---');
    expect(labels).toEqual([
      'Open link in new tab',
      'Open link in system browser',
      'Copy link address',
      '---',
    ]);
    (tpl[0].click as () => void)();
    expect(deps.openInNewTab).toHaveBeenCalledWith(linkURL);
    (tpl[1].click as () => void)();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(linkURL);
    (tpl[2].click as () => void)();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(linkURL);
  });

  it('selection present: prepends Copy + Search {engine} for ... with truncation', () => {
    const deps = makeDeps({ activeSearchEngineName: 'Google' });
    const long = 'x'.repeat(45);
    const tpl = buildContextMenuTemplate(makeParams({ selectionText: long }), deps, URL);
    expect(tpl[0].label).toBe('Copy');
    expect(tpl[1].label).toMatch(/^Search Google for "x{30}…"$/);
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
    expect(tpl[1].label).toBe('Search Google for "foo bar baz"');
  });

  it('link + selection: order is [Copy, Search, sep, link items, sep, page items]', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(
      makeParams({ linkURL: 'https://l/', selectionText: 'q' }),
      deps,
      URL,
    );
    expect(tpl[0].label).toBe('Copy');
    expect(tpl[1].label).toBe('Search Google for "q"');
    expect(tpl[2].type).toBe('separator');
    expect(tpl[3].label).toBe('Open link in new tab');
  });

  it('page-section navigation/view-source/copy/open clicks route to the right deps', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const byLabel = (l: string): MenuItemConstructorOptions | undefined =>
      tpl.find((i) => i.label === l);
    (byLabel('Back')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('back');
    (byLabel('Forward')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('forward');
    (byLabel('Reload')!.click as () => void)();
    expect(deps.navigateActive).toHaveBeenCalledWith('reload');
    (byLabel('Open page in system browser')!.click as () => void)();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(URL);
    (byLabel('Copy page URL')!.click as () => void)();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(URL);
    (byLabel('View source')!.click as () => void)();
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

describe('buildContextMenuTemplate — M16 tiers', () => {
  const URL = 'https://example.com/page';
  const labelsOf = (tpl: MenuItemConstructorOptions[]): string[] =>
    tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));

  it('editable field: only edit commands, enabled per editFlags', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(
      makeParams({ isEditable: true, editFlags: { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }),
      deps,
      URL,
    );
    expect(labelsOf(tpl)).toEqual(['Undo', 'Redo', '---', 'Cut', 'Copy', 'Paste', 'Paste as plain text', 'Select all']);
    expect(tpl[0]!.enabled).toBe(false);
    (tpl.find((i) => i.label === 'Paste')!.click as () => void)();
    expect(deps.edit).toHaveBeenCalledWith('paste');
    (tpl.find((i) => i.label === 'Paste as plain text')!.click as () => void)();
    expect(deps.edit).toHaveBeenCalledWith('pasteAndMatchStyle');
  });

  it('misspelled word: suggestions (max 5) + Add to dictionary before edit commands', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(
      makeParams({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello', 'help', 'helm', 'hero', 'halo', 'hole'] }),
      deps,
      URL,
    );
    expect(labelsOf(tpl).slice(0, 8)).toEqual(['hello', 'help', 'helm', 'hero', 'halo', 'Add to dictionary', '---', 'Undo']);
    (tpl[0]!.click as () => void)();
    expect(deps.replaceMisspelling).toHaveBeenCalledWith('hello');
    (tpl[5]!.click as () => void)();
    expect(deps.addToDictionary).toHaveBeenCalledWith('helo');
  });

  it('misspelled word without suggestions shows a disabled hint', () => {
    const tpl = buildContextMenuTemplate(makeParams({ isEditable: true, misspelledWord: 'qzx' }), makeDeps(), URL);
    expect(tpl[0]).toMatchObject({ label: 'No spelling suggestions', enabled: false });
  });

  it('image: open / copy / copy address / save, then page items', () => {
    const deps = makeDeps();
    const src = 'https://cdn.example/a.png';
    const tpl = buildContextMenuTemplate(makeParams({ mediaType: 'image', srcURL: src, x: 12, y: 34 }), deps, URL);
    expect(labelsOf(tpl).slice(0, 5)).toEqual(['Open image in new tab', 'Copy image', 'Copy image address', 'Save image…', '---']);
    (tpl[1]!.click as () => void)();
    expect(deps.copyImageAt).toHaveBeenCalledWith(12, 34);
    (tpl[3]!.click as () => void)();
    expect(deps.saveUrl).toHaveBeenCalledWith(src);
  });

  it('zoom items route to deps.zoom and show the current percent', () => {
    const deps = makeDeps({ zoomPercent: 120 });
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const reset = tpl.find((i) => i.label === 'Reset zoom (120%)')!;
    expect(reset.enabled).toBe(true);
    (reset.click as () => void)();
    expect(deps.zoom).toHaveBeenCalledWith('reset');
    (tpl.find((i) => i.label === 'Zoom in')!.click as () => void)();
    expect(deps.zoom).toHaveBeenCalledWith('in');
  });
});

