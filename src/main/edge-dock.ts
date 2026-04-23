/**
 * edge-dock.ts — Effects executor for the M5 edge-dock feature.
 *
 * Consumes EdgeDockEffect values produced by the pure reducer and executes
 * the corresponding side effects (window positioning, animation, dim, IPC).
 *
 * No Electron imports: all platform calls are injected via EdgeDockDeps so that
 * unit tests can run in plain Node without an Electron process.
 */

import type { WindowState } from '@shared/types';
import {
  reduce,
  initialState,
  type EdgeDockConfig,
  type EdgeDockEffect,
  type EdgeDockEvent,
  type EdgeDockState,
  type Rect,
} from './edge-dock-reducer';
import { interpolateX } from './edge-geometry';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { Rect };

/** Opaque handle returned by setInterval (Node.js / Vitest fake timers). */
export type IntervalHandle = ReturnType<typeof setInterval>;

export interface EdgeDockDeps {
  /** Move the window to the given x coordinate (updates only x; y/width/height preserved by caller). */
  setWindowX: (x: number) => void;
  /** Return the window's current bounds (needed to compute fromX of REVEAL animations). */
  getWindowBounds: () => Rect;
  /** Apply the dim overlay (DimController.applyDim). */
  applyDim: () => void;
  /** Clear the dim overlay (DimController.clearDim). */
  clearDim: () => void;
  /** Broadcast WindowState to the renderer via IPC. */
  broadcastState: (s: WindowState) => void;
  /** Returns current epoch time in ms.  Pass Date.now in production; override in tests. */
  now: () => number;
  /** Injected so tests can substitute a fake-timer-aware version. */
  setInterval: (cb: () => void, ms: number) => IntervalHandle;
  /** Injected so tests can clear fake-timer intervals. */
  clearInterval: (h: IntervalHandle) => void;
  /** Static configuration; set once at bootstrap. */
  config: EdgeDockConfig;
}

// ---------------------------------------------------------------------------
// EdgeDock — effects executor
// ---------------------------------------------------------------------------

interface AnimState {
  handle: IntervalHandle;
}

export class EdgeDock {
  private state: EdgeDockState = initialState();
  private anim: AnimState | null = null;

  constructor(private readonly deps: EdgeDockDeps) {}

  dispatch(event: EdgeDockEvent): void {
    const { nextState, effects } = reduce(this.state, event, this.deps.config);
    this.state = nextState;
    for (const fx of effects) this.runEffect(fx);
  }

  getState(): EdgeDockState {
    return this.state;
  }

  private runEffect(fx: EdgeDockEffect): void {
    switch (fx.type) {
      case 'APPLY_DIM':
        this.deps.applyDim();
        return;

      case 'CLEAR_DIM':
        this.deps.clearDim();
        return;

      case 'ANIM_HIDE':
      case 'ANIM_REVEAL':
        this.startAnim(fx.targetX, fx.ms);
        return;

      case 'ANIM_CANCEL':
        this.cancelAnim();
        return;

      case 'SNAP_TO_CENTER':
        this.deps.setWindowX(fx.workArea.x + (fx.workArea.width - fx.windowWidth) / 2);
        return;

      case 'BROADCAST_STATE':
        this.deps.broadcastState({ docked: fx.docked, hidden: fx.hidden, dimmed: fx.dimmed });
        return;

      default:
        assertNever(fx);
    }
  }

  private startAnim(targetX: number, ms: number): void {
    // Always cancel any running animation first (defensive)
    this.cancelAnim();

    if (ms === 0) {
      // Instant: skip interval, move immediately, notify state machine
      this.deps.setWindowX(targetX);
      this.dispatch({ type: 'ANIM_DONE' });
      return;
    }

    const fromX = this.deps.getWindowBounds().x;
    const startedAt = this.deps.now();

    const handle = this.deps.setInterval(() => {
      const elapsed = this.deps.now() - startedAt;
      const t = Math.min(1, elapsed / ms);
      this.deps.setWindowX(interpolateX(fromX, targetX, t));
      if (t >= 1) {
        this.cancelAnim();
        this.dispatch({ type: 'ANIM_DONE' });
      }
    }, 16);

    this.anim = { handle };
  }

  private cancelAnim(): void {
    if (this.anim) {
      this.deps.clearInterval(this.anim.handle);
      this.anim = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNever(x: never): never {
  throw new Error(`Unhandled effect: ${JSON.stringify(x)}`);
}
