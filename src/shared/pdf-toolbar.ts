import type { AppearanceSettings } from './types';

export const PDF_TOOLBAR_DARK = '#3c3c3c';
export const PDF_TOOLBAR_LIGHT = '#f6f6f7';

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map((c) => c + c).join('');
  return null;
}

/** Choose black or white by WCAG contrast, including middle-brightness colors. */
export function toolbarForeground(color: string): string {
  const hex = normalizeHexColor(color) ?? PDF_TOOLBAR_DARK;
  const channels = [1, 3, 5].map((i) => {
    const n = parseInt(hex.slice(i, i + 2), 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export interface PdfToolbarStyle { background: string; foreground: string }

export function resolvePdfToolbarStyle(settings: AppearanceSettings, systemDark: boolean): PdfToolbarStyle {
  const mode = settings.pdfToolbarTheme;
  const background = mode === 'custom'
    ? normalizeHexColor(settings.pdfToolbarColor) ?? PDF_TOOLBAR_DARK
    : mode === 'dark' || (mode !== 'light' && systemDark) ? PDF_TOOLBAR_DARK : PDF_TOOLBAR_LIGHT;
  return { background, foreground: toolbarForeground(background) };
}
