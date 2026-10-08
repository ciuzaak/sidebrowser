import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { isPermissionAllowed } from '../../src/main/permissions';
import { decideWindowOpen, popupSizeFromFeatures } from '../../src/main/window-open';
import { sanitizeFilename, uniqueFilename } from '../../src/main/downloads-naming';
import { mobileZoomMetrics } from '../../src/main/mobile-zoom';
import { pickTabsToDiscard, type DiscardCandidate } from '../../src/main/tab-discard';
import { effectiveMuted } from '../../src/main/audio';
import { isFragmentOnlyChange, storableFavicon, MAX_DATA_FAVICON } from '../../src/main/history-filter';

describe('isPermissionAllowed', () => {
  it('allows only the harmless allowlist', () => {
    for (const p of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'storage-access']) {
      expect(isPermissionAllowed(p)).toBe(true);
    }
    for (const p of ['notifications', 'geolocation', 'media', 'midiSysex', 'openExternal', 'display-capture', 'clipboard-read']) {
      expect(isPermissionAllowed(p)).toBe(false);
    }
  });
});

describe('decideWindowOpen', () => {
  it('popups for new-window http(s) only', () => {
    expect(decideWindowOpen({ disposition: 'new-window', url: 'https://accounts.google.com/x' })).toEqual({ kind: 'popup' });
    expect(decideWindowOpen({ disposition: 'new-window', url: 'javascript:alert(1)' })).toEqual({ kind: 'tab', activate: true });
  });
  it('background-tab opens without activating; others activate', () => {
    expect(decideWindowOpen({ disposition: 'background-tab', url: 'https://a.com' })).toEqual({ kind: 'tab', activate: false });
    expect(decideWindowOpen({ disposition: 'foreground-tab', url: 'https://a.com' })).toEqual({ kind: 'tab', activate: true });
    expect(decideWindowOpen({ disposition: 'default', url: 'https://a.com' })).toEqual({ kind: 'tab', activate: true });
  });
});

describe('popupSizeFromFeatures', () => {
  it('reads and clamps width/height', () => {
    expect(popupSizeFromFeatures('width=500,height=600,left=10')).toEqual({ width: 500, height: 600 });
    expect(popupSizeFromFeatures('width=50, height=5000')).toEqual({ width: 320, height: 1000 });
    expect(popupSizeFromFeatures('')).toEqual({ width: 500, height: 640 });
  });
});

describe('downloads naming', () => {
  it('sanitizes forbidden characters and trailing dots', () => {
    expect(sanitizeFilename('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(sanitizeFilename('name. . ')).toBe('name');
    expect(sanitizeFilename('')).toBe('download');
  });
  it('picks the first free "name (n).ext"', () => {
    const taken = new Set([join('D', 'f.zip'), join('D', 'f (1).zip')]);
    expect(uniqueFilename('D', 'f.zip', (p) => taken.has(p))).toBe(join('D', 'f (2).zip'));
    expect(uniqueFilename('D', 'g.zip', (p) => taken.has(p))).toBe(join('D', 'g.zip'));
    expect(uniqueFilename('D', 'README', () => false)).toBe(join('D', 'README'));
  });
});

describe('mobileZoomMetrics', () => {
  it('identity at 100%', () => {
    expect(mobileZoomMetrics(393, 816, 1)).toEqual({ width: 393, height: 816, scale: 1 });
  });
  it('shrinks layout and derives an exact horizontal scale', () => {
    const m = mobileZoomMetrics(393, 816, 1.5);
    expect(m.width).toBe(262);
    expect(m.width * m.scale).toBeCloseTo(393, 6);
    expect(m.height).toBe(Math.round(816 / m.scale));
  });
  it('zoom out widens the layout', () => {
    expect(mobileZoomMetrics(400, 800, 0.5)).toEqual({ width: 800, height: 1600, scale: 0.5 });
  });
});

describe('pickTabsToDiscard', () => {
  const now = 10_000_000;
  const base: DiscardCandidate = {
    id: 'x', active: false, loaded: true, audible: false, isLoading: false,
    crashed: null, lastActiveAt: now - 31 * 60_000, busy: false,
  };
  it('discards idle background tabs only', () => {
    const tabs: DiscardCandidate[] = [
      { ...base, id: 'idle' },
      { ...base, id: 'active', active: true },
      { ...base, id: 'recent', lastActiveAt: now - 5 * 60_000 },
      { ...base, id: 'audible', audible: true },
      { ...base, id: 'unloaded', loaded: false },
      { ...base, id: 'loading', isLoading: true },
      { ...base, id: 'crashed', crashed: 'crashed' },
      { ...base, id: 'busy', busy: true },
    ];
    expect(pickTabsToDiscard(tabs, now, 30)).toEqual(['idle']);
  });
  it('0 minutes disables', () => {
    expect(pickTabsToDiscard([{ ...base }], now, 0)).toEqual([]);
  });
});

describe('effectiveMuted', () => {
  it('user mute or hidden-with-setting', () => {
    expect(effectiveMuted(true, false, false)).toBe(true);
    expect(effectiveMuted(false, true, true)).toBe(true);
    expect(effectiveMuted(false, true, false)).toBe(false);
    expect(effectiveMuted(false, false, true)).toBe(false);
  });
});

describe('history filters', () => {
  it('fragment-only changes are skipped', () => {
    expect(isFragmentOnlyChange('https://a.com/p#x', 'https://a.com/p#y')).toBe(true);
    expect(isFragmentOnlyChange('https://a.com/p', 'https://a.com/p')).toBe(true);
    expect(isFragmentOnlyChange('https://a.com/p', 'https://a.com/q')).toBe(false);
    expect(isFragmentOnlyChange('https://a.com/p?a=1', 'https://a.com/p?a=2')).toBe(false);
    expect(isFragmentOnlyChange('', 'https://a.com/')).toBe(false);
  });
  it('drops oversized data favicons', () => {
    expect(storableFavicon('https://a.com/f.ico')).toBe('https://a.com/f.ico');
    expect(storableFavicon('data:image/png;base64,' + 'A'.repeat(MAX_DATA_FAVICON))).toBeNull();
    expect(storableFavicon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(storableFavicon(null)).toBeNull();
  });
});
