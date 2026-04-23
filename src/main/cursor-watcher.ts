import { isCursorInside } from './cursor-state';
import type { MouseLeaveSettings } from './settings';

export interface CursorWatcherDeps {
  getCursorPoint: () => { x: number; y: number };
  getWindowBounds: () => { x: number; y: number; width: number; height: number } | null;
  settings: MouseLeaveSettings;
  /** Poll interval in ms. Default 50. */
  pollMs?: number;
}

export class CursorWatcher {
  private interval: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout | null = null;
  /** Last known state: true = cursor was inside the window. */
  private isInside = true;
  /** True once a leave has been emitted to listeners (guards against double-emit and spurious enter). */
  private leaveEmitted = false;
  private readonly leaveListeners = new Set<() => void>();
  private readonly enterListeners = new Set<() => void>();

  constructor(private readonly deps: CursorWatcherDeps) {}

  /** Begin polling. Idempotent — safe to call more than once. */
  start(): void {
    if (this.interval) return;
    const pollMs = this.deps.pollMs ?? 50;
    this.interval = setInterval(() => this.tick(), pollMs);
  }

  /** Stop polling and cancel any pending leave timer. Does NOT emit events. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  /** Subscribe to leave events. Returns an unsubscribe function. */
  onLeave(cb: () => void): () => void {
    this.leaveListeners.add(cb);
    return () => { this.leaveListeners.delete(cb); };
  }

  /** Subscribe to enter events. Returns an unsubscribe function. */
  onEnter(cb: () => void): () => void {
    this.enterListeners.add(cb);
    return () => { this.enterListeners.delete(cb); };
  }

  /**
   * Test / E2E hook: directly emit leave, bypassing the tick state machine.
   * Only called externally when SIDEBROWSER_E2E=1.
   */
  emitLeaveNow(): void { this.fireLeave(); }

  /**
   * Test / E2E hook: directly emit enter, bypassing the tick state machine.
   * Only called externally when SIDEBROWSER_E2E=1.
   */
  emitEnterNow(): void { this.fireEnter(); }

  // ── Private ──────────────────────────────────────────────────────────────

  private tick(): void {
    const bounds = this.deps.getWindowBounds();
    // Window destroyed (or not yet available) — skip this tick entirely.
    if (bounds === null) return;

    const cursor = this.deps.getCursorPoint();
    const wasInside = this.isInside;
    const nowInside = isCursorInside(cursor, bounds);
    this.isInside = nowInside;

    if (wasInside && !nowInside) {
      // Edge: inside → outside. Start the debounce timer.
      // (Any previously scheduled timer shouldn't exist here, but clear for safety.)
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
      }
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = null;
        this.fireLeave();
      }, this.deps.settings.delayMs);
    } else if (!wasInside && nowInside) {
      // Edge: outside → inside.
      if (this.leaveTimer) {
        // Leave timer hasn't fired yet — cursor came back quickly. Cancel it.
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      } else if (this.leaveEmitted) {
        // Leave was already emitted — now cursor is back, emit enter.
        this.fireEnter();
      }
    }
  }

  private fireLeave(): void {
    // Guard: don't double-emit.
    if (this.leaveEmitted) return;
    this.leaveEmitted = true;
    for (const cb of this.leaveListeners) cb();
  }

  private fireEnter(): void {
    // Guard: only emit enter if we previously emitted leave.
    if (!this.leaveEmitted) return;
    this.leaveEmitted = false;
    for (const cb of this.enterListeners) cb();
  }
}
