import { describe, it, expect } from 'vitest';
import { computeViewLayout } from '../../src/main/view-layout';

const base = {
  contentWidth: 393,
  contentHeight: 852,
  chromeHeightPx: 36,
  topInsetPx: 0,
  suppressed: false,
  isActive: true,
};

describe('computeViewLayout', () => {
  it('active tab fills the area below the chrome', () => {
    expect(computeViewLayout(base)).toEqual({
      bounds: { x: 0, y: 36, width: 393, height: 816 },
      visible: true,
    });
  });

  it('top inset offsets y but keeps height (view clipped, never resized)', () => {
    expect(computeViewLayout({ ...base, topInsetPx: 120 })).toEqual({
      bounds: { x: 0, y: 156, width: 393, height: 816 },
      visible: true,
    });
  });

  it('suppressed active tab keeps its bounds and is hidden', () => {
    expect(computeViewLayout({ ...base, suppressed: true })).toEqual({
      bounds: { x: 0, y: 36, width: 393, height: 816 },
      visible: false,
    });
  });

  it('background tab is zero-sized and visible regardless of suppression', () => {
    const zero = { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: true };
    expect(computeViewLayout({ ...base, isActive: false })).toEqual(zero);
    expect(computeViewLayout({ ...base, isActive: false, suppressed: true })).toEqual(zero);
  });

  it('clamps negative sizes to zero', () => {
    const r = computeViewLayout({ ...base, contentWidth: -5, contentHeight: 10, chromeHeightPx: 36 });
    expect(r.bounds.width).toBe(0);
    expect(r.bounds.height).toBe(0);
  });
});
