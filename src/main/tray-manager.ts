/**
 * tray-manager.ts — System-tray icon + menu for the M7 milestone.
 *
 * Exposes a `TrayManager` class that takes a pluggable `TrayBackend` so that
 * unit tests can run without an Electron context.  The real Electron backend
 * is provided by `createElectronTrayBackend()` at the bottom of this file;
 * the Electron import is lazy (inside the factory body) so that Vitest can
 * import `TrayManager` without triggering an Electron runtime load.
 */

import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TrayMenuTemplate {
  items: { label: string; onClick: () => void }[];
}

export interface TrayBackend {
  setImage(imagePath: string): void;
  setToolTip(tip: string): void;
  setContextMenu(template: TrayMenuTemplate): void;
  onClick(cb: () => void): void;
  destroy(): void;
}

export interface TrayManagerDeps {
  backend: TrayBackend;
  /** Absolute path to the tray icon image. */
  iconPath: string;
  /** Tooltip shown on hover. Defaults to 'sidebrowser'. */
  toolTip?: string;
  /** Called when the user left-clicks the tray icon OR clicks "Show". */
  onShow: () => void;
  /** Called when the user clicks "Quit". */
  onQuit: () => void;
}

// ---------------------------------------------------------------------------
// TrayManager
// ---------------------------------------------------------------------------

export class TrayManager {
  private readonly backend: TrayBackend;

  constructor(deps: TrayManagerDeps) {
    this.backend = deps.backend;

    this.backend.setImage(deps.iconPath);
    this.backend.setToolTip(deps.toolTip ?? 'sidebrowser');
    this.backend.setContextMenu({
      items: [
        { label: 'Show', onClick: deps.onShow },
        { label: 'Quit', onClick: deps.onQuit },
      ],
    });
    this.backend.onClick(deps.onShow);
  }

  destroy(): void {
    this.backend.destroy();
  }
}

// ---------------------------------------------------------------------------
// Electron backend factory
// ---------------------------------------------------------------------------

/**
 * Real backend — wraps the Electron `Tray` / `Menu` / `nativeImage` APIs.
 *
 * The `electron` import is lazy (inside the factory body) on purpose:
 *  - `Tray` must not be instantiated before `app.whenReady()` resolves.
 *  - Vitest unit tests import this module to exercise `TrayManager` via a
 *    fake backend.  If `electron` were imported at the top level the
 *    import-time side-effects would throw outside an Electron context.
 *
 * Uses the same `createRequire(import.meta.url)` pattern as
 * `createElectronBackend()` in `settings-store.ts`.
 */
/**
 * Minimal structural types for the Electron APIs this factory uses.
 * Avoids pulling the full Electron type surface into module scope (which
 * would force a transitive `electron` import at module load — the whole
 * point of the lazy factory).
 */
/** Opaque handle for a nativeImage instance — we only pass it around. */
type ElectronImage = object;
/** Opaque handle for a built Menu instance — we only pass it to setContextMenu. */
type ElectronMenuInstance = object;

interface ElectronNativeImage {
  createFromPath(path: string): ElectronImage;
}
interface ElectronTrayInstance {
  setImage(image: ElectronImage): void;
  setToolTip(tip: string): void;
  setContextMenu(menu: ElectronMenuInstance): void;
  on(event: 'click', cb: () => void): void;
  destroy(): void;
}
interface ElectronMenuCtor {
  buildFromTemplate(template: Array<{ label: string; click: () => void }>): ElectronMenuInstance;
}
interface ElectronTrayCtor {
  new (image: ElectronImage): ElectronTrayInstance;
}
interface ElectronModule {
  Tray: ElectronTrayCtor;
  Menu: ElectronMenuCtor;
  nativeImage: ElectronNativeImage;
}

export function createElectronTrayBackend(iconPath: string): TrayBackend {
  const requireCjs = createRequire(import.meta.url);
  const { Tray, Menu, nativeImage } = requireCjs('electron') as ElectronModule;

  const tray = new Tray(nativeImage.createFromPath(iconPath));

  return {
    setImage(imagePath: string): void {
      tray.setImage(nativeImage.createFromPath(imagePath));
    },

    setToolTip(tip: string): void {
      tray.setToolTip(tip);
    },

    setContextMenu(template: TrayMenuTemplate): void {
      const menu = Menu.buildFromTemplate(
        template.items.map((item) => ({
          label: item.label,
          click: item.onClick,
        })),
      );
      tray.setContextMenu(menu);
    },

    onClick(cb: () => void): void {
      tray.on('click', cb);
    },

    destroy(): void {
      tray.destroy();
    },
  };
}
