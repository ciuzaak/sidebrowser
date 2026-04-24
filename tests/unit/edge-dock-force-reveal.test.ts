import { describe, it, expect, vi } from 'vitest';
import { EdgeDock } from '@main/edge-dock';

function makeDeps(overrides = {}) {
  return {
    setWindowX: vi.fn(),
    getWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 393, height: 852 })),
    applyDim: vi.fn(),
    clearDim: vi.fn(),
    broadcastState: vi.fn(),
    now: vi.fn(() => 0),
    setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
    clearInterval: vi.fn(),
    config: () => ({
      edgeThresholdPx: 8, animationMs: 0, triggerStripPx: 3, windowWidth: 393, enabled: true,
    }),
    ...overrides,
  };
}

describe('EdgeDock.forceRevealIfHidden', () => {
  it('no-op in DOCKED_NONE', () => {
    const deps = makeDeps();
    const dock = new EdgeDock(deps);
    dock.forceRevealIfHidden();
    expect(deps.broadcastState).not.toHaveBeenCalled();
  });

  it('drives reveal when HIDDEN_LEFT', () => {
    const deps = makeDeps();
    const dock = new EdgeDock(deps);
    // Drive into HIDDEN_LEFT: WINDOW_MOVED flush-left + MOUSE_LEAVE + ANIM_DONE
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    dock.dispatch({ type: 'WINDOW_MOVED', bounds: { x: 0, y: 0, width: 393, height: 852 }, workArea });
    dock.dispatch({ type: 'MOUSE_LEAVE' });
    dock.dispatch({ type: 'ANIM_DONE' });
    expect(dock.getState().kind).toBe('HIDDEN_LEFT');
    deps.broadcastState.mockClear();
    dock.forceRevealIfHidden();
    expect(['REVEALING', 'DOCKED_LEFT']).toContain(dock.getState().kind);
  });

  it('drives reveal when HIDDEN_RIGHT', () => {
    const deps = makeDeps();
    const dock = new EdgeDock(deps);
    // Drive into HIDDEN_RIGHT: WINDOW_MOVED flush-right + MOUSE_LEAVE + ANIM_DONE
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const bounds = { x: workArea.x + workArea.width - 393, y: 0, width: 393, height: 852 };
    dock.dispatch({ type: 'WINDOW_MOVED', bounds, workArea });
    dock.dispatch({ type: 'MOUSE_LEAVE' });
    dock.dispatch({ type: 'ANIM_DONE' });
    expect(dock.getState().kind).toBe('HIDDEN_RIGHT');
    deps.broadcastState.mockClear();
    dock.forceRevealIfHidden();
    expect(['REVEALING', 'DOCKED_RIGHT']).toContain(dock.getState().kind);
  });
});
