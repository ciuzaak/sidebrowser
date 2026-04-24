/**
 * close-action-resolver.ts — Pure function to resolve close-action for BrowserWindow close events.
 *
 * Given the user's settings and the app-quit state, decides whether to hide or destroy
 * the window. Zero side effects.
 *
 * Decision matrix (spec M7 Task 2):
 * | closeAction         | isQuitting | result   |
 * |---|---|---|
 * | 'minimize-to-tray'  | false      | 'hide'   |
 * | 'minimize-to-tray'  | true       | 'destroy'|
 * | 'quit'              | false      | 'destroy'|
 * | 'quit'              | true       | 'destroy'|
 */

/**
 * Resolver output: how the caller should handle a BrowserWindow close event.
 * - 'hide'    → caller does e.preventDefault() + win.hide()
 * - 'destroy' → caller lets the default close proceed (window is destroyed)
 */
export type CloseAction = 'hide' | 'destroy';

/**
 * Input shape for close-action resolution.
 */
export interface ResolveCloseActionInput {
  /** settings.lifecycle.closeAction: the user's configured close behaviour. */
  closeAction: 'quit' | 'minimize-to-tray';
  /** true if tray menu Quit or app.quit() has been initiated. */
  isQuitting: boolean;
}

/**
 * Decide how to handle a BrowserWindow close event.
 * @param input configuration and app state
 * @returns 'hide' or 'destroy'
 */
export function resolveCloseAction(input: ResolveCloseActionInput): CloseAction {
  const { closeAction, isQuitting } = input;

  // If the app is quitting (Quit from tray or app.quit() called), always destroy.
  if (isQuitting) {
    return 'destroy';
  }

  // Normal close button path: check the user's setting.
  if (closeAction === 'minimize-to-tray') {
    return 'hide';
  }

  // closeAction === 'quit': destroy the window (exit the app).
  return 'destroy';
}
