import { describe, it, expect } from 'vitest';
import { computeChromeDimStyle } from '../../src/renderer/src/lib/chrome-dim';
import type { DimSettings } from '../../src/shared/types';

const dim = (overrides: Partial<DimSettings> = {}): DimSettings => ({
  effect: 'blur',
  blurPx: 8,
  darkBrightness: 0.3,
  lightBrightness: 0.5,
  transitionMs: 150,
  ...overrides,
});

describe('computeChromeDimStyle', () => {
  it('dimmed=false returns empty style + no overlay regardless of effect', () => {
    const r = computeChromeDimStyle(false, dim({ effect: 'blur' }));
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=none returns empty style + no overlay even when dimmed', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'none' }));
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=blur sets filter: blur(Npx) with transition', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'blur', blurPx: 12, transitionMs: 200 }));
    expect(r.rootStyle.filter).toBe('blur(12px)');
    expect(r.rootStyle.transition).toBe('filter 200ms ease-out');
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=dark sets filter: brightness(N)', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'dark', darkBrightness: 0.2 }));
    expect(r.rootStyle.filter).toBe('brightness(0.2)');
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=light returns overlay with opacity + null filter', () => {
    const r = computeChromeDimStyle(
      true,
      dim({ effect: 'light', lightBrightness: 0.7, transitionMs: 100 }),
    );
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).not.toBeNull();
    expect(r.overlayStyle?.opacity).toBe(0.7);
    expect(r.overlayStyle?.background).toBe('white');
    expect(r.overlayStyle?.position).toBe('fixed');
    expect(r.overlayStyle?.pointerEvents).toBe('none');
    expect(r.overlayStyle?.transition).toBe('opacity 100ms ease-out');
  });

  it('transitionMs=0 omits transition string', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'blur', transitionMs: 0 }));
    expect(r.rootStyle.filter).toBe('blur(8px)');
    expect('transition' in r.rootStyle).toBe(false);
  });
});
