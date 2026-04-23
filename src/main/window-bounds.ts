/**
 * WindowBoundsPersister — persists the BrowserWindow's `{x, y, width, height}`
 * rect across restarts with debounced writes and a startup display-validity
 * check.
 *
 * Design notes (see plan 2026-04-23-M6-settings-persistence Task 6):
 *  - Backend + screen + timer impls are injected so the module is Node-only-
 *    test-safe. No `electron` import anywhere in this file; the real wiring
 *    (Electron's `screen` module, the electron-store-backed `Rect` key, the
 *    real `setTimeout` / `clearTimeout`) is done in the main-process
 *    bootstrap (Task 8).
 *  - `loadOrDefault` implements spec §10's "if bounds aren't on any display,
 *    snap to primary center." The validity check is center-in-workArea with
 *    half-open intervals (`>=` lower bound, `<` upper bound) — a center
 *    landing exactly on a workArea's right edge belongs to the next display
 *    if one exists there. This is a startup-time guard, separate from
 *    EdgeDock's runtime `DISPLAY_CHANGED` SNAP_TO_CENTER.
 *  - `markDirty` debounces writes so a rapid sequence of `move` / `resize`
 *    events (Electron fires those at ~60Hz during drag) coalesces into a
 *    single backend write; only the final rect hits disk.
 *  - `flush` forces an immediate write and cancels any pending debounce. The
 *    main bootstrap calls it from `app.on('before-quit', ...)` so the last
 *    move before quit is never lost.
 *  - `hidden` / dock state is NOT persisted — only the physical rect.
 *    Spec §10 "a hidden-state restart must come back visible" is satisfied
 *    by never writing the hidden flag to disk (EdgeDock reducer always
 *    boots in DOCKED_NONE, M5).
 */

/** A 2D rectangle — position + size, no window state or other metadata. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowBoundsBackend {
  get(): Rect | undefined;
  set(value: Rect): void;
}

/** Shape of the Electron `screen` API we depend on. Narrowed for DI. */
export interface ScreenAdapter {
  getAllDisplays(): { workArea: Rect }[];
  getPrimaryDisplay(): { workArea: Rect };
}

export class WindowBoundsPersister {
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private latestDirty: Rect | null = null;

  constructor(
    private readonly backend: WindowBoundsBackend,
    private readonly screen: ScreenAdapter,
    private readonly setTimeoutImpl: (
      cb: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout>,
    private readonly clearTimeoutImpl: (
      h: ReturnType<typeof setTimeout>,
    ) => void,
    private readonly debounceMs = 1000,
  ) {}

  /**
   * Returns the persisted rect iff its center lies inside some display's
   * workArea; otherwise a centered default on the primary display.
   */
  loadOrDefault(defaultWidth: number, defaultHeight: number): Rect {
    const persisted = this.backend.get();
    if (persisted && this.isInsideAnyDisplay(persisted)) {
      return persisted;
    }
    return this.centerOnPrimary(defaultWidth, defaultHeight);
  }

  /**
   * Record a new dirty rect and (re)start the debounce window. Repeated calls
   * within `debounceMs` coalesce — only the latest rect is ever written.
   */
  markDirty(b: Rect): void {
    // Store BEFORE clearing the old timer: the ordering keeps the invariant
    // that `latestDirty` always mirrors the most recent caller intent, even
    // though JS has no concurrent reader (the timer callback runs on the
    // same thread after this method returns).
    this.latestDirty = b;
    if (this.dirtyTimer) this.clearTimeoutImpl(this.dirtyTimer);
    this.dirtyTimer = this.setTimeoutImpl(() => {
      if (this.latestDirty) this.backend.set(this.latestDirty);
      this.dirtyTimer = null;
    }, this.debounceMs);
  }

  /**
   * Cancel any pending debounce and write the latest dirty rect immediately.
   * Safe to call with nothing pending (both guards are no-ops).
   */
  flush(): void {
    if (this.dirtyTimer) {
      this.clearTimeoutImpl(this.dirtyTimer);
      this.dirtyTimer = null;
    }
    if (this.latestDirty) this.backend.set(this.latestDirty);
    this.latestDirty = null;
  }

  /**
   * Half-open interval test (`>=` lower, `<` upper) on each display's
   * workArea. A center landing exactly on a workArea's right/bottom edge
   * therefore belongs to the adjacent display if one is there, or to no
   * display at all if nothing is adjacent.
   */
  private isInsideAnyDisplay(b: Rect): boolean {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return this.screen.getAllDisplays().some(
      (d) =>
        cx >= d.workArea.x &&
        cx < d.workArea.x + d.workArea.width &&
        cy >= d.workArea.y &&
        cy < d.workArea.y + d.workArea.height,
    );
  }

  private centerOnPrimary(w: number, h: number): Rect {
    const pa = this.screen.getPrimaryDisplay().workArea;
    return {
      x: pa.x + Math.round((pa.width - w) / 2),
      y: pa.y + Math.round((pa.height - h) / 2),
      width: w,
      height: h,
    };
  }
}
