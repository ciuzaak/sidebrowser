/**
 * Pure per-tab view layout (M17). ViewManager.applyBounds() applies the
 * result to every tab's WebContentsView.
 *
 * - The active view's height never includes `topInsetPx`: while the TabDrawer
 *   is open the view slides down and its bottom is clipped by the window, so
 *   the page is never resized (no reflow, no mobile-emulation reapply).
 * - Suppression hides the active view via View.setVisible(false) instead of
 *   shrinking it to zero, for the same reason.
 * - Background tabs stay zero-sized (unchanged since M2; revisiting that is M16).
 */
export interface ViewLayoutInput {
  contentWidth: number;
  contentHeight: number;
  chromeHeightPx: number;
  topInsetPx: number;
  suppressed: boolean;
  isActive: boolean;
}

export interface ViewLayout {
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export function computeViewLayout(i: ViewLayoutInput): ViewLayout {
  if (!i.isActive) {
    return { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: true };
  }
  return {
    bounds: {
      x: 0,
      y: i.chromeHeightPx + i.topInsetPx,
      width: Math.max(0, i.contentWidth),
      height: Math.max(0, i.contentHeight - i.chromeHeightPx),
    },
    visible: !i.suppressed,
  };
}
