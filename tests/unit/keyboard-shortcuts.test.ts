import { describe, it, expect, vi } from 'vitest';
import {
  buildShortcutMenuTemplate,
  type ShortcutDeps,
} from '../../src/main/keyboard-shortcuts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): ShortcutDeps & {
  spies: {
    onNewTab: ReturnType<typeof vi.fn>;
    onCloseActiveTab: ReturnType<typeof vi.fn>;
    onReloadActive: ReturnType<typeof vi.fn>;
    onGoBack: ReturnType<typeof vi.fn>;
    onGoForward: ReturnType<typeof vi.fn>;
    onToggleDevTools: ReturnType<typeof vi.fn>;
    onResetZoom: ReturnType<typeof vi.fn>;
    emitToRenderer: ReturnType<typeof vi.fn>;
  };
} {
  const onNewTab = vi.fn();
  const onCloseActiveTab = vi.fn();
  const onReloadActive = vi.fn();
  const onGoBack = vi.fn();
  const onGoForward = vi.fn();
  const onToggleDevTools = vi.fn();
  const onResetZoom = vi.fn();
  const emitToRenderer = vi.fn();
  return {
    onNewTab,
    onCloseActiveTab,
    onReloadActive,
    onGoBack,
    onGoForward,
    onToggleDevTools,
    onResetZoom,
    emitToRenderer,
    spies: {
      onNewTab,
      onCloseActiveTab,
      onReloadActive,
      onGoBack,
      onGoForward,
      onToggleDevTools,
      onResetZoom,
      emitToRenderer,
    },
  };
}

/**
 * The template's top-level item has a submenu whose type (per Electron) is
 * `MenuItemConstructorOptions[] | Menu`. Unit tests always build with the
 * array form; this helper narrows + asserts that for callers.
 */
function getSubmenu(
  template: ReturnType<typeof buildShortcutMenuTemplate>,
): Array<{
  label?: string;
  accelerator?: string;
  click?: () => void;
}> {
  const top = template[0];
  expect(top).toBeDefined();
  expect(Array.isArray(top.submenu)).toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return top.submenu as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildShortcutMenuTemplate', () => {
  // ── Test 1: Structure ─────────────────────────────────────────────────────
  it('returns exactly one hidden top-level item with 11 submenu entries', () => {
    // Spec §15 defines 9 logical shortcuts. The menu template has 11 physical
    // entries because:
    //  - Ctrl+R and F5 are two separate items that share onReloadActive
    //    (Electron cannot accept OR-accelerators on a single item).
    //  - F12 DevTools is included (listed in the spec §15 table).
    const deps = makeDeps();
    const template = buildShortcutMenuTemplate(deps);
    expect(template).toHaveLength(1);

    const top = template[0];
    expect(top.visible).toBe(false);

    const submenu = getSubmenu(template);
    expect(submenu).toHaveLength(11);
  });

  // ── Test 2: Accelerators ──────────────────────────────────────────────────
  it('assigns the expected accelerator to each submenu item', () => {
    const deps = makeDeps();
    const submenu = getSubmenu(buildShortcutMenuTemplate(deps));

    // [labelSubstring, expectedAccelerator] — labelSubstring chosen to disambiguate
    // the two Reload items (the F5 variant's label includes "F5").
    const expected: Array<[string, string]> = [
      ['New Tab', 'CmdOrCtrl+T'],
      ['Close Tab', 'CmdOrCtrl+W'],
      ['Focus Address Bar', 'CmdOrCtrl+L'],
      ['Reload', 'CmdOrCtrl+R'],
      ['Reload (F5)', 'F5'],
      ['Back', 'Alt+Left'],
      ['Forward', 'Alt+Right'],
      ['Toggle Tab Drawer', 'CmdOrCtrl+Tab'],
      ['Toggle Settings', 'CmdOrCtrl+,'],
      ['Reset Zoom', 'CmdOrCtrl+0'],
      ['Toggle DevTools', 'F12'],
    ];
    expect(submenu).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const [labelSub, accel] = expected[i];
      expect(submenu[i].label, `submenu[${i}].label`).toContain(labelSub);
      expect(submenu[i].accelerator, `submenu[${i}].accelerator`).toBe(accel);
    }
  });

  // ── Test 3: Direct handler routing ────────────────────────────────────────
  it('routes each direct-handler click to the matching deps callback', () => {
    const deps = makeDeps();
    const submenu = getSubmenu(buildShortcutMenuTemplate(deps));

    // Map: index → which spy should have been called after invoking .click().
    // Note both Reload entries (index 3 and 4) route to onReloadActive.
    const directCases: Array<[number, keyof typeof deps.spies]> = [
      [0, 'onNewTab'],
      [1, 'onCloseActiveTab'],
      [3, 'onReloadActive'],
      [4, 'onReloadActive'],
      [5, 'onGoBack'],
      [6, 'onGoForward'],
      [9, 'onResetZoom'],
      [10, 'onToggleDevTools'],
    ];
    for (const [idx] of directCases) {
      const item = submenu[idx];
      expect(typeof item.click, `submenu[${idx}].click typeof`).toBe('function');
      item.click!();
    }

    expect(deps.spies.onNewTab).toHaveBeenCalledTimes(1);
    expect(deps.spies.onCloseActiveTab).toHaveBeenCalledTimes(1);
    expect(deps.spies.onReloadActive).toHaveBeenCalledTimes(2); // Ctrl+R + F5
    expect(deps.spies.onGoBack).toHaveBeenCalledTimes(1);
    expect(deps.spies.onGoForward).toHaveBeenCalledTimes(1);
    expect(deps.spies.onResetZoom).toHaveBeenCalledTimes(1);
    expect(deps.spies.onToggleDevTools).toHaveBeenCalledTimes(1);
  });

  // ── Test 4: emitToRenderer routing ────────────────────────────────────────
  it('forwards the three renderer-bound actions through emitToRenderer', () => {
    const deps = makeDeps();
    const submenu = getSubmenu(buildShortcutMenuTemplate(deps));

    // [index, expectedAction]
    const emitCases: Array<[number, 'focus-address-bar' | 'toggle-tab-drawer' | 'toggle-settings-drawer']> = [
      [2, 'focus-address-bar'],
      [7, 'toggle-tab-drawer'],
      [8, 'toggle-settings-drawer'],
    ];
    for (const [idx, action] of emitCases) {
      const item = submenu[idx];
      expect(typeof item.click, `submenu[${idx}].click typeof`).toBe('function');
      item.click!();
      expect(deps.spies.emitToRenderer).toHaveBeenCalledWith(action);
    }
    expect(deps.spies.emitToRenderer).toHaveBeenCalledTimes(3);

    // None of the direct-handler spies should fire for the emit-to-renderer
    // entries.
    expect(deps.spies.onNewTab).not.toHaveBeenCalled();
    expect(deps.spies.onCloseActiveTab).not.toHaveBeenCalled();
    expect(deps.spies.onReloadActive).not.toHaveBeenCalled();
    expect(deps.spies.onGoBack).not.toHaveBeenCalled();
    expect(deps.spies.onGoForward).not.toHaveBeenCalled();
    expect(deps.spies.onResetZoom).not.toHaveBeenCalled();
    expect(deps.spies.onToggleDevTools).not.toHaveBeenCalled();
  });

  // ── Test 5: Purity — calling build does not invoke any deps ───────────────
  it('is pure: building the template does not invoke any deps callbacks', () => {
    const deps = makeDeps();
    buildShortcutMenuTemplate(deps);
    expect(deps.spies.onNewTab).not.toHaveBeenCalled();
    expect(deps.spies.onCloseActiveTab).not.toHaveBeenCalled();
    expect(deps.spies.onReloadActive).not.toHaveBeenCalled();
    expect(deps.spies.onGoBack).not.toHaveBeenCalled();
    expect(deps.spies.onGoForward).not.toHaveBeenCalled();
    expect(deps.spies.onToggleDevTools).not.toHaveBeenCalled();
    expect(deps.spies.onResetZoom).not.toHaveBeenCalled();
    expect(deps.spies.emitToRenderer).not.toHaveBeenCalled();
  });
});
