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
  // Early return for 'none' effect
  if (effect === 'none') {
    return null;
  }

  let filterValue: string;

  // Map effect to filter value
  if (effect === 'blur') {
    filterValue = `blur(${dim.blurPx}px)`;
  } else if (effect === 'dark') {
    filterValue = `brightness(${dim.darkBrightness})`;
  } else if (effect === 'light') {
    filterValue = `brightness(${dim.lightBrightness})`;
  } else {
    // Exhaustive check - should never reach here if effect type is correct
    return null;
  }

  // Build CSS rule
  let css = `html { filter: ${filterValue};`;

  // Add transition segment if transitionMs > 0
  if (dim.transitionMs > 0) {
    css += ` transition: filter ${dim.transitionMs}ms ease-out;`;
  }

  css += ' }';

  return css;
}
