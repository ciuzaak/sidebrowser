/**
 * Resolves the `titleBarOverlay` color pair for the active theme.
 * Values mirror `--surface-chrome-top` (chrome) and `--fg-strong` / `--fg-muted`
 * (symbol contrast). The overlay is an OS-side pixel layer (not in the DOM),
 * so we can't read these via getComputedStyle — they must be duplicated here.
 *
 * Pure helper — no Electron import — so it's freely unit-testable.
 */
export function resolveTitleBarOverlay(
  theme: 'dark' | 'light',
): { color: string; symbolColor: string } {
  if (theme === 'dark') {
    return { color: '#25272d', symbolColor: '#c8ccd4' };
  }
  return { color: '#fbfbfc', symbolColor: '#3a3a3c' };
}
