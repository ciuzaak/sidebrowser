/**
 * chrome-dim.ts — Pure helper deriving renderer-side style for chrome dim
 * (M13). The chrome (TopBar / TabDrawer / SettingsDrawer / NewTab) lives in
 * the host BrowserWindow's webContents — not the active tab's WebContents —
 * so it cannot be reached by the existing DimController which runs against
 * the per-tab webContents. Instead, App.tsx subscribes to the existing
 * windowState.dimmed signal and runs this helper to get an inline style for
 * the chrome root + (for the light effect) an absolutely-positioned white
 * overlay style.
 *
 * Z-order: WebContentsView is rendered ABOVE the renderer DOM in the page
 * area, so this overlay is only visibly active over actual chrome regions
 * (top bar, drawers when open). The page area is dimmed via the existing
 * page-side `dim.apply(activeWc, dim)` path. Two layers, no overlap.
 *
 * Pure: no React imports beyond CSSProperties (a type), no DOM access,
 * no side effects. Returned objects are plain records — App.tsx uses them
 * inline.
 */

import type { CSSProperties } from 'react';
import type { DimSettings } from '../../../shared/types';

export interface ChromeDimResult {
  /** Inline style to spread on the chrome root container. */
  rootStyle: CSSProperties;
  /** When non-null, render a fixed-position div with this style as a child of root. */
  overlayStyle: CSSProperties | null;
}

export function computeChromeDimStyle(
  dimmed: boolean,
  dim: DimSettings,
): ChromeDimResult {
  if (!dimmed || dim.effect === 'none') {
    return { rootStyle: {}, overlayStyle: null };
  }

  if (dim.effect === 'light') {
    const overlay: CSSProperties = {
      position: 'fixed',
      inset: 0,
      background: 'white',
      opacity: dim.lightBrightness,
      pointerEvents: 'none',
      zIndex: 2147483647,
    };
    if (dim.transitionMs > 0) {
      overlay.transition = `opacity ${dim.transitionMs}ms ease-out`;
    }
    return { rootStyle: {}, overlayStyle: overlay };
  }

  const filter =
    dim.effect === 'blur'
      ? `blur(${dim.blurPx}px)`
      : `brightness(${dim.darkBrightness})`;
  const root: CSSProperties = { filter };
  if (dim.transitionMs > 0) {
    root.transition = `filter ${dim.transitionMs}ms ease-out`;
  }
  return { rootStyle: root, overlayStyle: null };
}
