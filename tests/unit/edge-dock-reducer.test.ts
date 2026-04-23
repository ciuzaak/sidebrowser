import { describe, it, expect } from 'vitest';
import {
  reduce,
  initialState,
  type EdgeDockConfig,
  type EdgeDockState,
  type Rect,
} from '../../src/main/edge-dock-reducer';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WA: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const WA_RIGHT: Rect = { x: 1920, y: 0, width: 1920, height: 1080 }; // second monitor

const CFG: EdgeDockConfig = {
  edgeThresholdPx: 8,
  animationMs: 200,
  triggerStripPx: 3,
  windowWidth: 393,
  enabled: true,
};

// Docked bounds fixtures
const BOUNDS_LEFT: Rect = { x: 0, y: 0, width: 393, height: 852 };       // left edge exact
const BOUNDS_RIGHT: Rect = { x: 1527, y: 0, width: 393, height: 852 };   // right edge exact (1527+393=1920)
const BOUNDS_CENTER: Rect = { x: 400, y: 0, width: 393, height: 852 };   // not docked

// State helpers
const dockedNone = (overrides?: Partial<{ workArea: Rect | null; dimmed: boolean }>): EdgeDockState => ({
  kind: 'DOCKED_NONE',
  workArea: WA,
  dimmed: false,
  ...overrides,
});

const dockedLeft = (overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'DOCKED_LEFT',
  workArea: WA,
  dimmed: false,
  ...overrides,
});

const dockedRight = (overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'DOCKED_RIGHT',
  workArea: WA,
  dimmed: false,
  ...overrides,
});

const hiding = (side: 'left' | 'right' = 'left', overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'HIDING',
  side,
  workArea: WA,
  dimmed: true,
  ...overrides,
});

const revealing = (side: 'left' | 'right' = 'left', overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'REVEALING',
  side,
  workArea: WA,
  dimmed: false,
  ...overrides,
});

const hiddenLeft = (overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'HIDDEN_LEFT',
  workArea: WA,
  dimmed: true,
  ...overrides,
});

const hiddenRight = (overrides?: Partial<{ workArea: Rect; dimmed: boolean }>): EdgeDockState => ({
  kind: 'HIDDEN_RIGHT',
  workArea: WA,
  dimmed: true,
  ...overrides,
});

// Effect lookup helpers
function hasBroadcast(
  effects: ReturnType<typeof reduce>['effects'],
  expected: { docked: 'left' | 'right' | null; hidden: boolean; dimmed: boolean },
) {
  return effects.some(
    (e) =>
      e.type === 'BROADCAST_STATE' &&
      e.docked === expected.docked &&
      e.hidden === expected.hidden &&
      e.dimmed === expected.dimmed,
  );
}

// ---------------------------------------------------------------------------
// 1. DOCKED_NONE + MOUSE_LEAVE
// ---------------------------------------------------------------------------
describe('DOCKED_NONE + MOUSE_LEAVE', () => {
  it('stays DOCKED_NONE, emits APPLY_DIM + BROADCAST(null, false, true)', () => {
    const { nextState, effects } = reduce(dockedNone(), { type: 'MOUSE_LEAVE' }, CFG);
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(true);
    expect(effects.some((e) => e.type === 'APPLY_DIM')).toBe(true);
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. DOCKED_NONE + MOUSE_ENTER (already dimmed)
// ---------------------------------------------------------------------------
describe('DOCKED_NONE + MOUSE_ENTER', () => {
  it('stays DOCKED_NONE, emits CLEAR_DIM + BROADCAST(null, false, false)', () => {
    const state = dockedNone({ dimmed: true });
    const { nextState, effects } = reduce(state, { type: 'MOUSE_ENTER' }, CFG);
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(false);
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. DOCKED_LEFT + MOUSE_LEAVE → HIDING, left targetX
// ---------------------------------------------------------------------------
describe('DOCKED_LEFT + MOUSE_LEAVE', () => {
  it('transitions to HIDING(left), APPLY_DIM + ANIM_HIDE(correct targetX) + BROADCAST', () => {
    const { nextState, effects } = reduce(dockedLeft(), { type: 'MOUSE_LEAVE' }, CFG);
    expect(nextState.kind).toBe('HIDING');
    if (nextState.kind === 'HIDING') {
      expect(nextState.side).toBe('left');
      expect(nextState.dimmed).toBe(true);
    }
    expect(effects.some((e) => e.type === 'APPLY_DIM')).toBe(true);
    const hide = effects.find((e) => e.type === 'ANIM_HIDE');
    expect(hide).toBeDefined();
    if (hide && hide.type === 'ANIM_HIDE') {
      expect(hide.side).toBe('left');
      // targetX = workArea.x - windowWidth + triggerStripPx = 0 - 393 + 3 = -390
      expect(hide.targetX).toBe(0 - 393 + 3);
      expect(hide.ms).toBe(CFG.animationMs);
    }
    expect(hasBroadcast(effects, { docked: 'left', hidden: false, dimmed: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. DOCKED_RIGHT + MOUSE_LEAVE → HIDING, right targetX
// ---------------------------------------------------------------------------
describe('DOCKED_RIGHT + MOUSE_LEAVE', () => {
  it('transitions to HIDING(right), ANIM_HIDE targetX = workArea.x + workArea.width - triggerStripPx', () => {
    const { nextState, effects } = reduce(dockedRight(), { type: 'MOUSE_LEAVE' }, CFG);
    expect(nextState.kind).toBe('HIDING');
    if (nextState.kind === 'HIDING') expect(nextState.side).toBe('right');
    const hide = effects.find((e) => e.type === 'ANIM_HIDE');
    if (hide && hide.type === 'ANIM_HIDE') {
      // targetX = 0 + 1920 - 3 = 1917
      expect(hide.targetX).toBe(0 + 1920 - 3);
      expect(hide.side).toBe('right');
    }
    expect(hasBroadcast(effects, { docked: 'right', hidden: false, dimmed: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. DOCKED_LEFT + MOUSE_ENTER
// ---------------------------------------------------------------------------
describe('DOCKED_LEFT + MOUSE_ENTER', () => {
  it('stays DOCKED_LEFT, emits CLEAR_DIM + BROADCAST(left, false, false)', () => {
    const { nextState, effects } = reduce(dockedLeft({ dimmed: true }), { type: 'MOUSE_ENTER' }, CFG);
    expect(nextState.kind).toBe('DOCKED_LEFT');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(false);
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    expect(hasBroadcast(effects, { docked: 'left', hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. HIDING + ANIM_DONE → HIDDEN_*
// ---------------------------------------------------------------------------
describe('HIDING + ANIM_DONE', () => {
  it('HIDING(left) → HIDDEN_LEFT, BROADCAST(left, true, true)', () => {
    const { nextState, effects } = reduce(hiding('left'), { type: 'ANIM_DONE' }, CFG);
    expect(nextState.kind).toBe('HIDDEN_LEFT');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(true);
    expect(hasBroadcast(effects, { docked: 'left', hidden: true, dimmed: true })).toBe(true);
  });

  it('HIDING(right) → HIDDEN_RIGHT', () => {
    const { nextState } = reduce(hiding('right'), { type: 'ANIM_DONE' }, CFG);
    expect(nextState.kind).toBe('HIDDEN_RIGHT');
  });
});

// ---------------------------------------------------------------------------
// 7. HIDING + MOUSE_ENTER → REVEALING (cancel + reveal)
// ---------------------------------------------------------------------------
describe('HIDING + MOUSE_ENTER', () => {
  it('transitions to REVEALING(left), emits ANIM_CANCEL + CLEAR_DIM + ANIM_REVEAL(correct targetX) + BROADCAST', () => {
    const { nextState, effects } = reduce(hiding('left'), { type: 'MOUSE_ENTER' }, CFG);
    expect(nextState.kind).toBe('REVEALING');
    if (nextState.kind === 'REVEALING') {
      expect(nextState.side).toBe('left');
      expect(nextState.dimmed).toBe(false);
    }
    expect(effects.some((e) => e.type === 'ANIM_CANCEL')).toBe(true);
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    const reveal = effects.find((e) => e.type === 'ANIM_REVEAL');
    expect(reveal).toBeDefined();
    if (reveal && reveal.type === 'ANIM_REVEAL') {
      expect(reveal.side).toBe('left');
      // targetX = workArea.x = 0
      expect(reveal.targetX).toBe(0);
      expect(reveal.ms).toBe(CFG.animationMs);
    }
    expect(hasBroadcast(effects, { docked: 'left', hidden: false, dimmed: false })).toBe(true);
  });

  it('HIDING(right) + MOUSE_ENTER: ANIM_REVEAL targetX = workArea.x + workArea.width - windowWidth', () => {
    const { effects } = reduce(hiding('right'), { type: 'MOUSE_ENTER' }, CFG);
    const reveal = effects.find((e) => e.type === 'ANIM_REVEAL');
    if (reveal && reveal.type === 'ANIM_REVEAL') {
      // targetX = 0 + 1920 - 393 = 1527
      expect(reveal.targetX).toBe(0 + 1920 - 393);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. HIDDEN_RIGHT + MOUSE_ENTER → REVEALING(right)
// ---------------------------------------------------------------------------
describe('HIDDEN_RIGHT + MOUSE_ENTER', () => {
  it('transitions to REVEALING(right), CLEAR_DIM + ANIM_REVEAL(correct targetX) + BROADCAST', () => {
    const { nextState, effects } = reduce(hiddenRight(), { type: 'MOUSE_ENTER' }, CFG);
    expect(nextState.kind).toBe('REVEALING');
    if (nextState.kind === 'REVEALING') expect(nextState.side).toBe('right');
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    const reveal = effects.find((e) => e.type === 'ANIM_REVEAL');
    expect(reveal).toBeDefined();
    if (reveal && reveal.type === 'ANIM_REVEAL') {
      expect(reveal.side).toBe('right');
      expect(reveal.targetX).toBe(0 + 1920 - 393);
    }
    expect(hasBroadcast(effects, { docked: 'right', hidden: false, dimmed: false })).toBe(true);
  });

  it('HIDDEN_LEFT + MOUSE_ENTER: ANIM_REVEAL targetX = workArea.x', () => {
    const { effects } = reduce(hiddenLeft(), { type: 'MOUSE_ENTER' }, CFG);
    const reveal = effects.find((e) => e.type === 'ANIM_REVEAL');
    if (reveal && reveal.type === 'ANIM_REVEAL') {
      expect(reveal.targetX).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. REVEALING + ANIM_DONE → DOCKED_*, no effects
// ---------------------------------------------------------------------------
describe('REVEALING + ANIM_DONE', () => {
  it('REVEALING(left) → DOCKED_LEFT, no effects emitted', () => {
    const { nextState, effects } = reduce(revealing('left'), { type: 'ANIM_DONE' }, CFG);
    expect(nextState.kind).toBe('DOCKED_LEFT');
    expect(effects).toHaveLength(0);
  });

  it('REVEALING(right) → DOCKED_RIGHT', () => {
    const { nextState } = reduce(revealing('right'), { type: 'ANIM_DONE' }, CFG);
    expect(nextState.kind).toBe('DOCKED_RIGHT');
  });
});

// ---------------------------------------------------------------------------
// 10. REVEALING + MOUSE_LEAVE → no-op (spec §10)
// ---------------------------------------------------------------------------
describe('REVEALING + MOUSE_LEAVE', () => {
  it('is a no-op — stays REVEALING with empty effects', () => {
    const state = revealing('left');
    const { nextState, effects } = reduce(state, { type: 'MOUSE_LEAVE' }, CFG);
    expect(nextState).toEqual(state);
    expect(effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. DOCKED_LEFT + WINDOW_MOVED (off edge) → DOCKED_NONE
// ---------------------------------------------------------------------------
describe('DOCKED_LEFT + WINDOW_MOVED off edge', () => {
  it('transitions to DOCKED_NONE, BROADCAST(null, false, current dimmed)', () => {
    const state = dockedLeft({ dimmed: true });
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_CENTER, workArea: WA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(true);
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. DOCKED_NONE + WINDOW_MOVED (on left edge) → DOCKED_LEFT
// ---------------------------------------------------------------------------
describe('DOCKED_NONE + WINDOW_MOVED on left edge', () => {
  it('transitions to DOCKED_LEFT, BROADCAST(left, false, current dimmed)', () => {
    const state = dockedNone({ dimmed: false });
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_LEFT, workArea: WA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_LEFT');
    expect(hasBroadcast(effects, { docked: 'left', hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. DOCKED_LEFT + WINDOW_MOVED (still left) → no effects, workArea updated
// ---------------------------------------------------------------------------
describe('DOCKED_LEFT + WINDOW_MOVED still left edge (idempotent)', () => {
  it('stays DOCKED_LEFT, no effects, but workArea updated in state', () => {
    const newWA: Rect = { x: 0, y: 0, width: 1920, height: 1040 }; // taskbar resized
    const { nextState, effects } = reduce(
      dockedLeft(),
      { type: 'WINDOW_MOVED', bounds: BOUNDS_LEFT, workArea: newWA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_LEFT');
    expect(effects).toHaveLength(0);
    if (nextState.kind === 'DOCKED_LEFT') {
      expect(nextState.workArea).toEqual(newWA);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. DOCKED_LEFT + WINDOW_MOVED → now right edge (direct switch)
// ---------------------------------------------------------------------------
describe('DOCKED_LEFT + WINDOW_MOVED now right edge', () => {
  it('directly switches to DOCKED_RIGHT, BROADCAST(right, false, current dimmed)', () => {
    const { nextState, effects } = reduce(
      dockedLeft(),
      { type: 'WINDOW_MOVED', bounds: BOUNDS_RIGHT, workArea: WA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_RIGHT');
    expect(hasBroadcast(effects, { docked: 'right', hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. HIDING + WINDOW_MOVED → no-op (guard)
// ---------------------------------------------------------------------------
describe('HIDING + WINDOW_MOVED', () => {
  it('is a no-op — state unchanged, no effects', () => {
    const state = hiding('left');
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_CENTER, workArea: WA },
      CFG,
    );
    expect(nextState).toEqual(state);
    expect(effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 16. HIDDEN_LEFT + WINDOW_MOVED → no-op (guard)
// ---------------------------------------------------------------------------
describe('HIDDEN_LEFT + WINDOW_MOVED', () => {
  it('is a no-op', () => {
    const state = hiddenLeft();
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_CENTER, workArea: WA },
      CFG,
    );
    expect(nextState).toEqual(state);
    expect(effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 17. DOCKED_LEFT (dimmed) + DISPLAY_CHANGED (onscreen)
// ---------------------------------------------------------------------------
describe('DISPLAY_CHANGED onscreen', () => {
  it('DOCKED_LEFT (dimmed=true) → DOCKED_NONE, CLEAR_DIM + BROADCAST(null, false, false)', () => {
    const { nextState, effects } = reduce(
      dockedLeft({ dimmed: true }),
      { type: 'DISPLAY_CHANGED', bounds: BOUNDS_LEFT, workArea: WA, offscreen: false },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect((nextState as { dimmed: boolean }).dimmed).toBe(false);
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: false })).toBe(true);
    expect(effects.some((e) => e.type === 'SNAP_TO_CENTER')).toBe(false);
  });

  it('DOCKED_LEFT (dimmed=false) + DISPLAY_CHANGED (onscreen) → no CLEAR_DIM, only BROADCAST', () => {
    const { effects } = reduce(
      dockedLeft({ dimmed: false }),
      { type: 'DISPLAY_CHANGED', bounds: BOUNDS_LEFT, workArea: WA, offscreen: false },
      CFG,
    );
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(false);
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18 & 19. DISPLAY_CHANGED offscreen → SNAP_TO_CENTER
// ---------------------------------------------------------------------------
describe('DISPLAY_CHANGED offscreen', () => {
  it('HIDDEN_RIGHT + DISPLAY_CHANGED(offscreen=true) → DOCKED_NONE, CLEAR_DIM + SNAP_TO_CENTER + BROADCAST', () => {
    const { nextState, effects } = reduce(
      hiddenRight(),
      { type: 'DISPLAY_CHANGED', bounds: { x: -5000, y: 0, width: 393, height: 852 }, workArea: WA, offscreen: true },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect(effects.some((e) => e.type === 'CLEAR_DIM')).toBe(true);
    const snap = effects.find((e) => e.type === 'SNAP_TO_CENTER');
    expect(snap).toBeDefined();
    if (snap && snap.type === 'SNAP_TO_CENTER') {
      expect(snap.workArea).toEqual(WA);
      expect(snap.windowWidth).toBe(CFG.windowWidth);
    }
    expect(hasBroadcast(effects, { docked: null, hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 20. cfg.enabled = false → all events are no-ops
// ---------------------------------------------------------------------------
describe('cfg.enabled = false', () => {
  const disabledCfg = { ...CFG, enabled: false };

  it('MOUSE_LEAVE is no-op', () => {
    const state = dockedNone();
    const { nextState, effects } = reduce(state, { type: 'MOUSE_LEAVE' }, disabledCfg);
    expect(nextState).toBe(state);
    expect(effects).toHaveLength(0);
  });

  it('MOUSE_ENTER is no-op', () => {
    const state = dockedLeft();
    const { nextState, effects } = reduce(state, { type: 'MOUSE_ENTER' }, disabledCfg);
    expect(nextState).toBe(state);
    expect(effects).toHaveLength(0);
  });

  it('WINDOW_MOVED is no-op', () => {
    const state = dockedLeft();
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_CENTER, workArea: WA },
      disabledCfg,
    );
    expect(nextState).toBe(state);
    expect(effects).toHaveLength(0);
  });

  it('ANIM_DONE is no-op', () => {
    const state = hiding('left');
    const { nextState, effects } = reduce(state, { type: 'ANIM_DONE' }, disabledCfg);
    expect(nextState).toBe(state);
    expect(effects).toHaveLength(0);
  });

  it('DISPLAY_CHANGED is no-op', () => {
    const state = dockedLeft();
    const { nextState, effects } = reduce(
      state,
      { type: 'DISPLAY_CHANGED', bounds: BOUNDS_LEFT, workArea: WA, offscreen: false },
      disabledCfg,
    );
    expect(nextState).toBe(state);
    expect(effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 21. Initial state (workArea=null) + WINDOW_MOVED → classifies side
// ---------------------------------------------------------------------------
describe('initialState + WINDOW_MOVED', () => {
  it('workArea=null initial state becomes DOCKED_LEFT when bounds on left edge', () => {
    const state = initialState(); // { kind: 'DOCKED_NONE', workArea: null, dimmed: false }
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_LEFT, workArea: WA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_LEFT');
    expect(hasBroadcast(effects, { docked: 'left', hidden: false, dimmed: false })).toBe(true);
  });

  it('workArea=null initial state stays DOCKED_NONE when bounds not near edge, no effects', () => {
    const state = initialState();
    const { nextState, effects } = reduce(
      state,
      { type: 'WINDOW_MOVED', bounds: BOUNDS_CENTER, workArea: WA },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_NONE');
    expect(effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 22. DOCKED_NONE + WINDOW_MOVED on right edge (multi-monitor) → DOCKED_RIGHT
// ---------------------------------------------------------------------------
describe('DOCKED_NONE + WINDOW_MOVED on right edge of secondary monitor', () => {
  it('classifies as DOCKED_RIGHT when bounds align to right edge of secondary workArea', () => {
    // On second monitor: workArea.x=1920, width=1920
    // Docked-right bounds: x = 1920 + 1920 - 393 = 3447
    const boundsRightSecondary: Rect = { x: 3447, y: 0, width: 393, height: 852 };
    const { nextState, effects } = reduce(
      dockedNone({ workArea: WA_RIGHT }),
      { type: 'WINDOW_MOVED', bounds: boundsRightSecondary, workArea: WA_RIGHT },
      CFG,
    );
    expect(nextState.kind).toBe('DOCKED_RIGHT');
    expect(hasBroadcast(effects, { docked: 'right', hidden: false, dimmed: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 23. REVEALING + MOUSE_ENTER is no-op (idempotent)
// ---------------------------------------------------------------------------
describe('REVEALING + MOUSE_ENTER', () => {
  it('is a no-op when already revealing', () => {
    const state = revealing('right');
    const { nextState, effects } = reduce(state, { type: 'MOUSE_ENTER' }, CFG);
    expect(nextState).toEqual(state);
    expect(effects).toHaveLength(0);
  });
});
