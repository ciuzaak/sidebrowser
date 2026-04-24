/**
 * clampSettings — pure normalization of an inbound `Partial<Settings>` patch
 * before it is deep-merged into the persisted `Settings`. Spec §7 ranges +
 * preset behavior are the source of truth.
 *
 * Contract (see plan 2026-04-23-M6-settings-persistence Task 2):
 *  - Output is itself a `Partial<Settings>`. Sections absent from `partial`
 *    are absent from the output. Sections present but with no surviving
 *    fields are emitted as empty objects (`{}`) so caller policy stays
 *    explicit; the deep-merge in `SettingsStore.update()` treats those as
 *    no-ops.
 *  - Numeric fields are clamped to the spec §7 range; out-of-range values
 *    are silently snapped to the nearest endpoint rather than rejected.
 *  - Preset normalization (rule 2):
 *      * M9: any non-canonical preset (including legacy 'custom') is coerced
 *        to 'iphone14pro' with its canonical dims. width/height without preset
 *        is dropped.
 *      * preset present → overwrites width/height with the preset's canonical
 *        dimensions; wins over any width/height that may also be in the same
 *        partial.
 *  - `browsing.mobileUserAgent === ''` is dropped (empty string == "no
 *    change intent"); current value is preserved.
 *  - Booleans and string literal-unions pass through unchanged.
 *
 * Pure: no Electron imports, no I/O, no Date.now, no logging.
 *
 * Defensive note on `Partial<Settings>` semantics: section properties may
 * be `undefined` when callers spread sparsely. We treat `undefined` and
 * "key absent" identically by checking `partial.X === undefined`.
 */

import type {
  AppearanceSettings,
  BrowsingSettings,
  DimSettings,
  EdgeDockSettings,
  LifecycleSettings,
  MouseLeaveSettings,
  Settings,
  SettingsPatch,
  WindowSettings,
} from '@shared/types';

/**
 * `SettingsPatch` lives in `@shared/types` (moved in Task 4) because both the
 * shared IPC contract and the main process consume it, and the shared layer
 * must not import from `src/main/`. Re-export here so existing Task 2/3
 * imports (`from './clamp-settings'`) continue to resolve without source
 * changes elsewhere.
 */
export type { SettingsPatch };

// ---------------------------------------------------------------------------
// Internal constants & helpers
// ---------------------------------------------------------------------------

const PRESETS: Record<WindowSettings['preset'], { width: number; height: number }> = {
  iphone14pro: { width: 393, height: 852 },
  iphonese: { width: 375, height: 667 },
  pixel7: { width: 412, height: 915 },
};

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

// Per-section clampers. Each returns a `Partial<Section>` containing only
// the fields actually written by `partial`. They never inspect `current`
// except where rule 2 (preset coercion) requires reading defaults from
// `partial` itself — `current` is unused inside these helpers, by design.

function clampWindow(
  partial: Partial<WindowSettings>,
): Partial<WindowSettings> {
  const out: Partial<WindowSettings> = {};

  if (partial.preset !== undefined) {
    // M9 migration: old configs may carry preset='custom'; coerce to default.
    const isLegacyCustom = (partial.preset as string) === 'custom';
    if (isLegacyCustom) {
      console.info('[settings] migrating custom preset → iphone14pro');
    }
    const safePreset: WindowSettings['preset'] =
      isLegacyCustom ? 'iphone14pro' : (partial.preset as WindowSettings['preset']);
    const dims = PRESETS[safePreset];
    out.preset = safePreset;
    out.width = dims.width;
    out.height = dims.height;
  }
  // Width/height without preset → dropped (no longer a coerce trigger).

  if (partial.edgeThresholdPx !== undefined) {
    out.edgeThresholdPx = clamp(partial.edgeThresholdPx, 0, 50);
  }

  return out;
}

function clampMouseLeave(
  partial: Partial<MouseLeaveSettings>,
): Partial<MouseLeaveSettings> {
  const out: Partial<MouseLeaveSettings> = {};
  if (partial.delayMs !== undefined) {
    out.delayMs = clamp(partial.delayMs, 0, 2000);
  }
  return out;
}

function clampDim(partial: Partial<DimSettings>): Partial<DimSettings> {
  const out: Partial<DimSettings> = {};
  if (partial.effect !== undefined) out.effect = partial.effect;
  if (partial.blurPx !== undefined) {
    out.blurPx = clamp(partial.blurPx, 0, 40);
  }
  if (partial.darkBrightness !== undefined) {
    out.darkBrightness = clamp(partial.darkBrightness, 0, 1);
  }
  if (partial.lightBrightness !== undefined) {
    out.lightBrightness = clamp(partial.lightBrightness, 1, 3);
  }
  if (partial.transitionMs !== undefined) {
    out.transitionMs = clamp(partial.transitionMs, 0, 1000);
  }
  return out;
}

function clampEdgeDock(
  partial: Partial<EdgeDockSettings>,
): Partial<EdgeDockSettings> {
  const out: Partial<EdgeDockSettings> = {};
  if (partial.enabled !== undefined) out.enabled = partial.enabled;
  if (partial.animationMs !== undefined) {
    // Spec doesn't fix an upper bound; 1000ms is a protective cap (plan §Task 2).
    out.animationMs = clamp(partial.animationMs, 0, 1000);
  }
  if (partial.triggerStripPx !== undefined) {
    out.triggerStripPx = clamp(partial.triggerStripPx, 1, 10);
  }
  return out;
}

function clampLifecycle(
  partial: Partial<LifecycleSettings>,
): Partial<LifecycleSettings> {
  const out: Partial<LifecycleSettings> = {};
  if (partial.restoreTabsOnLaunch !== undefined) {
    out.restoreTabsOnLaunch = partial.restoreTabsOnLaunch;
  }
  return out;
}

function clampBrowsing(
  partial: Partial<BrowsingSettings>,
): Partial<BrowsingSettings> {
  const out: Partial<BrowsingSettings> = {};
  if (partial.defaultIsMobile !== undefined) {
    out.defaultIsMobile = partial.defaultIsMobile;
  }
  // Empty-string guard: drop the field so current is preserved.
  if (
    partial.mobileUserAgent !== undefined &&
    partial.mobileUserAgent !== ''
  ) {
    out.mobileUserAgent = partial.mobileUserAgent;
  }
  return out;
}

function clampAppearance(
  partial: Partial<AppearanceSettings>,
): Partial<AppearanceSettings> {
  const out: Partial<AppearanceSettings> = {};
  if (partial.theme !== undefined) {
    out.theme =
      partial.theme === 'dark' || partial.theme === 'light' || partial.theme === 'system'
        ? partial.theme
        : 'system';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function clampSettings(
  partial: SettingsPatch,
  // `current` is part of the public signature for forward compatibility (e.g.
  // future "diff against current to skip no-op writes" optimization). It is
  // currently unused — preset coercion only ever reads from `partial`. The
  // leading underscore opts out of `@typescript-eslint/no-unused-vars`.
  _current: Settings,
): SettingsPatch {
  const out: SettingsPatch = {};

  if (partial.window !== undefined) out.window = clampWindow(partial.window);
  if (partial.mouseLeave !== undefined) {
    out.mouseLeave = clampMouseLeave(partial.mouseLeave);
  }
  if (partial.dim !== undefined) out.dim = clampDim(partial.dim);
  if (partial.edgeDock !== undefined) {
    out.edgeDock = clampEdgeDock(partial.edgeDock);
  }
  if (partial.lifecycle !== undefined) {
    out.lifecycle = clampLifecycle(partial.lifecycle);
  }
  if (partial.browsing !== undefined) out.browsing = clampBrowsing(partial.browsing);
  if (partial.appearance !== undefined) {
    out.appearance = clampAppearance(partial.appearance);
  }

  return out;
}
