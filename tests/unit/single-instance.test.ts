import { describe, it, expect, vi } from 'vitest';
import { handleSecondInstance } from '@main/single-instance';

describe('handleSecondInstance', () => {
  it('no-op when window destroyed', () => {
    const deps = {
      isDestroyed: () => true,
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.show).not.toHaveBeenCalled();
    expect(deps.focus).not.toHaveBeenCalled();
  });

  it('shows + focuses + reveals when visible window', () => {
    const deps = {
      isDestroyed: () => false,
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.restore).not.toHaveBeenCalled();
    expect(deps.show).toHaveBeenCalledOnce();
    expect(deps.focus).toHaveBeenCalledOnce();
    expect(deps.forceRevealIfHidden).toHaveBeenCalledOnce();
  });

  it('restores first when minimized', () => {
    const deps = {
      isDestroyed: () => false,
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.restore).toHaveBeenCalledOnce();
    expect(deps.show).toHaveBeenCalledOnce();
    expect(deps.focus).toHaveBeenCalledOnce();
  });
});
