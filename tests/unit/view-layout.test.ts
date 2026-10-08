import { describe, it, expect } from 'vitest';
import { computeViewLayout } from '../../src/main/view-layout';

const base = {
  contentWidth: 393,
  contentHeight: 852,
  chromeHeightPx: 36,
  topInsetPx: 0,
  suppressed: false,
  isActive: true,
  windowHidden: false,
  fullscreen: false,
};

const PAGE = { x: 0, y: 36, width: 393, height: 816 };

describe('computeViewLayout', () => {
  it('active tab fills the area below the chrome', () => {
    expect(computeViewLayout(base)).toEqual({ bounds: PAGE, visible: true });
  });

  it('top inset offsets y but keeps height (view clipped, never resized)', () => {
    expect(computeViewLayout({ ...base, topInsetPx: 120 })).toEqual({
      bounds: { x: 0, y: 156, width: 393, height: 816 },
      visible: true,
    });
  });

  it('suppressed active tab keeps its bounds and is hidden', () => {
    expect(computeViewLayout({ ...base, suppressed: true })).toEqual({ bounds: PAGE, visible: false });
  });

  it('window hidden at the edge hides the active tab, bounds kept', () => {
    expect(computeViewLayout({ ...base, windowHidden: true })).toEqual({ bounds: PAGE, visible: false });
  });

  it('background tab keeps page bounds (no resize on switch) and is hidden', () => {
    const r = { bounds: PAGE, visible: false };
    expect(computeViewLayout({ ...base, isActive: false })).toEqual(r);
    expect(computeViewLayout({ ...base, isActive: false, topInsetPx: 120 })).toEqual(r);
    expect(computeViewLayout({ ...base, isActive: false, fullscreen: true })).toEqual(r);
  });

  it('fullscreen active tab covers the chrome and ignores the inset', () => {
    expect(computeViewLayout({ ...base, fullscreen: true, topInsetPx: 120 })).toEqual({
      bounds: { x: 0, y: 0, width: 393, height: 852 },
      visible: true,
    });
    expect(computeViewLayout({ ...base, fullscreen: true, windowHidden: true }).visible).toBe(false);
  });

  it('clamps negative sizes to zero', () => {
    const r = computeViewLayout({ ...base, contentWidth: -5, contentHeight: 10, chromeHeightPx: 36 });
    expect(r.bounds.width).toBe(0);
    expect(r.bounds.height).toBe(0);
  });
});
