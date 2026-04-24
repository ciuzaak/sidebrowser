/**
 * Settings DEFAULTS (spec §7).
 *
 * Type symbols (Settings, WindowSettings, etc.) live in `@shared/types` so
 * main, preload, and renderer can all import them. They are re-exported below
 * for back-compat with existing `from './settings'` imports.
 *
 * M6 will add a SettingsStore (electron-store + IPC) on top of these defaults.
 */

import type { Settings } from '@shared/types';
import { MOBILE_UA } from './user-agents';

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

export const DEFAULTS: Settings = {
  window: { width: 393, height: 852, preset: 'iphone14pro', edgeThresholdPx: 8 },
  mouseLeave: { delayMs: 100 },
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 1.5,
    transitionMs: 150,
  },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
  lifecycle: { restoreTabsOnLaunch: true },
  browsing: { defaultIsMobile: true, mobileUserAgent: MOBILE_UA },
  appearance: { theme: 'system' },
};
