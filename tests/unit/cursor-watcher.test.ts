import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CursorWatcher } from '../../src/main/cursor-watcher';

const BOUNDS = { x: 0, y: 0, width: 800, height: 600 };
const INSIDE = { x: 400, y: 300 };
const OUTSIDE = { x: 9999, y: 9999 };
const DELAY = 100;
const POLL = 50;

/**
 * Helper: creates a CursorWatcher with mutable cursor/bounds.
 * cursor and bounds are held in `state` so tests can mutate them freely.
 */
function mk(opts: {
  cursor?: { x: number; y: number };
  bounds?: { x: number; y: number; width: number; height: number } | null;
  delayMs?: number;
  pollMs?: number;
}) {
  const state = {
    cursor: opts.cursor ?? { ...INSIDE },
    bounds: opts.bounds !== undefined ? opts.bounds : { ...BOUNDS },
  };
  const getCursorPoint = vi.fn(() => state.cursor);
  const getWindowBounds = vi.fn(() => state.bounds);
  const watcher = new CursorWatcher({
    getCursorPoint,
    getWindowBounds,
    settings: { delayMs: opts.delayMs ?? DELAY },
    pollMs: opts.pollMs ?? POLL,
  });
  return { watcher, getCursorPoint, getWindowBounds, state };
}

describe('CursorWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Test 1: No emit on first tick when cursor is already inside ──────────
  it('does not emit leave/enter on first tick when cursor is inside', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    const onEnter = vi.fn();
    watcher.onLeave(onLeave);
    watcher.onEnter(onEnter);

    watcher.start();
    // cursor inside — first tick just confirms isInside=true, no transition
    vi.advanceTimersByTime(POLL);

    // More ticks with cursor still inside — no events
    vi.advanceTimersByTime(POLL * 4);

    expect(onLeave).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();

    watcher.stop();
    void state; // suppress unused warning
  });

  // ── Test 2: cursor out → leave emitted after delayMs ────────────────────
  it('emits leave once after delayMs when cursor moves outside', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    watcher.start();
    // First tick: inside → no change
    vi.advanceTimersByTime(POLL);

    // Move cursor outside
    state.cursor = { ...OUTSIDE };

    // One tick fires: sees transition inside→outside, schedules leaveTimer
    vi.advanceTimersByTime(POLL);

    // Before delayMs elapses: no leave yet
    expect(onLeave).not.toHaveBeenCalled();

    // Advance by delayMs: leaveTimer fires
    vi.advanceTimersByTime(DELAY);

    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 3: cursor out-in within delayMs → no leave, no enter ───────────
  it('cancels leave if cursor returns inside before delayMs elapses', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    const onEnter = vi.fn();
    watcher.onLeave(onLeave);
    watcher.onEnter(onEnter);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Move outside
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL); // tick: inside→outside, schedules leaveTimer

    // Move back inside (before delayMs)
    state.cursor = { ...INSIDE };
    vi.advanceTimersByTime(POLL); // tick: outside→inside, cancels leaveTimer

    // Advance past delayMs — timer was cancelled, no leave should fire
    vi.advanceTimersByTime(DELAY);

    expect(onLeave).not.toHaveBeenCalled();
    // Enter must NOT fire either: leave was never emitted
    expect(onEnter).not.toHaveBeenCalled();

    watcher.stop();
  });

  // ── Test 4: leave emitted → cursor comes back → enter emitted (paired) ───
  it('emits leave then enter exactly once each when cursor leaves and returns after delay', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    const onEnter = vi.fn();
    watcher.onLeave(onLeave);
    watcher.onEnter(onEnter);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Leave window
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL); // tick: inside→outside, schedules timer
    vi.advanceTimersByTime(DELAY); // leaveTimer fires → fireLeave

    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();

    // Return inside
    state.cursor = { ...INSIDE };
    vi.advanceTimersByTime(POLL); // tick: outside→inside → fireEnter (leaveEmitted=true)

    expect(onEnter).toHaveBeenCalledTimes(1);
    // No second leave
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 5: stop() prevents subsequent cursor changes from triggering emits
  it('does not emit after stop() even when cursor changes', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    const onEnter = vi.fn();
    watcher.onLeave(onLeave);
    watcher.onEnter(onEnter);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    watcher.stop();

    // Move cursor outside: no interval running, no ticks
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL + DELAY + POLL);

    expect(onLeave).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
  });

  // ── Test 6: subscribe / unsubscribe (onLeave returns unsubscribe fn) ─────
  it('correctly adds and removes listeners via the returned unsubscribe function', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();

    const unsub = watcher.onLeave(onLeave);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Move outside and let leave fire
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL + DELAY);
    expect(onLeave).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsub();

    // Return inside and leave again
    state.cursor = { ...INSIDE };
    vi.advanceTimersByTime(POLL);
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL + DELAY);

    // Listener was removed — should still be at 1
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 7: start() is idempotent (calling twice doesn't double-fire) ────
  it('is idempotent when start() is called twice', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    watcher.start();
    watcher.start(); // second call should be no-op

    vi.advanceTimersByTime(POLL); // first tick(s)

    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL + DELAY);

    // If start() created two intervals, leave would be called twice
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 8: bounds null mid-tick → tick ignored, no state change ─────────
  it('ignores tick when getWindowBounds returns null (window destroyed)', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Simulate window destroyed
    state.bounds = null;
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL + DELAY); // bounds=null → tick ignored

    expect(onLeave).not.toHaveBeenCalled();

    watcher.stop();
  });

  // ── Test 9: fireLeave is not re-emitted if already leave-emitted ─────────
  it('does not double-emit leave via emitLeaveNow if already leave-emitted', () => {
    const { watcher } = mk({ cursor: { ...INSIDE } });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    // Use emitLeaveNow directly
    watcher.emitLeaveNow();
    expect(onLeave).toHaveBeenCalledTimes(1);

    // Second call: leaveEmitted=true → guard returns early
    watcher.emitLeaveNow();
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 10: enter not emitted if leave was never emitted ────────────────
  it('does not emit enter if leave was never emitted (emitEnterNow guard)', () => {
    const { watcher } = mk({ cursor: { ...INSIDE } });
    const onEnter = vi.fn();
    watcher.onEnter(onEnter);

    // No leave ever emitted — emitEnterNow should be a no-op
    watcher.emitEnterNow();
    expect(onEnter).not.toHaveBeenCalled();

    watcher.stop();
  });

  // ── Test 11: setDelayMs updates the delay used by the next leave ─────────
  it('setDelayMs updates the delay used by the next leave', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE }, delayMs: 100 });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Update delay live before the next leave
    watcher.setDelayMs(500);

    // Move outside; tick schedules leaveTimer with the new 500ms delay
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL); // tick: inside→outside, schedules leaveTimer at 500ms

    // After the original 100ms delay: nothing fired (timer is set for 500ms)
    vi.advanceTimersByTime(100);
    expect(onLeave).not.toHaveBeenCalled();

    // Advance the remaining 400ms to reach total 500ms
    vi.advanceTimersByTime(400);
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  // ── Test 12: setDelayMs does not affect an in-flight leaveTimer ──────────
  it('setDelayMs does not affect an in-flight leaveTimer', () => {
    const { watcher, state } = mk({ cursor: { ...INSIDE }, delayMs: 100 });
    const onLeave = vi.fn();
    watcher.onLeave(onLeave);

    watcher.start();
    vi.advanceTimersByTime(POLL); // first tick: inside

    // Move outside → leaveTimer scheduled with the original 100ms delay
    state.cursor = { ...OUTSIDE };
    vi.advanceTimersByTime(POLL); // tick: inside→outside, schedules timer at 100ms

    // Halfway through the 100ms debounce
    vi.advanceTimersByTime(50);
    expect(onLeave).not.toHaveBeenCalled();

    // Mutate delay mid-debounce — must NOT reschedule the in-flight timer
    watcher.setDelayMs(2000);

    // Advance the remaining 50ms — timer fires at the originally scheduled 100ms
    vi.advanceTimersByTime(50);
    expect(onLeave).toHaveBeenCalledTimes(1);

    watcher.stop();
  });
});
