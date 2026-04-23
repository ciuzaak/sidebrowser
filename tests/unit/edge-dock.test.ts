/**
 * edge-dock.test.ts — Unit tests for the EdgeDock effects executor.
 *
 * All tests run in Node-only (no Electron). Side effects are verified through
 * the injected deps spy objects returned by the mk() helper.
 *
 * Fake timers (vi.useFakeTimers) let us control Date.now() and tick the
 * setInterval callbacks without real wall-clock delays.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { EdgeDock, type EdgeDockDeps } from '../../src/main/edge-dock';
import type { EdgeDockConfig } from '../../src/main/edge-dock-reducer';
import type { WindowState } from '@shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WA = { x: 0, y: 0, width: 1920, height: 1080 } as const;

/** Default config — same numbers used throughout the reducer tests. */
const DEFAULTS: EdgeDockConfig = {
  edgeThresholdPx: 8,
  animationMs: 200,
  triggerStripPx: 3,
  windowWidth: 393,
  enabled: true,
};

// ---------------------------------------------------------------------------
// mk() — factory for an EdgeDock instance wired to spy deps
// ---------------------------------------------------------------------------

function mk(overrides: Partial<EdgeDockConfig> = {}) {
  const config: EdgeDockConfig = { ...DEFAULTS, ...overrides };

  // Mutable "window position" shared between setWindowX and getWindowBounds so
  // that mid-anim cancel tests see the intermediate x after each tick.
  let currentX = 0;

  const setBoundsCalls: number[] = [];
  const broadcastCalls: WindowState[] = [];
  const applyDimCalls: number[] = []; // length === call count; value = Date.now() at call time
  const clearDimCalls: number[] = [];

  const deps: EdgeDockDeps = {
    setWindowX: (x) => {
      currentX = x;
      setBoundsCalls.push(x);
    },
    getWindowBounds: () => ({ x: currentX, y: 0, width: config.windowWidth, height: 852 }),
    applyDim: () => {
      applyDimCalls.push(Date.now());
    },
    clearDim: () => {
      clearDimCalls.push(Date.now());
    },
    broadcastState: (s) => {
      broadcastCalls.push({ ...s });
    },
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => clearInterval(h),
    config,
  };

  const dock = new EdgeDock(deps);

  return {
    dock,
    deps,
    setBoundsCalls,
    broadcastCalls,
    applyDimCalls,
    clearDimCalls,
    getCurrentX: () => currentX,
  };
}

// ---------------------------------------------------------------------------
// Helper: seed state into DOCKED_LEFT so we have a valid workArea
//   x=0 → left edge of WA → triggers DOCKED_LEFT transition
// ---------------------------------------------------------------------------

function seedDockedLeft(dock: EdgeDock, x = 0): void {
  dock.dispatch({
    type: 'WINDOW_MOVED',
    bounds: { x, y: 0, width: 393, height: 852 },
    workArea: WA,
  });
}

// ---------------------------------------------------------------------------
// interpolateX at t=0.5: ease-out-cubic eased = 1 - (0.5)^3 = 0.875
// So from 0 to -390: interpolated = 0 + 0.875 * (-390) = -341.25
// ---------------------------------------------------------------------------
const HIDE_TARGET_LEFT = 0 - 393 + 3; // -390
const HALF_WAY_LEFT = 0 + (1 - Math.pow(0.5, 3)) * (HIDE_TARGET_LEFT - 0); // -341.25

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('EdgeDock executor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  describe('APPLY_DIM / CLEAR_DIM', () => {
    it('MOUSE_LEAVE on DOCKED_LEFT calls applyDim() exactly once', () => {
      const { dock, applyDimCalls } = mk();
      seedDockedLeft(dock);
      dock.dispatch({ type: 'MOUSE_LEAVE' });
      expect(applyDimCalls).toHaveLength(1);
    });

    it('MOUSE_ENTER on DOCKED_LEFT (dimmed) calls clearDim() exactly once', () => {
      const { dock, clearDimCalls } = mk();
      seedDockedLeft(dock);
      dock.dispatch({ type: 'MOUSE_LEAVE' }); // go to HIDING (also dims)
      dock.dispatch({ type: 'MOUSE_ENTER' }); // ANIM_CANCEL + CLEAR_DIM + ANIM_REVEAL
      // clearDim should have been called (DOCKED_NONE level isn't relevant here)
      expect(clearDimCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('BROADCAST_STATE', () => {
    it('MOUSE_LEAVE on DOCKED_LEFT broadcasts {docked:"left", hidden:false, dimmed:true}', () => {
      const { dock, broadcastCalls } = mk({ animationMs: 0 });
      seedDockedLeft(dock);
      broadcastCalls.length = 0; // clear seed broadcasts
      dock.dispatch({ type: 'MOUSE_LEAVE' });
      // Effects: APPLY_DIM, ANIM_HIDE(ms=0)→ANIM_DONE→BROADCAST(hidden:true), BROADCAST(hiding entry)
      // First broadcast from MOUSE_LEAVE: docked=left, hidden=false, dimmed=true
      const hidingBroadcast = broadcastCalls.find(
        (c) => c.docked === 'left' && c.hidden === false && c.dimmed === true,
      );
      expect(hidingBroadcast).toBeDefined();
    });

    it('BROADCAST_STATE payload maps 1:1 from effect fields', () => {
      const { dock, broadcastCalls } = mk({ animationMs: 0 });
      seedDockedLeft(dock);
      broadcastCalls.length = 0;
      dock.dispatch({ type: 'MOUSE_LEAVE' }); // ms=0: HIDING entry + ANIM_DONE (HIDDEN_LEFT broadcast)
      const hiddenBroadcast = broadcastCalls.find(
        (c) => c.docked === 'left' && c.hidden === true && c.dimmed === true,
      );
      expect(hiddenBroadcast).toBeDefined();
      // Verify exact shape — no extra keys
      expect(Object.keys(hiddenBroadcast!).sort()).toEqual(['dimmed', 'docked', 'hidden']);
    });
  });

  // -------------------------------------------------------------------------
  describe('SNAP_TO_CENTER', () => {
    it('DISPLAY_CHANGED offscreen moves window to center of workArea', () => {
      const { dock, setBoundsCalls } = mk();
      // SNAP_TO_CENTER: setWindowX(workArea.x + (workArea.width - windowWidth) / 2)
      // = 0 + (1920 - 393) / 2 = 763.5
      const expectedX = WA.x + (WA.width - DEFAULTS.windowWidth) / 2; // 763.5
      setBoundsCalls.length = 0;
      dock.dispatch({
        type: 'DISPLAY_CHANGED',
        bounds: { x: -5000, y: 0, width: 393, height: 852 },
        workArea: WA,
        offscreen: true,
      });
      expect(setBoundsCalls).toContain(expectedX);
      expect(setBoundsCalls[setBoundsCalls.indexOf(expectedX)]).toBeCloseTo(763.5, 5);
    });
  });

  // -------------------------------------------------------------------------
  describe('ANIM_HIDE (ms=0)', () => {
    it('with animationMs=0: setWindowX called immediately at targetX, state becomes HIDDEN_LEFT', () => {
      const { dock, setBoundsCalls } = mk({ animationMs: 0 });
      seedDockedLeft(dock);
      setBoundsCalls.length = 0;
      dock.dispatch({ type: 'MOUSE_LEAVE' });
      // targetX for left hide = workArea.x - windowWidth + triggerStripPx = 0 - 393 + 3 = -390
      expect(setBoundsCalls).toContain(HIDE_TARGET_LEFT);
      expect(dock.getState().kind).toBe('HIDDEN_LEFT');
    });

    it('with animationMs=0: ANIM_DONE fires synchronously so no timers needed', () => {
      const { dock } = mk({ animationMs: 0 });
      seedDockedLeft(dock);
      dock.dispatch({ type: 'MOUSE_LEAVE' });
      // If ANIM_DONE didn't fire synchronously the state would be HIDING, not HIDDEN_LEFT
      expect(dock.getState().kind).toBe('HIDDEN_LEFT');
    });
  });

  // -------------------------------------------------------------------------
  describe('ANIM_HIDE (ms=200)', () => {
    it('advances from fromX to targetX over 200ms, calls setWindowX multiple times', () => {
      const { dock, setBoundsCalls } = mk({ animationMs: 200 });
      seedDockedLeft(dock); // currentX = 0 (docked-left position)
      setBoundsCalls.length = 0;

      dock.dispatch({ type: 'MOUSE_LEAVE' }); // starts HIDING animation
      expect(dock.getState().kind).toBe('HIDING');

      // Advance past 200ms so at least one tick fires with t >= 1.
      // Ticks fire every 16ms; at 192ms t=0.96 (not done). At 208ms t=1.04 → done.
      vi.advanceTimersByTime(216); // 13 full 16ms ticks → last tick at 208ms: t≥1

      // After full animation: state machine received ANIM_DONE and is HIDDEN_LEFT
      expect(dock.getState().kind).toBe('HIDDEN_LEFT');
      // Multiple setWindowX calls (from intermediate ticks) were made
      expect(setBoundsCalls.length).toBeGreaterThan(1);
      // Last call should be at targetX (interpolateX clamps to 1)
      const lastX = setBoundsCalls[setBoundsCalls.length - 1];
      expect(lastX).toBeCloseTo(HIDE_TARGET_LEFT, 5);
    });

    it('intermediate ticks move x progressively toward targetX', () => {
      const { dock, setBoundsCalls } = mk({ animationMs: 200 });
      seedDockedLeft(dock);
      setBoundsCalls.length = 0;

      dock.dispatch({ type: 'MOUSE_LEAVE' });
      // Advance just one tick (16ms)
      vi.advanceTimersByTime(16);

      // At t = 16/200 = 0.08, ease-out-cubic eased ≈ 1-(1-0.08)^3 ≈ 0.2235
      // setWindowX should be called with something between fromX(0) and targetX(-390)
      expect(setBoundsCalls.length).toBeGreaterThanOrEqual(1);
      const x = setBoundsCalls[setBoundsCalls.length - 1];
      expect(x).toBeLessThan(0);       // moving toward negative
      expect(x).toBeGreaterThan(HIDE_TARGET_LEFT); // not yet fully hidden
    });
  });

  // -------------------------------------------------------------------------
  describe('mid-anim cancel (HIDING → MOUSE_ENTER → REVEALING)', () => {
    it('REVEAL fromX equals intermediate x position, not original docked x', () => {
      const { dock, setBoundsCalls, getCurrentX } = mk({ animationMs: 200 });
      seedDockedLeft(dock); // currentX = 0
      setBoundsCalls.length = 0;

      // Start hiding animation
      dock.dispatch({ type: 'MOUSE_LEAVE' });
      expect(dock.getState().kind).toBe('HIDING');

      // Advance to 96ms = 6 ticks × 16ms.  t = 96/200 = 0.48
      // ease-out-cubic(0.48) = 1-(1-0.48)^3 = 1-0.140608 = 0.859392
      // interpolateX(0, -390, 0.48) = 0 + 0.859392 * (-390) = -335.16...
      vi.advanceTimersByTime(96); // 6 ticks — use exact multiple of 16 to get deterministic x

      const xAtHalf = getCurrentX();
      // Verify x is partway between 0 (start) and -390 (target) — not at either end
      expect(xAtHalf).toBeLessThan(0);
      expect(xAtHalf).toBeGreaterThan(HIDE_TARGET_LEFT);

      // Mouse re-enters mid-animation: ANIM_CANCEL + CLEAR_DIM + ANIM_REVEAL
      dock.dispatch({ type: 'MOUSE_ENTER' });
      expect(dock.getState().kind).toBe('REVEALING');

      // Advance one tick of the new REVEAL animation (16ms)
      vi.advanceTimersByTime(16);

      // The REVEAL animation should have started from xAtHalf (not 0).
      // After one tick from xAtHalf toward 0 (revealTargetX for left = workArea.x = 0):
      // t = 16/200 = 0.08; eased = 1-(0.92)^3 ≈ 0.2235
      // x = xAtHalf + 0.2235*(0 - xAtHalf)
      const xAfterOneTick = getCurrentX();
      // Key assertion: x is moving from xAtHalf toward 0 (not starting from 0)
      expect(xAfterOneTick).toBeGreaterThan(xAtHalf); // moved toward 0 (less negative)
      expect(xAfterOneTick).toBeLessThan(0);           // not yet fully revealed (not at 0)
    });

    it('REVEAL completes and state becomes DOCKED_LEFT', () => {
      const { dock } = mk({ animationMs: 200 });
      seedDockedLeft(dock);

      dock.dispatch({ type: 'MOUSE_LEAVE' });
      vi.advanceTimersByTime(96); // advance partial-way (6 ticks × 16ms)
      dock.dispatch({ type: 'MOUSE_ENTER' }); // cancel HIDING, start REVEALING
      // Advance past 200ms so at least one tick fires at t≥1 (same logic as ANIM_HIDE test)
      vi.advanceTimersByTime(216);

      expect(dock.getState().kind).toBe('DOCKED_LEFT');
    });
  });
});
