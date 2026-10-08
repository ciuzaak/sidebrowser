/** Effective mute for a tab (M16): user mute, or auto-mute while hidden at the edge. */
export function effectiveMuted(
  userMuted: boolean,
  windowHidden: boolean,
  muteWhenHidden: boolean,
): boolean {
  return userMuted || (muteWhenHidden && windowHidden);
}
