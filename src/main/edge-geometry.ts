import type { Rect } from './window-bounds';

/** Returns which display edge the window is docked to, or null if not near either edge. */
export function computeDockedSide(
  bounds: { x: number; width: number },
  workArea: { x: number; width: number },
  edgeThresholdPx: number,
): 'left' | 'right' | null {
  if (Math.abs(bounds.x - workArea.x) <= edgeThresholdPx) return 'left';
  if (Math.abs((bounds.x + bounds.width) - (workArea.x + workArea.width)) <= edgeThresholdPx) return 'right';
  return null;
}

/** A hidden window's body must not land on another monitor (including its taskbar). */
export function canHideAtEdge(
  bounds: Rect,
  workArea: Rect,
  side: 'left' | 'right',
  triggerStripPx: number,
  displayBounds: Rect[],
): boolean {
  const width = Math.max(0, bounds.width - triggerStripPx);
  const x = side === 'left' ? workArea.x - width : workArea.x + workArea.width;
  return !displayBounds.some((d) =>
    x < d.x + d.width && x + width > d.x &&
    bounds.y < d.y + d.height && bounds.y + bounds.height > d.y,
  );
}

/** Interpolates from → to using ease-out-cubic easing, with progress clamped to [0, 1]. */
export function interpolateX(from: number, to: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
  return from + (to - from) * eased;
}
