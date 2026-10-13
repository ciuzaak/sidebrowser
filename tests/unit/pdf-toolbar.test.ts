import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '@shared/settings-defaults';
import { normalizeHexColor, resolvePdfToolbarStyle, toolbarForeground } from '@shared/pdf-toolbar';
import { hexToHsv, hsvToHex } from '../../src/renderer/src/lib/color-picker';
import { clampSettings } from '../../src/main/clamp-settings';
import { SettingsStore } from '../../src/main/settings-store';
import type { AppearanceSettings, Settings } from '@shared/types';

describe('PDF toolbar settings', () => {
  it('normalizes hex colors and rejects CSS/JS input', () => {
    expect(normalizeHexColor(' #AbC ')).toBe('#aabbcc');
    expect(normalizeHexColor('#A1B2C3')).toBe('#a1b2c3');
    for (const value of [null, 123, '#12345', '#12345678', 'red', '#fff; color:red', '#fff);alert(1)//']) {
      expect(normalizeHexColor(value)).toBeNull();
    }
  });

  it('clamps modes, rejects invalid colors and preserves independent app theme', () => {
    expect(clampSettings({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#AbC' } }, DEFAULTS))
      .toEqual({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#aabbcc' } });
    expect(clampSettings({ appearance: { pdfToolbarTheme: 'invalid' as AppearanceSettings['pdfToolbarTheme'], pdfToolbarColor: 'red' } }, DEFAULTS))
      .toEqual({ appearance: { pdfToolbarTheme: 'system' } });
  });

  it('fills PDF defaults into old settings without changing their app theme', () => {
    const old = { ...structuredClone(DEFAULTS), appearance: { theme: 'light' } } as Settings;
    const store = new SettingsStore({ get: () => old, set: () => {} });
    expect(store.get().appearance).toEqual({ theme: 'light', pdfToolbarTheme: 'system', pdfToolbarColor: '#3c3c3c' });
    store.update({ appearance: { pdfToolbarTheme: 'custom', pdfToolbarColor: '#d19a66' } });
    store.update({ appearance: { pdfToolbarColor: 'url(bad)' } });
    expect(store.get().appearance).toEqual({ theme: 'light', pdfToolbarTheme: 'custom', pdfToolbarColor: '#d19a66' });
  });

  it('resolves System/Dark/Light/Custom and safely handles malformed saved colors', () => {
    const appearance = { ...DEFAULTS.appearance };
    expect(resolvePdfToolbarStyle(appearance, true).background).toBe('#3c3c3c');
    expect(resolvePdfToolbarStyle(appearance, false).background).toBe('#f6f6f7');
    appearance.pdfToolbarTheme = 'dark';
    expect(resolvePdfToolbarStyle(appearance, false).background).toBe('#3c3c3c');
    appearance.pdfToolbarTheme = 'light';
    expect(resolvePdfToolbarStyle(appearance, true).background).toBe('#f6f6f7');
    appearance.pdfToolbarTheme = 'custom';
    appearance.pdfToolbarColor = '#abcdef';
    expect(resolvePdfToolbarStyle(appearance, true)).toEqual({ background: '#abcdef', foreground: '#000000' });
    appearance.pdfToolbarColor = 'bad';
    expect(resolvePdfToolbarStyle(appearance, false).background).toBe('#3c3c3c');
  });

  it('chooses readable black or white for dark, bright and midrange colors', () => {
    expect(toolbarForeground('#000000')).toBe('#ffffff');
    expect(toolbarForeground('#ffffff')).toBe('#000000');
    expect(toolbarForeground('#ffd966')).toBe('#000000');
    expect(toolbarForeground('#7c3aed')).toBe('#ffffff');
    expect(toolbarForeground('#777777')).toBe('#000000');
  });
});

describe('color palette conversions', () => {
  it('handles primary colors, black and white', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 1, v: 1 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('round trips arbitrary colors and clamps spectrum edges', () => {
    for (const color of ['#3c3c3c', '#ffd966', '#0f766e', '#abcdef', '#f9a8d4', '#804040']) {
      expect(hsvToHex(hexToHsv(color))).toBe(color);
    }
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: -120, s: 2, v: 2 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: -1, v: 0.5 })).toBe('#808080');
  });
});
