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

/** Interpolates from → to using ease-out-cubic easing, with progress clamped to [0, 1]. */
export function interpolateX(from: number, to: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
  return from + (to - from) * eased;
}
