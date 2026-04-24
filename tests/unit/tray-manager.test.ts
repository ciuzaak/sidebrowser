import { describe, it, expect, vi } from 'vitest';
import { TrayManager } from '../../src/main/tray-manager';
import type { TrayBackend, TrayMenuTemplate } from '../../src/main/tray-manager';

// ---------------------------------------------------------------------------
// Fake TrayBackend
// ---------------------------------------------------------------------------

function makeFakeBackend(): TrayBackend & {
  capturedTemplate: TrayMenuTemplate | null;
  capturedClickCb: (() => void) | null;
} {
  let capturedTemplate: TrayMenuTemplate | null = null;
  let capturedClickCb: (() => void) | null = null;

  const backend = {
    setImage: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn((template: TrayMenuTemplate) => {
      capturedTemplate = template;
    }),
    onClick: vi.fn((cb: () => void) => {
      capturedClickCb = cb;
    }),
    destroy: vi.fn(),

    get capturedTemplate() {
      return capturedTemplate;
    },
    get capturedClickCb() {
      return capturedClickCb;
    },
  };

  return backend;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ICON_PATH = '/path/to/tray-32.png';

function makeDeps(overrides: { toolTip?: string } = {}) {
  const backend = makeFakeBackend();
  const onShow = vi.fn();
  const onQuit = vi.fn();
  const deps = {
    backend,
    iconPath: ICON_PATH,
    onShow,
    onQuit,
    ...overrides,
  };
  return { backend, onShow, onQuit, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrayManager', () => {
  // ── Test 1: constructor sets image ───────────────────────────────────────
  it('calls backend.setImage with the provided iconPath', () => {
    const { backend, deps } = makeDeps();
    new TrayManager(deps);
    expect(backend.setImage).toHaveBeenCalledOnce();
    expect(backend.setImage).toHaveBeenCalledWith(ICON_PATH);
  });

  // ── Test 2: constructor sets default toolTip ─────────────────────────────
  it('calls backend.setToolTip with default "sidebrowser" when toolTip is omitted', () => {
    const { backend, deps } = makeDeps();
    new TrayManager(deps);
    expect(backend.setToolTip).toHaveBeenCalledOnce();
    expect(backend.setToolTip).toHaveBeenCalledWith('sidebrowser');
  });

  // ── Test 3: constructor sets context menu with exactly 2 items ───────────
  it('calls backend.setContextMenu with exactly 2 items labelled "Show" and "Quit"', () => {
    const { backend, deps } = makeDeps();
    new TrayManager(deps);
    expect(backend.setContextMenu).toHaveBeenCalledOnce();
    const template = backend.capturedTemplate!;
    expect(template).not.toBeNull();
    expect(template.items).toHaveLength(2);
    expect(template.items[0].label).toBe('Show');
    expect(template.items[1].label).toBe('Quit');
  });

  // ── Test 4: left-click (onClick callback) calls onShow ───────────────────
  it('calls deps.onShow when the backend onClick callback fires (left-click)', () => {
    const { backend, onShow, deps } = makeDeps();
    new TrayManager(deps);
    expect(backend.onClick).toHaveBeenCalledOnce();
    // Simulate tray left-click by invoking the captured callback
    backend.capturedClickCb!();
    expect(onShow).toHaveBeenCalledOnce();
  });

  // ── Test 5: "Show" menu item click calls onShow ──────────────────────────
  it('calls deps.onShow when the "Show" menu item onClick fires', () => {
    const { backend, onShow, deps } = makeDeps();
    new TrayManager(deps);
    const showItem = backend.capturedTemplate!.items[0];
    showItem.onClick();
    expect(onShow).toHaveBeenCalledOnce();
  });

  // ── Test 6: "Quit" menu item click calls onQuit ──────────────────────────
  it('calls deps.onQuit when the "Quit" menu item onClick fires', () => {
    const { backend, onQuit, deps } = makeDeps();
    new TrayManager(deps);
    const quitItem = backend.capturedTemplate!.items[1];
    quitItem.onClick();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  // ── Test 7: destroy delegates to backend ─────────────────────────────────
  it('delegates destroy() to backend.destroy()', () => {
    const { backend, deps } = makeDeps();
    const manager = new TrayManager(deps);
    manager.destroy();
    expect(backend.destroy).toHaveBeenCalledOnce();
  });

  // ── Test 8 (optional): custom toolTip is forwarded ───────────────────────
  it('uses the custom toolTip when provided', () => {
    const { backend, deps } = makeDeps({ toolTip: 'My App' });
    new TrayManager(deps);
    expect(backend.setToolTip).toHaveBeenCalledWith('My App');
  });
});
