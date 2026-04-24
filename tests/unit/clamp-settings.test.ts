import { describe, it, expect } from 'vitest';
import type { Settings } from '@shared/types';
import { clampSettings } from '../../src/main/clamp-settings';
import { DEFAULTS } from '../../src/main/settings';

// Use a deep-cloned DEFAULTS as `current` for every case so individual tests
// can't accidentally mutate the shared baseline.
const cur = (): Settings => structuredClone(DEFAULTS);

describe('clampSettings', () => {
  it('returns {} for an empty partial', () => {
    expect(clampSettings({}, cur())).toEqual({});
  });

  it("expands non-'custom' preset to its width/height", () => {
    expect(clampSettings({ window: { preset: 'iphonese' } }, cur())).toEqual({
      window: { preset: 'iphonese', width: 375, height: 667 },
    });
  });

  it('clamps window.edgeThresholdPx above 50 down to 50', () => {
    expect(clampSettings({ window: { edgeThresholdPx: 100 } }, cur())).toEqual({
      window: { edgeThresholdPx: 50 },
    });
  });

  it('clamps dim.blurPx below 0 up to 0', () => {
    expect(clampSettings({ dim: { blurPx: -5 } }, cur())).toEqual({
      dim: { blurPx: 0 },
    });
  });

  it('clamps dim.lightBrightness below 1 up to 1', () => {
    expect(clampSettings({ dim: { lightBrightness: 0.5 } }, cur())).toEqual({
      dim: { lightBrightness: 1 },
    });
  });

  it('clamps mouseLeave.delayMs above 2000 down to 2000', () => {
    expect(clampSettings({ mouseLeave: { delayMs: 3000 } }, cur())).toEqual({
      mouseLeave: { delayMs: 2000 },
    });
  });

  it('clamps edgeDock.triggerStripPx below 1 up to 1', () => {
    expect(clampSettings({ edgeDock: { triggerStripPx: 0 } }, cur())).toEqual({
      edgeDock: { triggerStripPx: 1 },
    });
  });

  it('drops empty-string mobileUserAgent so current is preserved', () => {
    // We pick the {browsing:{}} representation: section present, no fields. The
    // contract is "do not overwrite current.mobileUserAgent with empty string";
    // either {} or {browsing:{}} satisfies that — we lock in the latter so the
    // test catches accidental policy drift.
    expect(clampSettings({ browsing: { mobileUserAgent: '' } }, cur())).toEqual({
      browsing: {},
    });
  });

  it('emits multiple sections together when partial spans both', () => {
    expect(
      clampSettings(
        { window: { edgeThresholdPx: 12 }, dim: { blurPx: 5 } },
        cur(),
      ),
    ).toEqual({
      window: { edgeThresholdPx: 12 },
      dim: { blurPx: 5 },
    });
  });

  it('passes booleans through unchanged', () => {
    expect(clampSettings({ edgeDock: { enabled: false } }, cur())).toEqual({
      edgeDock: { enabled: false },
    });
  });

  // Extra coverage — natural edge cases called out by the plan briefing.

  it("preset wins over an explicit width in the same partial", () => {
    expect(
      clampSettings(
        { window: { preset: 'iphonese', width: 999 } },
        cur(),
      ),
    ).toEqual({
      window: { preset: 'iphonese', width: 375, height: 667 },
    });
  });

  it('clamps dim.darkBrightness above 1 down to 1 (upper bound)', () => {
    expect(clampSettings({ dim: { darkBrightness: 2 } }, cur())).toEqual({
      dim: { darkBrightness: 1 },
    });
  });

  it("passes dim.effect literal-union string through unchanged", () => {
    expect(clampSettings({ dim: { effect: 'dark' } }, cur())).toEqual({
      dim: { effect: 'dark' },
    });
  });
});

describe('clampAppearance', () => {
  it('accepts valid theme values', () => {
    expect(clampSettings({ appearance: { theme: 'system' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
    expect(clampSettings({ appearance: { theme: 'dark' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'dark' } });
    expect(clampSettings({ appearance: { theme: 'light' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'light' } });
  });

  it('falls back invalid theme → system', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampSettings({ appearance: { theme: 'sepia' as any } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
  });
});

describe('clampWindow — M9 migration', () => {
  it('migrates preset=custom → iphone14pro with canonical dims', () => {
    const out = clampSettings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { window: { preset: 'custom' as any } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('migrates preset=custom alongside stale width/height (width/height dropped)', () => {
    const out = clampSettings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { window: { preset: 'custom' as any, width: 400, height: 800 } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('does NOT coerce width/height without preset to custom anymore (width/height dropped)', () => {
    const out = clampSettings(
      { window: { width: 400, height: 800 } },
      DEFAULTS,
    );
    // width/height alone now no-op; preset is the only path to change dims.
    expect(out.window).toEqual({});
  });
});
