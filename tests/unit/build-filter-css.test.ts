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

  it('light effect emits white overlay via html::after at given opacity', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 0.5,
      transitionMs: 150,
    });
    expect(result).toContain('html::after');
    expect(result).toContain('background: white');
    expect(result).toContain('opacity: 0.5');
    expect(result).toContain('position: fixed');
    expect(result).toContain('pointer-events: none');
    expect(result).toContain('z-index: 2147483647');
    expect(result).toContain('transition: opacity 150ms ease-out');
    expect(result).not.toContain('filter: brightness');
  });

  it('light at opacity 1 reaches full white (asserted by overlay opacity literal)', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1,
      transitionMs: 0,
    });
    expect(result).toContain('opacity: 1');
    expect(result).not.toContain('transition');
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

  it('light effect with custom lightBrightness uses given value as overlay opacity', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 0.75,
      transitionMs: 150,
    });
    expect(result).toContain('opacity: 0.75');
    expect(result).toContain('html::after');
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
