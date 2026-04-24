/**
 * Settings DEFAULTS (spec §7).
 *
 * Type symbols (Settings, WindowSettings, etc.) live in `@shared/types` so
 * main, preload, and renderer can all import them. They are re-exported below
 * for back-compat with existing `from './settings'` imports.
 *
 * DEFAULTS and MOBILE_UA now live in `@shared/settings-defaults` so the
 * renderer can import them without crossing the main/renderer boundary.
 * This file re-exports DEFAULTS for back-compat with main-side callers.
 */

// Back-compat re-exports so existing `import type { DimSettings } from './settings'`
// callers keep working without edits.
export type {
  WindowSettings,
  MouseLeaveSettings,
  DimSettings,
  EdgeDockSettings,
  LifecycleSettings,
  BrowsingSettings,
  AppearanceSettings,
  ThemeChoice,
  Settings,
} from '@shared/types';

export { DEFAULTS } from '@shared/settings-defaults';
