import { describe, it, expect, vi } from 'vitest';
import { TabCycler } from '../../src/main/tab-cycler';

interface FakeInput {
  type: 'keyDown' | 'keyUp';
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

interface FakeWc {
  handlers: ((e: { defaultPrevented?: boolean; preventDefault: () => void }, input: FakeInput) => void)[];
  on(
    event: 'before-input-event',
    cb: (e: { defaultPrevented?: boolean; preventDefault: () => void }, input: FakeInput) => void,
  ): void;
  off(
    event: 'before-input-event',
    cb: (e: { defaultPrevented?: boolean; preventDefault: () => void }, input: FakeInput) => void,
  ): void;
  emit(input: FakeInput): { preventDefault: () => void; defaultPrevented: boolean };
}

function makeWc(): FakeWc {
  const wc: FakeWc = {
    handlers: [],
    on(_e, cb) { this.handlers.push(cb); },
    off(_e, cb) { this.handlers = this.handlers.filter((h) => h !== cb); },
    emit(input) {
      const ev = {
        defaultPrevented: false,
        preventDefault(): void { this.defaultPrevented = true; },
      };
      for (const h of this.handlers) h(ev, input);
      return ev;
    },
  };
  return wc;
}

const input = (overrides: Partial<FakeInput>): FakeInput => ({
  type: 'keyDown',
  key: '',
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...overrides,
});

describe('TabCycler', () => {
  it('Ctrl+Tab keyDown advances and broadcasts active=true on first press', () => {
    const activateNext = vi.fn();
    const activatePrev = vi.fn();
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev, broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);

    const ev = wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).toHaveBeenCalledTimes(1);
    expect(broadcastCycleState).toHaveBeenCalledWith(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('subsequent Ctrl+Tab does not re-broadcast active=true (idempotent)', () => {
    const activateNext = vi.fn();
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev: vi.fn(), broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);

    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).toHaveBeenCalledTimes(2);
    expect(broadcastCycleState).toHaveBeenCalledTimes(1);
    expect(broadcastCycleState).toHaveBeenCalledWith(true);
  });

  it('Ctrl+Shift+Tab calls activatePrev', () => {
    const activateNext = vi.fn();
    const activatePrev = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev, broadcastCycleState: vi.fn() });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true, shift: true }));
    expect(activatePrev).toHaveBeenCalledTimes(1);
    expect(activateNext).not.toHaveBeenCalled();
  });

  it('Control keyUp ends cycle and broadcasts active=false', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({
      activateNext: vi.fn(),
      activatePrev: vi.fn(),
      broadcastCycleState,
    });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    wc.emit(input({ type: 'keyUp', key: 'Control' }));
    expect(broadcastCycleState).toHaveBeenNthCalledWith(1, true);
    expect(broadcastCycleState).toHaveBeenNthCalledWith(2, false);
  });

  it('keyUp Control with no active cycle is a no-op', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({
      activateNext: vi.fn(),
      activatePrev: vi.fn(),
      broadcastCycleState,
    });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyUp', key: 'Control' }));
    expect(broadcastCycleState).not.toHaveBeenCalled();
  });

  it('Tab without Ctrl is ignored', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({
      activateNext,
      activatePrev: vi.fn(),
      broadcastCycleState: vi.fn(),
    });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    const ev = wc.emit(input({ type: 'keyDown', key: 'Tab' }));
    expect(activateNext).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Ctrl+Alt+Tab is ignored (alt modifier blocks the cycle)', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({
      activateNext,
      activatePrev: vi.fn(),
      broadcastCycleState: vi.fn(),
    });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true, alt: true }));
    expect(activateNext).not.toHaveBeenCalled();
  });

  it('end() force-stops the cycle and broadcasts false (only if active)', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({
      activateNext: vi.fn(),
      activatePrev: vi.fn(),
      broadcastCycleState,
    });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    cycler.end(); // not active — no broadcast
    expect(broadcastCycleState).not.toHaveBeenCalled();
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    cycler.end();
    expect(broadcastCycleState).toHaveBeenNthCalledWith(2, false);
  });

  it('attach returns a detach that removes the listener', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({
      activateNext,
      activatePrev: vi.fn(),
      broadcastCycleState: vi.fn(),
    });
    const wc = makeWc();
    const detach = cycler.attach(wc as unknown as Electron.WebContents);
    detach();
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).not.toHaveBeenCalled();
  });
});
