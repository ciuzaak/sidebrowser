import { describe, it, expect } from 'vitest';
import { computeDockedSide, interpolateX } from '../../src/main/edge-geometry';

describe('computeDockedSide', () => {
  it('left edge aligned exactly: bounds.x === workArea.x → left', () => {
    expect(computeDockedSide({ x: 0, width: 400 }, { x: 0, width: 1920 }, 8)).toBe('left');
  });

  it('right edge aligned exactly: bounds.x + bounds.width === workArea.x + workArea.width → right', () => {
    expect(computeDockedSide({ x: 1520, width: 400 }, { x: 0, width: 1920 }, 8)).toBe('right');
  });

  it('within threshold on left (diff === threshold) → left', () => {
    expect(computeDockedSide({ x: 8, width: 400 }, { x: 0, width: 1920 }, 8)).toBe('left');
  });

  it('within threshold on right (diff === threshold) → right', () => {
    // bounds.x + bounds.width = 1512 + 400 = 1912; workArea right = 1920; diff = 8
    expect(computeDockedSide({ x: 1512, width: 400 }, { x: 0, width: 1920 }, 8)).toBe('right');
  });

  it('just outside threshold on left (diff > threshold) → null', () => {
    // bounds.x = 9, workArea.x = 0, diff = 9 > edgeThresholdPx = 8; right diff also huge → null
    expect(computeDockedSide({ x: 9, width: 400 }, { x: 0, width: 1920 }, 8)).toBeNull();
  });

  it('both edges near but left wins (left check first)', () => {
    // Very narrow window where both edges fall within threshold=50:
    // workArea = { x: 0, width: 100 }; bounds = { x: 10, width: 80 }
    // left diff = |10 - 0| = 10 ≤ 50; right diff = |(10+80) - (0+100)| = |90-100| = 10 ≤ 50
    // left is checked first → 'left'
    expect(computeDockedSide({ x: 10, width: 80 }, { x: 0, width: 100 }, 50)).toBe('left');
  });

  it('negative workArea.x (multi-monitor left display): bounds.x === workArea.x → left', () => {
    expect(computeDockedSide({ x: -1920, width: 400 }, { x: -1920, width: 1920 }, 8)).toBe('left');
  });
});

describe('interpolateX', () => {
  it('progress=0 returns from', () => {
    expect(interpolateX(20, 200, 0)).toBe(20);
  });

  it('progress=1 returns to', () => {
    expect(interpolateX(20, 200, 1)).toBe(200);
  });

  it('progress=0.5 returns ease-out-cubic value greater than linear midpoint', () => {
    // ease-out-cubic at t=0.5: eased = 1 - (1-0.5)^3 = 1 - 0.125 = 0.875
    // result = 0 + 0.875 * 100 = 87.5, which is > linear midpoint 50
    expect(interpolateX(0, 100, 0.5)).toBeCloseTo(87.5, 5);
    expect(interpolateX(0, 100, 0.5)).toBeGreaterThan(50);
  });

  it('progress clamped below 0 behaves like progress=0', () => {
    expect(interpolateX(0, 100, -0.1)).toBe(interpolateX(0, 100, 0));
  });

  it('progress clamped above 1 behaves like progress=1', () => {
    expect(interpolateX(0, 100, 1.5)).toBe(interpolateX(0, 100, 1));
  });

  it('reverse direction (from > to) is monotone: later progress yields smaller value', () => {
    // interpolateX(100, 0, 0.5) = 100 - 0.875*100 = 12.5
    expect(interpolateX(100, 0, 0.5)).toBeCloseTo(12.5, 5);
    // monotone check: at t=0.25 result should be larger than at t=0.75
    expect(interpolateX(100, 0, 0.25)).toBeGreaterThan(interpolateX(100, 0, 0.75));
  });
});
