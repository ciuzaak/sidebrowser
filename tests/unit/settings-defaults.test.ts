import { describe, it, expect } from 'vitest';
import { DEFAULTS } from '../../src/main/settings';

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
});
