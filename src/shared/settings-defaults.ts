import type { Settings } from './types';

/**
 * iOS Safari UA. Kept in shared so both main (at DEFAULTS construction) and
 * renderer (for reset-to-default UI) can reference it without crossing the
 * main/renderer import boundary.
 */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

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
