/**
 * tab-cycler.ts — Ctrl+Tab cycle controller (M13).
 *
 * Replaces the M8 Application-Menu accelerator-driven "toggle drawer" behavior
 * with hold-Ctrl-cycle-tabs semantics matching Firefox/Edge:
 *   - Ctrl+Tab keyDown → advance to next tab + broadcast cycle:active=true
 *   - Ctrl+Shift+Tab keyDown → previous tab
 *   - Control keyUp → broadcast cycle:active=false (drawer auto-closes)
 *
 * Why before-input-event instead of Application Menu accelerators: Electron
 * menu accelerators fire on key-down only. We need key-up to know when the
 * user releases Ctrl. The host BrowserWindow's webContents AND every tab's
 * webContents must each have the listener attached; whichever has focus
 * fires the event. Cycler centralizes the cross-WC state (`cycling: bool`).
 *
 * The `cycling` flag is broadcast once per transition — repeated keyDowns
 * while cycling do not re-emit `active=true`. Both transitions are
 * idempotent at the source.
 */

import type { WebContents, Input, Event as ElectronEvent } from 'electron';

export interface TabCyclerDeps {
  activateNext: () => void;
  activatePrev: () => void;
  broadcastCycleState: (active: boolean) => void;
}

/**
 * Inactivity safety net: if no Ctrl+Tab arrives for this long, end the cycle.
 * Defends against the Windows/Electron unreliable modifier keyUp dispatch
 * even when the renderer-side fallback can't see the release either.
 */
const INACTIVITY_END_MS = 3000;

export class TabCycler {
  private cycling = false;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: TabCyclerDeps) {}

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = null;
      this.end();
    }, INACTIVITY_END_MS);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

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
        // Each cycle press extends the inactivity safety net.
        this.resetInactivityTimer();
        return;
      }
      // End cycle when Ctrl is no longer held. Lenient match — fires on:
      //   - keyUp of Control itself (input.control=false at release time)
      //   - any subsequent keyUp where Ctrl wasn't being held (self-heal
      //     against Electron's flaky modifier keyUp before-input-event
      //     dispatch — observed Win/Electron 41 not always firing standalone
      //     modifier keyUps reliably).
      if (this.cycling && input.type === 'keyUp' && !input.control) {
        this.end();
      }
    };
    wc.on('before-input-event', handler);
    return () => {
      try { wc.off('before-input-event', handler); } catch { /* destroyed */ }
    };
  }

  /**
   * Force-end the cycle (e.g. window blur, renderer fallback IPC, inactivity
   * timer). No-op when not currently cycling to keep the broadcast stream clean.
   */
  end(): void {
    this.clearInactivityTimer();
    if (!this.cycling) return;
    this.cycling = false;
    this.deps.broadcastCycleState(false);
  }
}
