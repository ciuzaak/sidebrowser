/**
 * tab-cycler.ts — Ctrl+Tab cycle controller (M13).
 *
 * Replaces the M8 Application-Menu accelerator-driven "toggle drawer" behavior
 * with hold-Ctrl-cycle-tabs semantics matching Firefox/Edge for the *cycle*
 * direction. Ctrl release is NOT auto-detected — Electron's before-input-event
 * for standalone modifier keyUps is unreliable on Windows. Instead, the drawer
 * closes the same way as a mouse-opened drawer: outside-click / tab selection
 * / window blur. The renderer fires `cycle:end` IPC from `closeDrawer`; main
 * also ends on `win.on('blur')`.
 *
 * Why before-input-event instead of Application Menu accelerators: even
 * though we don't use keyUp anymore, Application Menu accelerators don't
 * support modifier-aware repeat semantics; before-input-event gives us
 * `input.shift` so Ctrl+Shift+Tab can reverse.
 *
 * The `cycling` flag is broadcast once per transition — repeated keyDowns
 * while cycling do not re-emit `active=true`.
 */

import type { WebContents, Input, Event as ElectronEvent } from 'electron';

export interface TabCyclerDeps {
  activateNext: () => void;
  activatePrev: () => void;
  broadcastCycleState: (active: boolean) => void;
}

export class TabCycler {
  private cycling = false;

  constructor(private readonly deps: TabCyclerDeps) {}

  /**
   * Install the before-input-event listener on `wc`. Returns a detach closure
   * that removes the listener (no-op if `wc` was destroyed).
   */
  attach(wc: WebContents): () => void {
    const handler = (e: ElectronEvent, input: Input): void => {
      // Tab + Ctrl, no other modifiers → cycle.
      if (
        input.type === 'keyDown' &&
        input.key === 'Tab' &&
        input.control &&
        !input.alt &&
        !input.meta
      ) {
        e.preventDefault();
        if (input.shift) this.deps.activatePrev();
        else this.deps.activateNext();
        if (!this.cycling) {
          this.cycling = true;
          this.deps.broadcastCycleState(true);
        }
      }
    };
    wc.on('before-input-event', handler);
    return () => {
      try { wc.off('before-input-event', handler); } catch { /* destroyed */ }
    };
  }

  /**
   * Force-end the cycle. Called from index.ts on `cycle:end` IPC (renderer-
   * driven, fired by closeDrawer) and on `win.on('blur')`. No-op when not
   * cycling to keep the broadcast stream clean.
   */
  end(): void {
    if (!this.cycling) return;
    this.cycling = false;
    this.deps.broadcastCycleState(false);
  }
}
