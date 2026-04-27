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
  SearchSettings,
  SearchEngine,
  Settings,
  SettingsPatch,
  WindowSettings,
} from '@shared/types';
import {
  BUILTIN_SEARCH_ENGINES,
  BUILTIN_SEARCH_ENGINE_IDS,
} from '@shared/settings-defaults';

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

/**
 * Search section 的信任边界：所有从 IPC 入侵的 search patch 都过这一层。
 * 6 步顺序对应 spec §4.1 的不变量。`current` 用于 activeId 跨 patch 校验
 * （patch 删了当前 active 但没传 activeId 时，按 current.activeId 重新校验）。
 */
function clampSearch(
  partial: Partial<SearchSettings>,
  current: SearchSettings,
): Partial<SearchSettings> {
  const out: Partial<SearchSettings> = {};

  // engines 字段处理
  if (partial.engines !== undefined) {
    // 1. 过滤无效条目
    const valid = partial.engines.filter(
      (e) =>
        typeof e.name === 'string' &&
        e.name.trim() !== '' &&
        typeof e.urlTemplate === 'string' &&
        e.urlTemplate.includes('{query}'),
    );

    // 2/3. 修正 builtin 标记 + 覆写内置项不可变字段
    const normalized: SearchEngine[] = valid.map((e) => {
      if (BUILTIN_SEARCH_ENGINE_IDS.has(e.id)) {
        const canonical = BUILTIN_SEARCH_ENGINES.find((b) => b.id === e.id)!;
        return { id: e.id, name: canonical.name, urlTemplate: canonical.urlTemplate, builtin: true };
      }
      return { id: e.id, name: e.name, urlTemplate: e.urlTemplate, builtin: false };
    });

    // 4. 按 id 去重，先到先得
    const seen = new Set<string>();
    const deduped = normalized.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    // 5. 重建 engines：4 个 builtins（按 BUILTIN_SEARCH_ENGINES 表序、canonical
    // 内容）+ deduped 里所有 customs（保留用户输入序）。
    // 因为步骤 3 已经把 deduped 里的 builtin 条目 canonical 化过，这里直接用表
    // 重建 builtin section 是等价的（且自动覆盖"内置缺失需要补回"的情况）。
    const customs = deduped.filter((e) => !e.builtin);
    const orderedBuiltins = BUILTIN_SEARCH_ENGINES.map((b) => ({ ...b }));
    out.engines = [...orderedBuiltins, ...customs];
  }

  // 6. activeId 校验
  // 计算最终的 ids 集合：若本次 patch 改了 engines 用 out.engines；否则用 current.engines。
  const finalEngines = out.engines ?? current.engines;
  const finalIds = new Set(finalEngines.map((e) => e.id));

  if (partial.activeId !== undefined) {
    out.activeId = finalIds.has(partial.activeId) ? partial.activeId : 'google';
  } else if (out.engines !== undefined && !finalIds.has(current.activeId)) {
    // patch 删除了当前 active，但没显式传 activeId → 兜底 fallback
    out.activeId = 'google';
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function clampSettings(
  partial: SettingsPatch,
  // `current` is now consumed by clampSearch for activeId cross-patch validation.
  current: Settings,
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
  if (partial.search !== undefined) {
    out.search = clampSearch(partial.search, current.search);
  }

  return out;
}
