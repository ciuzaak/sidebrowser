import { describe, it, expect } from 'vitest';
import { DEFAULTS } from '../../src/main/settings';
import { MOBILE_UA } from '../../src/main/user-agents';

describe('DEFAULTS', () => {
  it('has correct spec §7 default values for dim and mouseLeave', () => {
    // mouseLeave
    expect(DEFAULTS.mouseLeave.delayMs).toBe(100);

    // dim
    expect(DEFAULTS.dim.effect).toBe('blur');
    expect(DEFAULTS.dim.blurPx).toBe(8);
    expect(DEFAULTS.dim.darkBrightness).toBe(0.3);
    expect(DEFAULTS.dim.lightBrightness).toBe(1.5);
    expect(DEFAULTS.dim.transitionMs).toBe(150);
  });

  it('has correct spec §7 default values for window and edgeDock', () => {
    // window
    expect(DEFAULTS.window.width).toBe(393);
    expect(DEFAULTS.window.height).toBe(852);
    expect(DEFAULTS.window.preset).toBe('iphone14pro');
    expect(DEFAULTS.window.edgeThresholdPx).toBe(8);

    // edgeDock
    expect(DEFAULTS.edgeDock.enabled).toBe(true);
    expect(DEFAULTS.edgeDock.animationMs).toBe(200);
    expect(DEFAULTS.edgeDock.triggerStripPx).toBe(3);
  });

  it('has correct spec §7 default values for lifecycle and browsing', () => {
    // lifecycle
    expect(DEFAULTS.lifecycle.restoreTabsOnLaunch).toBe(true);

    // browsing — assert UA equals the imported constant so a future UA bump
    // doesn't silently break this test (and the test doesn't duplicate the
    // long UA string).
    expect(DEFAULTS.browsing.defaultIsMobile).toBe(true);
    expect(DEFAULTS.browsing.mobileUserAgent).toBe(MOBILE_UA);
  });
});
