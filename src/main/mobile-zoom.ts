/**
 * Mobile-tab zoom via CDP device metrics (M16, spike 2026-10-08).
 *
 * Under mobile emulation Chromium ignores setZoomFactor and eats Ctrl+wheel.
 * What works: shrink the emulated layout width to W/z and let CDP scale the
 * rendered output by `scale` to fill the real view — with
 * `dontSetVisibleSize: true` so the visible size stays the real widget size
 * (otherwise the output is clipped to the shrunken box). `scale` is derived
 * from the rounded width so the output exactly fills the view horizontally.
 */
export interface MobileZoomMetrics {
  width: number;
  height: number;
  scale: number;
}

export function mobileZoomMetrics(width: number, height: number, zoom: number): MobileZoomMetrics {
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 1e-6) {
    return { width, height, scale: 1 };
  }
  const w = Math.max(1, Math.round(width / zoom));
  const scale = width / w;
  return { width: w, height: Math.max(1, Math.round(height / scale)), scale };
}
