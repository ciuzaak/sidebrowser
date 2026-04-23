/**
 * Settings types and defaults (spec §7).
 * This is a stub for M4/M5: dim + mouseLeave + window + edgeDock sections, rest deferred to M6.
 * M6 will replace DEFAULTS with getSettings() backed by electron-store + IPC.
 */

export interface WindowSettings {
  width: number;            // 393
  edgeThresholdPx: number;  // 8, 0–50
}

export interface EdgeDockSettings {
  enabled: boolean;         // true
  animationMs: number;      // 200, 0 = instant
  triggerStripPx: number;   // 3, 1–10
}

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
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
}

export const DEFAULTS: Settings = {
  window: { width: 393, edgeThresholdPx: 8 },
  mouseLeave: {
    delayMs: 100,
  },
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 1.5,
    transitionMs: 150,
  },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
};
