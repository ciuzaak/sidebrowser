/**
 * Auto-unload policy for inactive tabs (M16). Pure — ViewManager supplies the
 * candidates and performs the unload.
 */
export interface DiscardCandidate {
  id: string;
  active: boolean;
  loaded: boolean;
  audible: boolean;
  isLoading: boolean;
  crashed: string | null;
  /** epoch ms the tab was last the active tab (creation time if never). */
  lastActiveAt: number;
  /** e.g. the tab started a download that is still in progress. */
  busy: boolean;
}

/** Ids of tabs idle for at least `minutes`; `minutes <= 0` disables unloading. */
export function pickTabsToDiscard(
  tabs: readonly DiscardCandidate[],
  now: number,
  minutes: number,
): string[] {
  if (minutes <= 0) return [];
  const cutoff = now - minutes * 60_000;
  return tabs
    .filter(
      (t) =>
        !t.active &&
        t.loaded &&
        !t.audible &&
        !t.isLoading &&
        t.crashed === null &&
        !t.busy &&
        t.lastActiveAt <= cutoff,
    )
    .map((t) => t.id);
}
