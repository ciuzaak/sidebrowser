import { describe, it, expect } from 'vitest';
import { buildFilterCSS } from '../../src/main/build-filter-css';

describe('buildFilterCSS', () => {
  it('blur effect with default values includes filter: blur(8px)', () => {
    const result = buildFilterCSS('blur', {
      effect: 'blur',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: blur(8px)');
    expect(result).toContain('transition: filter 150ms ease-out');
  });

  it('dark effect includes filter: brightness(0.3)', () => {
    const result = buildFilterCSS('dark', {
      effect: 'dark',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: brightness(0.3)');
    expect(result).toContain('transition: filter 150ms ease-out');
  });

  it('light effect includes filter: brightness(1.5)', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: brightness(1.5)');
    expect(result).toContain('transition: filter 150ms ease-out');
  });

  it('none effect returns null', () => {
    const result = buildFilterCSS('none', {
      effect: 'none',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toBeNull();
  });

  it('transitionMs: 0 omits transition segment entirely', () => {
    const result = buildFilterCSS('blur', {
      effect: 'blur',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 0,
    });
    expect(result).toContain('filter: blur(8px)');
    expect(result).not.toContain('transition');
  });

  it('custom blurPx: 16 injects blur(16px) correctly', () => {
    const result = buildFilterCSS('blur', {
      effect: 'blur',
      blurPx: 16,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: blur(16px)');
  });

  it('dark effect with custom darkBrightness: 0.5 injects brightness(0.5)', () => {
    const result = buildFilterCSS('dark', {
      effect: 'dark',
      blurPx: 8,
      darkBrightness: 0.5,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: brightness(0.5)');
  });

  it('light effect with custom lightBrightness: 2 injects brightness(2)', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 2,
      transitionMs: 150,
    });
    expect(result).toContain('filter: brightness(2)');
  });

  it('transitionMs: 1000 includes correct transition value', () => {
    const result = buildFilterCSS('blur', {
      effect: 'blur',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 1000,
    });
    expect(result).toContain('transition: filter 1000ms ease-out');
  });

  it('uses explicit effect parameter for switching, not dim.effect', () => {
    // Pass effect='blur' but dim.effect='dark' - should use the explicit effect param
    const result = buildFilterCSS('blur', {
      effect: 'dark',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1.5,
      transitionMs: 150,
    });
    expect(result).toContain('filter: blur(8px)');
    expect(result).not.toContain('brightness');
  });
});
