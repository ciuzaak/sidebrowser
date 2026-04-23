import { create } from 'zustand';
import type { Settings, SettingsPatch } from '@shared/types';

/**
 * Renderer-side settings slice.
 *
 * Hydration model: `settings` is `null` until the first main-side payload
 * arrives — either via the `app:ready` broadcast, the `settings:changed`
 * broadcast, or the explicit `getSettings` invoke issued by
 * `useSettingsBridge` on mount. Consumers (Task 10 SettingsDrawer) must
 * handle the `null` path (render nothing or a skeleton).
 *
 * `update(partial)` is NOT optimistic: it awaits main's authoritative
 * response before writing the store, so clamping / normalization
 * performed by `clampSettings` (e.g. preset changes overriding width /
 * height) never diverges from the UI. The broadcast-side
 * `settings:changed` handler wired in `useSettingsBridge` will also set
 * the same value — that's idempotent.
 */
interface SettingsSlice {
  /** null until first hydration (app:ready OR getSettings response). */
  settings: Settings | null;
  setSettings: (s: Settings) => void;
  /** Fire-and-forget update. Returns the resulting full Settings from main for optional chaining. */
  update: (partial: SettingsPatch) => Promise<Settings>;
}

export const useSettingsStore = create<SettingsSlice>((set) => ({
  settings: null,
  setSettings: (s) => set({ settings: s }),
  update: async (partial) => {
    const next = await window.sidebrowser.updateSettings(partial);
    set({ settings: next });
    return next;
  },
}));
