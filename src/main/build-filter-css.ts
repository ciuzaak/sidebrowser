/**
 * Build CSS rule for HTML filter effect (blur/dark/light/none).
 * Pure function: no side effects, deterministic based on effect + dim settings.
 *
 * @param effect The effect type to apply (blur, dark, light, or none)
 * @param dim DimSettings object containing blurPx, darkBrightness, lightBrightness, transitionMs
 * @returns CSS rule string, or null if effect is 'none'
 */

import type { DimSettings } from './settings';

export function buildFilterCSS(
  effect: DimSettings['effect'],
  dim: DimSettings
): string | null {
  if (effect === 'none') {
    return null;
  }

  // M13: light is a white overlay (filter: brightness can't reach pure white).
  // Field name `lightBrightness` retained for back-compat; semantically it is
  // the overlay opacity in [0,1] post-clamp (clampDim updated separately).
  if (effect === 'light') {
    let css =
      "html::after { content: ''; position: fixed; inset: 0;" +
      ` background: white; opacity: ${dim.lightBrightness};` +
      ' pointer-events: none; z-index: 2147483647;';
    if (dim.transitionMs > 0) {
      css += ` transition: opacity ${dim.transitionMs}ms ease-out;`;
    }
    css += ' }';
    return css;
  }

  let filterValue: string;
  if (effect === 'blur') {
    filterValue = `blur(${dim.blurPx}px)`;
  } else if (effect === 'dark') {
    filterValue = `brightness(${dim.darkBrightness})`;
  } else {
    return null;
  }

  let css = `html { filter: ${filterValue};`;
  if (dim.transitionMs > 0) {
    css += ` transition: filter ${dim.transitionMs}ms ease-out;`;
  }
  css += ' }';
  return css;
}
