import { describe, it, expect, vi } from 'vitest';
import { DimController } from '../../src/main/dim-controller';
import type { CssTarget } from '../../src/main/dim-controller';
import { DEFAULTS } from '../../src/main/settings';

const mk = (): CssTarget => ({
  insertCSS: vi.fn(async (_rule: string) => 'key-' + Math.random()),
  removeInsertedCSS: vi.fn(async () => undefined),
});

describe('DimController', () => {
  it('apply with effect=blur → insertCSS called once, state set (isActive true)', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.apply(target, DEFAULTS.dim);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(1);
    expect(controller.isActive).toBe(true);
  });

  it('apply same target twice → insertCSS called only once (idempotent)', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.apply(target, DEFAULTS.dim);
    await controller.apply(target, DEFAULTS.dim);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(1);
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(0);
  });

  it('apply then clear → removeInsertedCSS called, state cleared (isActive false)', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.apply(target, DEFAULTS.dim);
    await controller.clear();
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(1);
    expect(controller.isActive).toBe(false);
  });

  it('apply with effect=none → insertCSS not called, state stays null', async () => {
    const controller = new DimController();
    const target = mk();
    const noneDim = { ...DEFAULTS.dim, effect: 'none' as const };
    await controller.apply(target, noneDim);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(0);
    expect(controller.isActive).toBe(false);
  });

  it('retarget when active → old removeInsertedCSS + new insertCSS called', async () => {
    const controller = new DimController();
    const oldTarget = mk();
    const newTarget = mk();
    await controller.apply(oldTarget, DEFAULTS.dim);
    await controller.retarget(newTarget, DEFAULTS.dim);
    expect(vi.mocked(oldTarget.removeInsertedCSS).mock.calls).toHaveLength(1);
    expect(vi.mocked(newTarget.insertCSS).mock.calls).toHaveLength(1);
  });

  it('retarget when inactive → no calls on either target (silent no-op)', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.retarget(target, DEFAULTS.dim);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(0);
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(0);
    expect(controller.isActive).toBe(false);
  });

  it('two different targets applied sequentially → old removed, new inserted', async () => {
    const controller = new DimController();
    const t1 = mk();
    const t2 = mk();
    await controller.apply(t1, DEFAULTS.dim);
    await controller.apply(t2, DEFAULTS.dim);
    expect(vi.mocked(t1.insertCSS).mock.calls).toHaveLength(1);
    expect(vi.mocked(t1.removeInsertedCSS).mock.calls).toHaveLength(1);
    expect(vi.mocked(t2.insertCSS).mock.calls).toHaveLength(1);
    expect(controller.isActive).toBe(true);
  });

  it('apply(blur) then apply(none) → clears state', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.apply(target, DEFAULTS.dim); // effect='blur', state becomes active
    const noneDim = { ...DEFAULTS.dim, effect: 'none' as const };
    await controller.apply(target, noneDim); // effect='none' → clear()
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(1);
    expect(controller.isActive).toBe(false);
  });

  it('isActive reflects state correctly across lifecycle', async () => {
    const controller = new DimController();
    expect(controller.isActive).toBe(false);
    const target = mk();
    await controller.apply(target, DEFAULTS.dim);
    expect(controller.isActive).toBe(true);
    await controller.clear();
    expect(controller.isActive).toBe(false);
  });

  it('restyle when inactive → no calls on target (silent no-op)', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.restyle(DEFAULTS.dim);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(0);
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(0);
    expect(controller.isActive).toBe(false);
  });

  it('restyle when active → old CSS removed + new CSS inserted', async () => {
    const controller = new DimController();
    const target = mk();
    await controller.apply(target, DEFAULTS.dim);
    // After apply: insertCSS=1, removeInsertedCSS=0
    await controller.restyle({ ...DEFAULTS.dim, blurPx: 16 });
    // After restyle: removeInsertedCSS=1 (cleared old), insertCSS=2 (re-inserted with new)
    expect(vi.mocked(target.removeInsertedCSS).mock.calls).toHaveLength(1);
    expect(vi.mocked(target.insertCSS).mock.calls).toHaveLength(2);
    expect(controller.isActive).toBe(true);
  });

  it('restyle uses new dim settings (blurPx reflected in new CSS rule)', async () => {
    const controller = new DimController();
    const capturedRules: string[] = [];
    const target: CssTarget = {
      insertCSS: vi.fn(async (rule: string) => {
        capturedRules.push(rule);
        return 'key-' + capturedRules.length;
      }),
      removeInsertedCSS: vi.fn(async () => undefined),
    };
    await controller.apply(target, DEFAULTS.dim); // blurPx: 8
    await controller.restyle({ ...DEFAULTS.dim, blurPx: 16 });
    expect(capturedRules).toHaveLength(2);
    expect(capturedRules[0]).toContain('blur(8px)');
    expect(capturedRules[1]).toContain('blur(16px)');
  });
});
