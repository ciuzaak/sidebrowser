import { describe, it, expect, vi } from 'vitest';
import {
  WindowBoundsPersister,
  type Rect,
  type ScreenAdapter,
  type WindowBoundsBackend,
} from '../../src/main/window-bounds';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeBackend extends WindowBoundsBackend {
  /** Number of times `set()` has been called. */
  setCount: number;
  /** Argument of the most recent `set()` call (structurally cloned). */
  lastSet: Rect | undefined;
}

/**
 * In-memory backend with a call counter. `data` may be `undefined` (empty
 * backend → loadOrDefault should fall back to the primary-centered default).
 * Clones values on the way in/out so assertions on `lastSet` survive later
 * mutations by the caller.
 */
function createFakeBackend(initial?: Rect): FakeBackend {
  let data: Rect | undefined = initial ? { ...initial } : undefined;
  const backend: FakeBackend = {
    setCount: 0,
    lastSet: undefined,
    get: () => (data === undefined ? undefined : { ...data }),
    set: (value: Rect): void => {
      data = { ...value };
      backend.lastSet = { ...value };
      backend.setCount += 1;
    },
  };
  return backend;
}

/**
 * Fake `ScreenAdapter` with a configurable display list. Defaults the primary
 * display to `displays[0]` when `primaryIndex` is not provided.
 */
function createFakeScreen(
  displays: { workArea: Rect }[],
  primaryIndex = 0,
): ScreenAdapter {
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[primaryIndex]!,
  };
}

/** Standard single-display screen mimicking a 1920×1080 monitor at origin. */
const singleDisplayScreen = (): ScreenAdapter =>
  createFakeScreen([{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]);

/** Construct a persister that routes timers through globalThis so Vitest's
 * fake timers (installed via `vi.useFakeTimers()`) control them. */
function createPersister(
  backend: WindowBoundsBackend,
  screen: ScreenAdapter,
  debounceMs?: number,
): WindowBoundsPersister {
  return new WindowBoundsPersister(
    backend,
    screen,
    (cb, ms) => setTimeout(cb, ms),
    (h) => clearTimeout(h),
    debounceMs,
  );
}

describe('WindowBoundsPersister', () => {
  it('loadOrDefault returns a primary-centered Rect when the backend is empty', () => {
    const backend = createFakeBackend();
    const screen = singleDisplayScreen();
    const persister = createPersister(backend, screen);

    const rect = persister.loadOrDefault(393, 852);

    expect(rect).toEqual({
      x: 0 + Math.round((1920 - 393) / 2),
      y: 0 + Math.round((1080 - 852) / 2),
      width: 393,
      height: 852,
    });
  });

  it('loadOrDefault returns the persisted rect as-is when its center is inside the primary display', () => {
    const persisted: Rect = { x: 100, y: 100, width: 400, height: 800 };
    const backend = createFakeBackend(persisted);
    const persister = createPersister(backend, singleDisplayScreen());

    expect(persister.loadOrDefault(393, 852)).toEqual(persisted);
  });

  it('loadOrDefault falls back to primary-centered when the persisted rect center is off-screen', () => {
    // Center at (-4950, 50) — nowhere near the single 1920×1080 display.
    const persisted: Rect = { x: -5000, y: 0, width: 100, height: 100 };
    const backend = createFakeBackend(persisted);
    const persister = createPersister(backend, singleDisplayScreen());

    expect(persister.loadOrDefault(393, 852)).toEqual({
      x: Math.round((1920 - 393) / 2),
      y: Math.round((1080 - 852) / 2),
      width: 393,
      height: 852,
    });
  });

  it('markDirty debounces a single write after debounceMs elapses', () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeBackend();
      const persister = createPersister(backend, singleDisplayScreen());
      const rect: Rect = { x: 10, y: 20, width: 393, height: 852 };

      persister.markDirty(rect);
      // Before the debounce elapses, nothing is written.
      expect(backend.setCount).toBe(0);

      vi.advanceTimersByTime(1000);

      expect(backend.setCount).toBe(1);
      expect(backend.lastSet).toEqual(rect);
    } finally {
      vi.useRealTimers();
    }
  });

  it('markDirty coalesces rapid-fire calls and writes only the latest value', () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeBackend();
      const persister = createPersister(backend, singleDisplayScreen());
      const r1: Rect = { x: 0, y: 0, width: 393, height: 852 };
      const r2: Rect = { x: 50, y: 0, width: 393, height: 852 };
      const r3: Rect = { x: 100, y: 0, width: 393, height: 852 };

      persister.markDirty(r1);
      vi.advanceTimersByTime(200);
      persister.markDirty(r2);
      vi.advanceTimersByTime(200);
      persister.markDirty(r3);
      expect(backend.setCount).toBe(0);

      // Advance past the last markDirty's debounce window.
      vi.advanceTimersByTime(1000);

      expect(backend.setCount).toBe(1);
      expect(backend.lastSet).toEqual(r3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush writes immediately, clears the pending timer, and prevents later fires', () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeBackend();
      const persister = createPersister(backend, singleDisplayScreen());
      const rect: Rect = { x: 10, y: 20, width: 393, height: 852 };

      persister.markDirty(rect);
      persister.flush();

      expect(backend.setCount).toBe(1);
      expect(backend.lastSet).toEqual(rect);

      // The debounce timer must be cancelled — further time does NOT trigger
      // another write.
      vi.advanceTimersByTime(1000);
      expect(backend.setCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadOrDefault returns the persisted rect when its center is inside a non-primary display', () => {
    // Two 1920×1080 displays laid out side-by-side. Primary = displays[0].
    const screen = createFakeScreen([
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ]);
    // Center at (2500, 500) — inside the secondary display.
    const persisted: Rect = { x: 2300, y: 400, width: 400, height: 200 };
    const backend = createFakeBackend(persisted);
    const persister = createPersister(backend, screen);

    expect(persister.loadOrDefault(393, 852)).toEqual(persisted);
  });

  it('flush with no pending dirty state is a no-op', () => {
    const backend = createFakeBackend();
    const persister = createPersister(backend, singleDisplayScreen());

    persister.flush();

    expect(backend.setCount).toBe(0);
    expect(backend.lastSet).toBeUndefined();
  });

  it('markDirty with debounceMs=0 still schedules asynchronously (not synchronous)', () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeBackend();
      const persister = createPersister(backend, singleDisplayScreen(), 0);
      const rect: Rect = { x: 10, y: 20, width: 393, height: 852 };

      persister.markDirty(rect);
      // A `setTimeout(cb, 0)` is still a macrotask — must not fire
      // synchronously within markDirty().
      expect(backend.setCount).toBe(0);

      vi.advanceTimersByTime(0);

      expect(backend.setCount).toBe(1);
      expect(backend.lastSet).toEqual(rect);
    } finally {
      vi.useRealTimers();
    }
  });
});
