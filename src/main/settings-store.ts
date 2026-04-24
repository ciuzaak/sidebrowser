/**
 * SettingsStore — single source of truth for persisted Settings in the main
 * process. Wraps a pluggable backend (real `electron-store` in production;
 * in-memory fake in Node-only unit tests) and provides:
 *  - `get()` returns the current full Settings snapshot.
 *  - `update(patch)` clamps the patch through `clampSettings`, deep-merges
 *    it into the current state, persists via the backend, and notifies all
 *    `onChanged` listeners with the new full Settings.
 *  - `onChanged(cb)` subscribes to full-Settings change broadcasts; returns
 *    an unsubscribe closure.
 *
 * Design notes (see plan 2026-04-23-M6-settings-persistence Task 3):
 *  - Backend is injected to keep this module Node-only-test-safe. The real
 *    Electron backend factory lives at the bottom of the file and is the
 *    only thing that reaches for `electron-store`; the import is lazy so
 *    Vitest can import this module without an Electron context.
 *  - `fillMissingSections` runs once at construction to upgrade any persisted
 *    blob that predates a Settings section added in a newer version
 *    (e.g. an old config file that's missing `lifecycle`). It does not
 *    clamp — we trust the persisted state on load; `clampSettings` is the
 *    second line of defense for IPC-originated patches.
 *  - `mergeSettingsPatch` is a 2-level merge (root + per-section). The v1
 *    Settings schema is exactly two levels deep (`Settings[section][field]`);
 *    we intentionally avoid a recursive deepmerge so section semantics stay
 *    obvious (and so no future third-level object gets silently deep-merged
 *    without a matching design decision).
 *  - `update(undefined)` short-circuits to a no-op (no backend write, no
 *    listener broadcast). It's an error path — typed callers shouldn't pass
 *    undefined, but the runtime guard keeps malformed IPC from generating
 *    write/IPC traffic.
 */

import { createRequire } from 'node:module';
import type { Settings } from '@shared/types';
import { DEFAULTS } from './settings';
import { clampSettings, type SettingsPatch } from './clamp-settings';

export interface SettingsBackend {
  get(): Settings | undefined;
  set(value: Settings): void;
}

// ---------------------------------------------------------------------------
// Internal merge helpers
// ---------------------------------------------------------------------------

/**
 * Fill in any top-level Settings section missing from `persisted` with the
 * corresponding DEFAULTS. Sections present in `persisted` pass through as-is
 * — we do NOT field-level merge here (that's `update`'s job via
 * `clampSettings`). This only protects against upgrade scenarios where a new
 * version adds a whole section (e.g. `lifecycle` was added in M6) and the
 * on-disk blob predates it.
 */
function fillMissingSections(persisted: Partial<Settings>): Settings {
  return {
    window: persisted.window ?? DEFAULTS.window,
    mouseLeave: persisted.mouseLeave ?? DEFAULTS.mouseLeave,
    dim: persisted.dim ?? DEFAULTS.dim,
    edgeDock: persisted.edgeDock ?? DEFAULTS.edgeDock,
    lifecycle: persisted.lifecycle ?? DEFAULTS.lifecycle,
    browsing: persisted.browsing ?? DEFAULTS.browsing,
    appearance: persisted.appearance ?? DEFAULTS.appearance,
  };
}

/**
 * 2-level deep merge. For each section present in `patch`, produce a new
 * section object via `{ ...current[section], ...patch[section] }` so
 * untouched fields survive. Sections absent from `patch` pass through
 * by reference.
 *
 * Note: an empty patch section (e.g. `{ browsing: {} }` — see
 * clampSettings' empty-UA drop) is a no-op at the field level because
 * `Object.assign({a:1}, {}) === {a:1}`-equivalent. Handled implicitly.
 */
function mergeSettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  return {
    window: patch.window ? { ...current.window, ...patch.window } : current.window,
    mouseLeave: patch.mouseLeave
      ? { ...current.mouseLeave, ...patch.mouseLeave }
      : current.mouseLeave,
    dim: patch.dim ? { ...current.dim, ...patch.dim } : current.dim,
    edgeDock: patch.edgeDock
      ? { ...current.edgeDock, ...patch.edgeDock }
      : current.edgeDock,
    lifecycle: patch.lifecycle
      ? { ...current.lifecycle, ...patch.lifecycle }
      : current.lifecycle,
    browsing: patch.browsing
      ? { ...current.browsing, ...patch.browsing }
      : current.browsing,
    appearance: patch.appearance
      ? { ...current.appearance, ...patch.appearance }
      : current.appearance,
  };
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private settings: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly backend: SettingsBackend) {
    const persisted = backend.get();
    this.settings = persisted ? fillMissingSections(persisted) : DEFAULTS;
  }

  get(): Settings {
    return this.settings;
  }

  /**
   * Apply a settings patch: clamp, deep-merge, persist, broadcast.
   *
   * `undefined` short-circuits to a true no-op — no backend write, no
   * `onChanged` notification — because an undefined patch is an error path
   * (malformed IPC, no caller intent) and shouldn't generate write/IPC
   * traffic. The signature accepts `undefined` so strict-TS callers must
   * acknowledge the possibility.
   *
   * `update({})` is NOT short-circuited — an empty object is a deliberate
   * user-intent broadcast and must always fire (test 10 locks this).
   */
  update(partial: SettingsPatch | undefined): Settings {
    if (partial === undefined) return this.settings;
    const clamped = clampSettings(partial, this.settings);
    this.settings = mergeSettingsPatch(this.settings, clamped);
    this.backend.set(this.settings);
    for (const l of this.listeners) l(this.settings);
    return this.settings;
  }

  onChanged(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

// ---------------------------------------------------------------------------
// Electron backend factory
// ---------------------------------------------------------------------------

/**
 * Real backend — wraps `electron-store` under the `'settings'` key.
 *
 * The `electron-store` import is lazy (inside the factory body) on purpose:
 *  - `electron-store` reaches for `app.getPath('userData')` at construction,
 *    which throws outside an Electron context.
 *  - Vitest unit tests import this module (`settings-store.ts`) to exercise
 *    `SettingsStore` with `createFakeBackend()`. If the import were at top
 *    level, every unit test would need an Electron runtime.
 *
 * electron-store ≥10 is ESM-only and the package's exports shape uses a
 * default export. We use `createRequire(import.meta.url)` to bridge from
 * our ESM source into CJS at runtime (electron-vite bundles this file as
 * CJS for the main process, and handles `import.meta.url` correctly). The
 * `Store.default ?? Store` guard covers both default-export and namespaced
 * shapes across 8.x/10.x/11.x.
 *
 * Version note: repo uses `electron-store ^11.0.2` (current at 2026-04).
 */
export function createElectronBackend(): SettingsBackend {
  // The lazy boundary is the `requireCjs('electron-store')` call below —
  // `electron-store` reaches for `app.getPath('userData')` at construction,
  // which throws outside an Electron context. `createRequire` itself is a
  // pure node:module helper and safe to import at the top level.
  const requireCjs = createRequire(import.meta.url);
  //
  // M8 error-boundary hardening: wrap construction + get + set in try/catch so
  // a corrupt on-disk config JSON (or any electron-store runtime failure)
  // degrades to in-memory defaults instead of crashing the main-process
  // bootstrap. We do NOT delete the corrupt file — the next successful
  // `update()` will overwrite it naturally (electron-store ≥8 defaults
  // `clearInvalidConfig: true` and handles most parse errors internally; this
  // try/catch is a belt-and-suspenders guard and guarantees the DoD log line).
  //
  // `store === null` means construction failed: `get` returns undefined so
  // `SettingsStore` ctor falls back to DEFAULTS, and `set` is a no-op until
  // the file recovers on next launch.
  let store: ElectronStoreInstance | null = null;
  try {
    const StoreModule = requireCjs('electron-store') as
      | { default: new (opts?: unknown) => ElectronStoreInstance }
      | (new (opts?: unknown) => ElectronStoreInstance);
    const StoreCtor =
      typeof StoreModule === 'function'
        ? StoreModule
        : StoreModule.default;
    store = new StoreCtor({
      defaults: { settings: DEFAULTS },
    }) as ElectronStoreInstance;
  } catch (err) {
    console.error(
      '[sidebrowser] settings store construction failed; falling back to defaults',
      err,
    );
  }
  return {
    get: () => {
      if (!store) return undefined;
      try {
        return store.get('settings') as Settings | undefined;
      } catch (err) {
        console.error(
          '[sidebrowser] settings corrupt; falling back to defaults',
          err,
        );
        return undefined;
      }
    },
    set: (value: Settings) => {
      if (!store) return;
      try {
        store.set('settings', value);
      } catch (err) {
        console.error('[sidebrowser] settings write failed', err);
      }
    },
  };
}

/**
 * Minimal structural type for the slice of `electron-store` we actually use.
 * Avoids pulling electron-store's type surface into module scope (which
 * would force a transitive `conf`/`type-fest` import at module load — the
 * whole point of the lazy factory).
 */
interface ElectronStoreInstance {
  get(key: 'settings'): Settings | undefined;
  set(key: 'settings', value: Settings): void;
}
