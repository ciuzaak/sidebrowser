import { describe, it, expect } from 'vitest';
import { nextZoomFactor } from '../../src/main/view-manager';

describe('nextZoomFactor', () => {
  it('+0.1 on "in" from 1.0', () => {
    expect(nextZoomFactor(1.0, 'in')).toBeCloseTo(1.1, 5);
  });

  it('-0.1 on "out" from 1.0', () => {
    expect(nextZoomFactor(1.0, 'out')).toBeCloseTo(0.9, 5);
  });

  it('clamps at upper bound 3.0', () => {
    expect(nextZoomFactor(3.0, 'in')).toBeCloseTo(3.0, 5);
    expect(nextZoomFactor(2.95, 'in')).toBeCloseTo(3.0, 5);
  });

  it('clamps at lower bound 0.5', () => {
    expect(nextZoomFactor(0.5, 'out')).toBeCloseTo(0.5, 5);
    expect(nextZoomFactor(0.55, 'out')).toBeCloseTo(0.5, 5);
  });

  it('handles repeated "in" steps cumulatively', () => {
    let z = 1.0;
    for (let i = 0; i < 5; i++) z = nextZoomFactor(z, 'in');
    expect(z).toBeCloseTo(1.5, 5);
  });

  it('handles repeated "out" steps cumulatively', () => {
    let z = 1.0;
    for (let i = 0; i < 3; i++) z = nextZoomFactor(z, 'out');
    expect(z).toBeCloseTo(0.7, 5);
  });
});
