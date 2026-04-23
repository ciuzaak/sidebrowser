/**
 * Settings types and defaults (spec §7).
 * This is a stub for M4: only dim + mouseLeave sections.
 * M6 will replace DEFAULTS with getSettings() backed by electron-store + IPC.
 */

export interface DimSettings {
  effect: 'dark' | 'light' | 'blur' | 'none';
  blurPx: number;           // 0–40
  darkBrightness: number;   // 0–1
  lightBrightness: number;  // 1–3
  transitionMs: number;     // 0–1000
}

export interface MouseLeaveSettings {
  delayMs: number;          // 0–2000
}

export interface Settings {
  dim: DimSettings;
  mouseLeave: MouseLeaveSettings;
}

export const DEFAULTS: Settings = {
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 1.5,
    transitionMs: 150,
  },
  mouseLeave: {
    delayMs: 100,
  },
};
