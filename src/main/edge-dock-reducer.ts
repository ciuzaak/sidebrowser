/**
 * edge-dock-reducer.ts — Pure state machine for the M5 edge-dock feature.
 *
 * Follows spec §5.1 state transition table. No Electron imports; zero side effects.
 * All side effects are described as EdgeDockEffect values; executed by edge-dock.ts (Task 5).
 *
 * Design decisions:
 *  - `dimmed: boolean` is tracked inside every state variant so WINDOW_MOVED and
 *    DISPLAY_CHANGED can broadcast "current dim value" without extra input.
 *  - DISPLAY_CHANGED carries `workArea: Rect` (always populated by the caller) and
 *    `offscreen: boolean`. When offscreen=true the reducer emits SNAP_TO_CENTER; the
 *    effect carries the workArea so the executor knows where to center without querying
 *    Electron. (Plan literal has `workArea: Rect | null`; we revise to always-Rect
 *    per the briefing's §5 design note — keeps SNAP_TO_CENTER self-contained.)
 *  - HIDING/REVEALING + WINDOW_MOVED → no-op (guard: setBounds doesn't fire 'moved').
 *  - REVEALING + MOUSE_LEAVE → no-op (spec §10: ignore events mid-animation).
 *  - REVEALING + ANIM_DONE → no effects (renderer already has up-to-date state from
 *    the REVEALING entry broadcast).
 *  - cfg.enabled=false → no-op on every event (full disable guard).
 */

import { computeDockedSide } from './edge-geometry';

// ---------------------------------------------------------------------------
// Shared geometry type (Electron's Rectangle is structurally compatible)
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type EdgeDockState =
  | { kind: 'DOCKED_NONE'; workArea: Rect | null; dimmed: boolean }
  | { kind: 'DOCKED_LEFT' | 'DOCKED_RIGHT'; workArea: Rect; dimmed: boolean }
  | { kind: 'HIDING' | 'REVEALING'; side: 'left' | 'right'; workArea: Rect; dimmed: boolean }
  | { kind: 'HIDDEN_LEFT' | 'HIDDEN_RIGHT'; workArea: Rect; dimmed: boolean };

/** Stable initial value; bootstrap should dispatch WINDOW_MOVED immediately after to seed workArea. */
export function initialState(): EdgeDockState {
  return { kind: 'DOCKED_NONE', workArea: null, dimmed: false };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EdgeDockEvent =
  | { type: 'MOUSE_LEAVE' }
  | { type: 'MOUSE_ENTER' }
  | { type: 'WINDOW_MOVED'; bounds: Rect; workArea: Rect }
  | {
      type: 'DISPLAY_CHANGED';
      bounds: Rect;
      /** Always populated: the matched display workArea (onscreen) or nearest display workArea (offscreen). */
      workArea: Rect;
      /** true when bounds do not lie inside any display workArea. */
      offscreen: boolean;
    }
  | { type: 'ANIM_DONE' };

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type EdgeDockEffect =
  | { type: 'APPLY_DIM' }
  | { type: 'CLEAR_DIM' }
  | { type: 'ANIM_HIDE'; side: 'left' | 'right'; targetX: number; ms: number }
  | { type: 'ANIM_REVEAL'; side: 'left' | 'right'; targetX: number; ms: number }
  | { type: 'ANIM_CANCEL' }
  | { type: 'SNAP_TO_CENTER'; workArea: Rect; windowWidth: number }
  | { type: 'BROADCAST_STATE'; docked: 'left' | 'right' | null; hidden: boolean; dimmed: boolean };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EdgeDockConfig {
  edgeThresholdPx: number;
  animationMs: number;
  triggerStripPx: number;
  windowWidth: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sideFromKind(kind: 'DOCKED_LEFT' | 'DOCKED_RIGHT' | 'HIDDEN_LEFT' | 'HIDDEN_RIGHT'): 'left' | 'right' {
  return kind === 'DOCKED_LEFT' || kind === 'HIDDEN_LEFT' ? 'left' : 'right';
}

function dockedKindFromSide(side: 'left' | 'right'): 'DOCKED_LEFT' | 'DOCKED_RIGHT' {
  return side === 'left' ? 'DOCKED_LEFT' : 'DOCKED_RIGHT';
}

function hiddenKindFromSide(side: 'left' | 'right'): 'HIDDEN_LEFT' | 'HIDDEN_RIGHT' {
  return side === 'left' ? 'HIDDEN_LEFT' : 'HIDDEN_RIGHT';
}

/** targetX for ANIM_HIDE effect */
function hideTargetX(side: 'left' | 'right', workArea: Rect, cfg: EdgeDockConfig): number {
  if (side === 'left') {
    return workArea.x - cfg.windowWidth + cfg.triggerStripPx;
  }
  return workArea.x + workArea.width - cfg.triggerStripPx;
}

/** targetX for ANIM_REVEAL effect (= docked position) */
function revealTargetX(side: 'left' | 'right', workArea: Rect, cfg: EdgeDockConfig): number {
  if (side === 'left') {
    return workArea.x;
  }
  return workArea.x + workArea.width - cfg.windowWidth;
}

function broadcast(
  docked: 'left' | 'right' | null,
  hidden: boolean,
  dimmed: boolean,
): EdgeDockEffect {
  return { type: 'BROADCAST_STATE', docked, hidden, dimmed };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(
  state: EdgeDockState,
  event: EdgeDockEvent,
  cfg: EdgeDockConfig,
): { nextState: EdgeDockState; effects: EdgeDockEffect[] } {
  // Full disable guard
  if (!cfg.enabled) {
    return { nextState: state, effects: [] };
  }

  const { kind } = state;

  switch (event.type) {
    // -----------------------------------------------------------------------
    case 'MOUSE_LEAVE': {
      if (kind === 'DOCKED_NONE') {
        const nextState: EdgeDockState = { ...state, kind: 'DOCKED_NONE', dimmed: true };
        return {
          nextState,
          effects: [
            { type: 'APPLY_DIM' },
            broadcast(null, false, true),
          ],
        };
      }

      if (kind === 'DOCKED_LEFT' || kind === 'DOCKED_RIGHT') {
        const side = sideFromKind(kind);
        const workArea = state.workArea;
        const nextState: EdgeDockState = {
          kind: 'HIDING',
          side,
          workArea,
          dimmed: true,
        };
        const effects: EdgeDockEffect[] = [
          { type: 'APPLY_DIM' },
          { type: 'ANIM_HIDE', side, targetX: hideTargetX(side, workArea, cfg), ms: cfg.animationMs },
          broadcast(side, false, true),
        ];
        return { nextState, effects };
      }

      if (kind === 'REVEALING') {
        // spec §10: ignore MOUSE_LEAVE during animation
        return { nextState: state, effects: [] };
      }

      // HIDING, HIDDEN_LEFT, HIDDEN_RIGHT: no valid transition for MOUSE_LEAVE
      return { nextState: state, effects: [] };
    }

    // -----------------------------------------------------------------------
    case 'MOUSE_ENTER': {
      if (kind === 'DOCKED_NONE') {
        const nextState: EdgeDockState = { ...state, kind: 'DOCKED_NONE', dimmed: false };
        return {
          nextState,
          effects: [
            { type: 'CLEAR_DIM' },
            broadcast(null, false, false),
          ],
        };
      }

      if (kind === 'DOCKED_LEFT' || kind === 'DOCKED_RIGHT') {
        const side = sideFromKind(kind);
        const nextState: EdgeDockState = { ...state, dimmed: false };
        return {
          nextState,
          effects: [
            { type: 'CLEAR_DIM' },
            broadcast(side, false, false),
          ],
        };
      }

      if (kind === 'HIDING') {
        const { side, workArea } = state;
        const nextState: EdgeDockState = {
          kind: 'REVEALING',
          side,
          workArea,
          dimmed: false,
        };
        const effects: EdgeDockEffect[] = [
          { type: 'ANIM_CANCEL' },
          { type: 'CLEAR_DIM' },
          { type: 'ANIM_REVEAL', side, targetX: revealTargetX(side, workArea, cfg), ms: cfg.animationMs },
          broadcast(side, false, false),
        ];
        return { nextState, effects };
      }

      if (kind === 'HIDDEN_LEFT' || kind === 'HIDDEN_RIGHT') {
        const side = sideFromKind(kind);
        const { workArea } = state;
        const nextState: EdgeDockState = {
          kind: 'REVEALING',
          side,
          workArea,
          dimmed: false,
        };
        const effects: EdgeDockEffect[] = [
          { type: 'CLEAR_DIM' },
          { type: 'ANIM_REVEAL', side, targetX: revealTargetX(side, workArea, cfg), ms: cfg.animationMs },
          broadcast(side, false, false),
        ];
        return { nextState, effects };
      }

      if (kind === 'REVEALING') {
        // Already revealing — no-op (idempotent)
        return { nextState: state, effects: [] };
      }

      return { nextState: state, effects: [] };
    }

    // -----------------------------------------------------------------------
    case 'ANIM_DONE': {
      if (kind === 'HIDING') {
        const { side, workArea, dimmed } = state;
        const nextState: EdgeDockState = {
          kind: hiddenKindFromSide(side),
          workArea,
          dimmed, // true — APPLY_DIM was emitted on MOUSE_LEAVE that started HIDING
        };
        return {
          nextState,
          effects: [broadcast(side, true, dimmed)],
        };
      }

      if (kind === 'REVEALING') {
        const { side, workArea, dimmed } = state;
        const nextState: EdgeDockState = {
          kind: dockedKindFromSide(side),
          workArea,
          dimmed,
        };
        // No effects: renderer already has correct state from REVEALING entry broadcast.
        return { nextState, effects: [] };
      }

      // Unexpected ANIM_DONE in other states — guard
      return { nextState: state, effects: [] };
    }

    // -----------------------------------------------------------------------
    case 'WINDOW_MOVED': {
      const { bounds, workArea: newWorkArea } = event;

      // During animation: guard ignore (setBounds doesn't fire 'moved')
      if (kind === 'HIDING' || kind === 'REVEALING' || kind === 'HIDDEN_LEFT' || kind === 'HIDDEN_RIGHT') {
        return { nextState: state, effects: [] };
      }

      const newSide = computeDockedSide(bounds, newWorkArea, cfg.edgeThresholdPx);
      const { dimmed } = state;

      if (kind === 'DOCKED_NONE') {
        if (newSide === null) {
          // Still not docked — update workArea silently
          const nextState: EdgeDockState = { kind: 'DOCKED_NONE', workArea: newWorkArea, dimmed };
          return { nextState, effects: [] };
        }
        // Became docked
        const nextState: EdgeDockState = {
          kind: dockedKindFromSide(newSide),
          workArea: newWorkArea,
          dimmed,
        };
        return {
          nextState,
          effects: [broadcast(newSide, false, dimmed)],
        };
      }

      if (kind === 'DOCKED_LEFT' || kind === 'DOCKED_RIGHT') {
        const currentSide = sideFromKind(kind);

        if (newSide === null) {
          // Dragged off edge
          const nextState: EdgeDockState = { kind: 'DOCKED_NONE', workArea: newWorkArea, dimmed };
          return {
            nextState,
            effects: [broadcast(null, false, dimmed)],
          };
        }

        if (newSide === currentSide) {
          // Same side — update workArea silently (idempotent, e.g. taskbar resize)
          const nextState: EdgeDockState = { ...state, workArea: newWorkArea };
          return { nextState, effects: [] };
        }

        // Direct switch to opposite edge
        const nextState: EdgeDockState = {
          kind: dockedKindFromSide(newSide),
          workArea: newWorkArea,
          dimmed,
        };
        return {
          nextState,
          effects: [broadcast(newSide, false, dimmed)],
        };
      }

      return { nextState: state, effects: [] };
    }

    // -----------------------------------------------------------------------
    case 'DISPLAY_CHANGED': {
      const { workArea, offscreen } = event;

      const effects: EdgeDockEffect[] = [];

      if (state.dimmed) {
        effects.push({ type: 'CLEAR_DIM' });
      }

      if (offscreen) {
        effects.push({ type: 'SNAP_TO_CENTER', workArea, windowWidth: cfg.windowWidth });
      }

      effects.push(broadcast(null, false, false));

      const nextState: EdgeDockState = {
        kind: 'DOCKED_NONE',
        workArea,
        dimmed: false,
      };

      return { nextState, effects };
    }

    // -----------------------------------------------------------------------
    default:
      return assertNever(event);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(x)}`);
}
