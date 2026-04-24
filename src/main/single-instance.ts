/**
 * Pure handler for the `second-instance` Electron event. Extracted so the
 * routing logic can be tested without spinning up Electron.
 */
export interface SecondInstanceDeps {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  forceRevealIfHidden: () => void;
}

export function handleSecondInstance(deps: SecondInstanceDeps): void {
  if (deps.isDestroyed()) return;
  if (deps.isMinimized()) deps.restore();
  deps.show();
  deps.focus();
  deps.forceRevealIfHidden();
}
