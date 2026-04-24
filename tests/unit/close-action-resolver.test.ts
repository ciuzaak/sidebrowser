import { describe, it, expect } from 'vitest';
import { resolveCloseAction, type ResolveCloseActionInput } from '../../src/main/close-action-resolver';

// ---------------------------------------------------------------------------
// Matrix: 4 cases from spec
// ---------------------------------------------------------------------------

describe('close-action-resolver', () => {
  it("case 1: closeAction='minimize-to-tray', isQuitting=false → 'hide'", () => {
    const input: ResolveCloseActionInput = {
      closeAction: 'minimize-to-tray',
      isQuitting: false,
    };
    expect(resolveCloseAction(input)).toBe('hide');
  });

  it("case 2: closeAction='minimize-to-tray', isQuitting=true → 'destroy'", () => {
    const input: ResolveCloseActionInput = {
      closeAction: 'minimize-to-tray',
      isQuitting: true,
    };
    expect(resolveCloseAction(input)).toBe('destroy');
  });

  it("case 3: closeAction='quit', isQuitting=false → 'destroy'", () => {
    const input: ResolveCloseActionInput = {
      closeAction: 'quit',
      isQuitting: false,
    };
    expect(resolveCloseAction(input)).toBe('destroy');
  });

  it("case 4: closeAction='quit', isQuitting=true → 'destroy' (idempotent)", () => {
    const input: ResolveCloseActionInput = {
      closeAction: 'quit',
      isQuitting: true,
    };
    expect(resolveCloseAction(input)).toBe('destroy');
  });
});
