/**
 * Pure per-tab view layout (M17, extended M16). ViewManager.applyBounds()
 * applies the result to every tab's WebContentsView.
 *
 * - Every view gets the same "page" bounds; only the active one is visible.
 *   Hidden pages report visibilityState=hidden (Chromium throttles their
 *   timers / rAF) and switching tabs never resizes a page (M16 — background
 *   tabs used to be zero-sized and re-laid-out on every switch).
 * - The active view's height never includes `topInsetPx`: while the top
 *   overlay stack (TabDrawer / FindBar / Downloads) is open the view slides
 *   down and its bottom is clipped by the window — no reflow (M17).
 * - Suppression (renderer overlays) and `windowHidden` (window slid into the
 *   screen edge) hide the active view via View.setVisible(false).
 * - `fullscreen` (in-window HTML fullscreen, M16): the active view covers the
 *   whole content area, chrome included.
 */
export interface ViewLayoutInput {
  contentWidth: number;
  contentHeight: number;
  chromeHeightPx: number;
  topInsetPx: number;
  suppressed: boolean;
  isActive: boolean;
  /** Edge-dock reports the window fully hidden at the screen edge. */
  windowHidden: boolean;
  /** The active tab is in in-window HTML fullscreen. */
  fullscreen: boolean;
}

export interface ViewLayout {
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export function computeViewLayout(i: ViewLayoutInput): ViewLayout {
  const width = Math.max(0, i.contentWidth);
  if (i.isActive && i.fullscreen) {
    return {
      bounds: { x: 0, y: 0, width, height: Math.max(0, i.contentHeight) },
      visible: !i.suppressed && !i.windowHidden,
    };
  }
  const page = {
    x: 0,
    y: i.chromeHeightPx + (i.isActive ? i.topInsetPx : 0),
    width,
    height: Math.max(0, i.contentHeight - i.chromeHeightPx),
  };
  if (!i.isActive) return { bounds: page, visible: false };
  return { bounds: page, visible: !i.suppressed && !i.windowHidden };
}
