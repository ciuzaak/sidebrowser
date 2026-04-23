import { describe, it, expect, vi } from 'vitest';
import type { Settings } from '@shared/types';
import { DEFAULTS } from '../../src/main/settings';
import {
  SettingsStore,
  type SettingsBackend,
} from '../../src/main/settings-store';
import type { SettingsPatch } from '../../src/main/clamp-settings';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Deep-cloned DEFAULTS so individual tests can't mutate the shared baseline. */
const freshDefaults = (): Settings => structuredClone(DEFAULTS);

interface FakeBackend extends SettingsBackend {
  /** Number of times `set()` has been called. */
  setCount: number;
  /** Argument of the most recent `set()` call (deep-cloned at call time). */
  lastSet: Settings | undefined;
  /** Synchronous mutation of the in-memory data, bypassing the store. */
  seed(value: Settings | undefined): void;
}

/**
 * In-memory backend with call counters. `data` may be `undefined` (empty
 * backend → SettingsStore should fall back to DEFAULTS). `set()` deep-clones
 * its input so test assertions on `lastSet` survive later mutations.
 */
function createFakeBackend(initial?: Settings): FakeBackend {
  let data: Settings | undefined = initial
    ? structuredClone(initial)
    : undefined;
  const backend: FakeBackend = {
    setCount: 0,
    lastSet: undefined,
    get: () => (data === undefined ? undefined : structuredClone(data)),
    set: (value: Settings): void => {
      data = structuredClone(value);
      backend.lastSet = structuredClone(value);
      backend.setCount += 1;
    },
    seed: (value: Settings | undefined): void => {
      data = value === undefined ? undefined : structuredClone(value);
    },
  };
  return backend;
}

describe('SettingsStore', () => {
  it('falls back to DEFAULTS when the backend is empty', () => {
    const backend = createFakeBackend();
    const store = new SettingsStore(backend);
    expect(store.get()).toEqual(DEFAULTS);
  });

  it('returns the persisted value verbatim when the backend has full Settings', () => {
    const persisted = freshDefaults();
    persisted.dim.blurPx = 12;
    persisted.window.preset = 'iphonese';
    const store = new SettingsStore(createFakeBackend(persisted));
    expect(store.get()).toEqual(persisted);
  });

  it('upgrades a partial persisted blob by filling in missing sections from DEFAULTS', () => {
    // Old config file that predates the `lifecycle` section.
    const legacy = freshDefaults();
    // Cast to a structural shape that lets us delete a section without
    // tripping the TS readonly-shape guards.
    delete (legacy as unknown as { lifecycle?: unknown }).lifecycle;

    const store = new SettingsStore(createFakeBackend(legacy));

    expect(store.get().lifecycle).toEqual(DEFAULTS.lifecycle);
    // Other sections survive untouched.
    expect(store.get().window).toEqual(DEFAULTS.window);
  });

  it('update writes the patched field through and persists once', () => {
    const backend = createFakeBackend();
    const store = new SettingsStore(backend);

    const result = store.update({ dim: { blurPx: 16 } });

    expect(store.get().dim.blurPx).toBe(16);
    expect(result.dim.blurPx).toBe(16);
    expect(backend.setCount).toBe(1);
    expect(backend.lastSet?.dim.blurPx).toBe(16);
    // Other dim fields preserved from DEFAULTS by the per-section deep merge.
    expect(backend.lastSet?.dim.effect).toBe(DEFAULTS.dim.effect);
  });

  it('notifies onChanged listeners with the full new Settings on update', () => {
    const store = new SettingsStore(createFakeBackend());
    const cb = vi.fn();
    store.onChanged(cb);

    const result = store.update({ mouseLeave: { delayMs: 250 } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(result);
    expect(cb.mock.calls[0]?.[0].mouseLeave.delayMs).toBe(250);
  });

  it('routes update through clampSettings (out-of-range numeric snapped)', () => {
    const store = new SettingsStore(createFakeBackend());
    store.update({ dim: { blurPx: -5 } });
    expect(store.get().dim.blurPx).toBe(0);
  });

  it('routes update through clampSettings (preset normalization expands width/height)', () => {
    const store = new SettingsStore(createFakeBackend());
    store.update({ window: { preset: 'iphonese' } });
    expect(store.get().window.preset).toBe('iphonese');
    expect(store.get().window.width).toBe(375);
    expect(store.get().window.height).toBe(667);
  });

  it('onChanged returns an unsubscribe function that stops further notifications', () => {
    const store = new SettingsStore(createFakeBackend());
    const cb = vi.fn();
    const unsubscribe = store.onChanged(cb);

    store.update({ dim: { blurPx: 10 } });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.update({ dim: { blurPx: 11 } });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('notifies every registered listener on update', () => {
    const store = new SettingsStore(createFakeBackend());
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.onChanged(cb1);
    store.onChanged(cb2);

    store.update({ edgeDock: { animationMs: 300 } });

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1.mock.calls[0]?.[0]).toBe(cb2.mock.calls[0]?.[0]);
  });

  it('update({}) still persists and notifies (no-op patch is a write)', () => {
    // Plan permits either policy; we lock in "always persist + notify" so the
    // contract is unambiguous and downstream consumers get an up-to-date
    // settings:changed broadcast even if nothing actually changed.
    const backend = createFakeBackend();
    const store = new SettingsStore(backend);
    const cb = vi.fn();
    store.onChanged(cb);

    const before = store.get();
    const result = store.update({});

    expect(result).toEqual(before);
    expect(backend.setCount).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('update(undefined) short-circuits to a true no-op (no write, no notify)', () => {
    // IPC validator will normally guarantee SettingsPatch shape, but if a
    // malformed message slips past, the store must not crash. Unlike
    // update({}) (a deliberate user-intent broadcast), update(undefined) is
    // an error path with no caller intent — we short-circuit to avoid
    // generating spurious backend writes and onChanged broadcasts.
    const backend = createFakeBackend();
    const store = new SettingsStore(backend);
    const cb = vi.fn();
    store.onChanged(cb);
    const before = store.get();

    const result = store.update(undefined as unknown as SettingsPatch);

    expect(result).toBe(before);
    expect(backend.setCount).toBe(0);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('mergeSettingsPatch treats an empty section as a no-op (does not wipe current section)', () => {
    // After clampSettings strips an empty-string mobileUserAgent the patch
    // arrives as { browsing: {} }. The deep-merge must not blow `browsing`
    // away — every existing field has to survive.
    const backend = createFakeBackend();
    const store = new SettingsStore(backend);
    const beforeBrowsing = store.get().browsing;

    store.update({ browsing: {} });

    expect(store.get().browsing).toEqual(beforeBrowsing);
    expect(backend.setCount).toBe(1);
  });
});
