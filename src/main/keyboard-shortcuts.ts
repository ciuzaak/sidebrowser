/**
 * keyboard-shortcuts.ts — Spec §15 hidden Application Menu for M8.
 *
 * The v1 spec explicitly forbids `globalShortcut` (would fire even when the
 * app isn't focused). Instead we register a `Menu.setApplicationMenu` whose
 * single top-level item is `visible: false` — Electron still honours the
 * accelerators on its submenu items while the menubar itself is not rendered.
 *
 * Two exports:
 *
 *   - `buildShortcutMenuTemplate(deps)` — pure; returns a
 *     `MenuItemConstructorOptions[]` derived solely from `deps`. No Electron
 *     runtime import happens at call time (the `MenuItemConstructorOptions`
 *     reference is a type-only import). Fully unit-testable.
 *
 *   - `installApplicationMenu(deps)` — runtime wrapper. Builds the template
 *     via the pure function, feeds it through `Menu.buildFromTemplate`, and
 *     calls `Menu.setApplicationMenu`. Must be invoked exactly once, inside
 *     `app.whenReady()` — `setApplicationMenu` is app-wide, not per-window.
 *
 * Spec §15 lists 9 *logical* shortcut rows but the template has **11 physical
 * entries**:
 *
 *   - Ctrl+R and F5 both map to `onReloadActive` but must be two separate
 *     menu items because Electron cannot accept OR-accelerators on a single
 *     item.
 *   - F12 (Toggle DevTools) is listed on its own row and so counts as the
 *     ninth logical shortcut and the eleventh physical entry.
 *
 * The `CmdOrCtrl` prefix (as opposed to raw `Ctrl`) is the standard Electron
 * idiom. v1 ships Windows-only but the convention keeps a future macOS port
 * trivial and matches the guidance in the M8 plan.
 */

import type { MenuItemConstructorOptions } from 'electron';
import { createRequire } from 'node:module';
import type { ShortcutAction } from '@shared/ipc-contract';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ShortcutDeps {
  /** Ctrl+T — opens a new blank tab. */
  onNewTab: () => void;
  /** Ctrl+W — closes the active tab (ViewManager auto-seeds a blank when empty). */
  onCloseActiveTab: () => void;
  /** Ctrl+R / F5 — reloads the active tab. */
  onReloadActive: () => void;
  /** Alt+Left — back in the active tab's navigation history. */
  onGoBack: () => void;
  /** Alt+Right — forward in the active tab's navigation history. */
  onGoForward: () => void;
  /** F12 — toggles the active tab's DevTools. */
  onToggleDevTools: () => void;
  /** Ctrl+0 — resets the active tab's zoom to 100%. */
  onResetZoom: () => void;
  /** Fires a spec §15 renderer-bound action (address-bar focus, drawer toggles). */
  emitToRenderer: (action: ShortcutAction) => void;
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

export function buildShortcutMenuTemplate(deps: ShortcutDeps): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [
    { label: 'New Tab',           accelerator: 'CmdOrCtrl+T',   click: () => deps.onNewTab() },
    { label: 'Close Tab',         accelerator: 'CmdOrCtrl+W',   click: () => deps.onCloseActiveTab() },
    { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L',   click: () => deps.emitToRenderer('focus-address-bar') },
    { label: 'Reload',            accelerator: 'CmdOrCtrl+R',   click: () => deps.onReloadActive() },
    { label: 'Reload (F5)',       accelerator: 'F5',            click: () => deps.onReloadActive() },
    { label: 'Back',              accelerator: 'Alt+Left',      click: () => deps.onGoBack() },
    { label: 'Forward',           accelerator: 'Alt+Right',     click: () => deps.onGoForward() },
    { label: 'Toggle Tab Drawer', accelerator: 'CmdOrCtrl+Tab', click: () => deps.emitToRenderer('toggle-tab-drawer') },
    { label: 'Toggle Settings',   accelerator: 'CmdOrCtrl+,',   click: () => deps.emitToRenderer('toggle-settings-drawer') },
    { label: 'Reset Zoom',        accelerator: 'CmdOrCtrl+0',   click: () => deps.onResetZoom() },
    { label: 'Toggle DevTools',   accelerator: 'F12',           click: () => deps.onToggleDevTools() },
  ];

  return [
    {
      label: 'Shortcuts',
      visible: false,
      submenu,
    },
  ];
}

// ---------------------------------------------------------------------------
// Runtime install
// ---------------------------------------------------------------------------

/**
 * Runtime-only wrapper. Lazy-loads `electron` via `createRequire` so that
 * non-Electron contexts (e.g. Vitest importing the pure builder) don't
 * transitively pull in the `electron` module. Not unit-tested; exercised via
 * E2E when an accelerator fires.
 */
export function installApplicationMenu(deps: ShortcutDeps): void {
  const requireCjs = createRequire(import.meta.url);
  const { Menu } = requireCjs('electron') as {
    Menu: {
      buildFromTemplate(template: MenuItemConstructorOptions[]): Electron.Menu;
      setApplicationMenu(menu: Electron.Menu | null): void;
    };
  };
  const template = buildShortcutMenuTemplate(deps);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
