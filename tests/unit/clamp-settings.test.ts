import { describe, it, expect } from 'vitest';
import type { Settings } from '@shared/types';
import { clampSettings } from '../../src/main/clamp-settings';
import { DEFAULTS } from '../../src/main/settings';
import {
  BUILTIN_SEARCH_ENGINES,
  BUILTIN_SEARCH_ENGINE_IDS,
} from '../../src/shared/settings-defaults';

// Use a deep-cloned DEFAULTS as `current` for every case so individual tests
// can't accidentally mutate the shared baseline.
const cur = (): Settings => structuredClone(DEFAULTS);

describe('clampSettings', () => {
  it('returns {} for an empty partial', () => {
    expect(clampSettings({}, cur())).toEqual({});
  });

  it("expands non-'custom' preset to its width/height", () => {
    expect(clampSettings({ window: { preset: 'iphonese' } }, cur())).toEqual({
      window: { preset: 'iphonese', width: 375, height: 667 },
    });
  });

  it('clamps window.edgeThresholdPx above 50 down to 50', () => {
    expect(clampSettings({ window: { edgeThresholdPx: 100 } }, cur())).toEqual({
      window: { edgeThresholdPx: 50 },
    });
  });

  it('clamps dim.blurPx below 0 up to 0', () => {
    expect(clampSettings({ dim: { blurPx: -5 } }, cur())).toEqual({
      dim: { blurPx: 0 },
    });
  });

  it('clamps dim.lightBrightness below 1 up to 1', () => {
    expect(clampSettings({ dim: { lightBrightness: 0.5 } }, cur())).toEqual({
      dim: { lightBrightness: 1 },
    });
  });

  it('clamps mouseLeave.delayMs above 2000 down to 2000', () => {
    expect(clampSettings({ mouseLeave: { delayMs: 3000 } }, cur())).toEqual({
      mouseLeave: { delayMs: 2000 },
    });
  });

  it('clamps edgeDock.triggerStripPx below 1 up to 1', () => {
    expect(clampSettings({ edgeDock: { triggerStripPx: 0 } }, cur())).toEqual({
      edgeDock: { triggerStripPx: 1 },
    });
  });

  it('drops empty-string mobileUserAgent so current is preserved', () => {
    // We pick the {browsing:{}} representation: section present, no fields. The
    // contract is "do not overwrite current.mobileUserAgent with empty string";
    // either {} or {browsing:{}} satisfies that — we lock in the latter so the
    // test catches accidental policy drift.
    expect(clampSettings({ browsing: { mobileUserAgent: '' } }, cur())).toEqual({
      browsing: {},
    });
  });

  it('emits multiple sections together when partial spans both', () => {
    expect(
      clampSettings(
        { window: { edgeThresholdPx: 12 }, dim: { blurPx: 5 } },
        cur(),
      ),
    ).toEqual({
      window: { edgeThresholdPx: 12 },
      dim: { blurPx: 5 },
    });
  });

  it('passes booleans through unchanged', () => {
    expect(clampSettings({ edgeDock: { enabled: false } }, cur())).toEqual({
      edgeDock: { enabled: false },
    });
  });

  // Extra coverage — natural edge cases called out by the plan briefing.

  it("preset wins over an explicit width in the same partial", () => {
    expect(
      clampSettings(
        { window: { preset: 'iphonese', width: 999 } },
        cur(),
      ),
    ).toEqual({
      window: { preset: 'iphonese', width: 375, height: 667 },
    });
  });

  it('clamps dim.darkBrightness above 1 down to 1 (upper bound)', () => {
    expect(clampSettings({ dim: { darkBrightness: 2 } }, cur())).toEqual({
      dim: { darkBrightness: 1 },
    });
  });

  it("passes dim.effect literal-union string through unchanged", () => {
    expect(clampSettings({ dim: { effect: 'dark' } }, cur())).toEqual({
      dim: { effect: 'dark' },
    });
  });
});

describe('clampAppearance', () => {
  it('accepts valid theme values', () => {
    expect(clampSettings({ appearance: { theme: 'system' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
    expect(clampSettings({ appearance: { theme: 'dark' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'dark' } });
    expect(clampSettings({ appearance: { theme: 'light' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'light' } });
  });

  it('falls back invalid theme → system', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampSettings({ appearance: { theme: 'sepia' as any } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
  });
});

describe('clampWindow — M9 migration', () => {
  it('migrates preset=custom → iphone14pro with canonical dims', () => {
    const out = clampSettings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { window: { preset: 'custom' as any } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('migrates preset=custom alongside stale width/height (width/height dropped)', () => {
    const out = clampSettings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { window: { preset: 'custom' as any, width: 400, height: 800 } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('does NOT coerce width/height without preset to custom anymore (width/height dropped)', () => {
    const out = clampSettings(
      { window: { width: 400, height: 800 } },
      DEFAULTS,
    );
    // width/height alone now no-op; preset is the only path to change dims.
    expect(out.window).toEqual({});
  });
});

describe('clampSettings — search section', () => {
  // 不变量 1：过滤无效条目（缺 {query} / name 空）
  it('drops engines whose urlTemplate lacks {query}', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            ...BUILTIN_SEARCH_ENGINES,
            { id: 'bad', name: 'Bad', urlTemplate: 'https://example.com/q=', builtin: false },
          ],
        },
      },
      cur(),
    );
    expect(result.search?.engines?.find((e) => e.id === 'bad')).toBeUndefined();
  });

  it('drops engines whose name is empty / whitespace', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            ...BUILTIN_SEARCH_ENGINES,
            { id: 'blank', name: '   ', urlTemplate: 'https://e.com/?q={query}', builtin: false },
          ],
        },
      },
      cur(),
    );
    expect(result.search?.engines?.find((e) => e.id === 'blank')).toBeUndefined();
  });

  // 不变量 2：修正 builtin 标记
  it('forces builtin=true for builtin ids regardless of input', () => {
    const result = clampSettings(
      {
        search: {
          engines: BUILTIN_SEARCH_ENGINES.map((e) => ({ ...e, builtin: false })),
        },
      },
      cur(),
    );
    for (const e of result.search!.engines!) {
      if (BUILTIN_SEARCH_ENGINE_IDS.has(e.id)) {
        expect(e.builtin).toBe(true);
      }
    }
  });

  it('forces builtin=false for non-builtin ids regardless of input', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            ...BUILTIN_SEARCH_ENGINES,
            { id: 'custom1', name: 'Custom', urlTemplate: 'https://c.com/?q={query}', builtin: true /* lying */ },
          ],
        },
      },
      cur(),
    );
    expect(result.search!.engines!.find((e) => e.id === 'custom1')!.builtin).toBe(false);
  });

  // 不变量 3：内置项 name/urlTemplate 不可改
  it('rewrites tampered builtin name back to canonical', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            { id: 'google', name: 'GoogleHax', urlTemplate: 'https://www.google.com/search?q={query}', builtin: true },
            ...BUILTIN_SEARCH_ENGINES.filter((e) => e.id !== 'google'),
          ],
        },
      },
      cur(),
    );
    expect(result.search!.engines!.find((e) => e.id === 'google')!.name).toBe('Google');
  });

  it('rewrites tampered builtin urlTemplate back to canonical', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            { id: 'bing', name: 'Bing', urlTemplate: 'https://attacker.com/?q={query}', builtin: true },
            ...BUILTIN_SEARCH_ENGINES.filter((e) => e.id !== 'bing'),
          ],
        },
      },
      cur(),
    );
    expect(result.search!.engines!.find((e) => e.id === 'bing')!.urlTemplate)
      .toBe('https://www.bing.com/search?q={query}');
  });

  // 不变量 4：按 id 去重
  it('dedupes engines by id (first wins)', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            ...BUILTIN_SEARCH_ENGINES,
            { id: 'custom1', name: 'First', urlTemplate: 'https://e.com/?q={query}', builtin: false },
            { id: 'custom1', name: 'Second', urlTemplate: 'https://e.com/?q={query}', builtin: false },
          ],
        },
      },
      cur(),
    );
    const customs = result.search!.engines!.filter((e) => e.id === 'custom1');
    expect(customs.length).toBe(1);
    expect(customs[0]!.name).toBe('First');
  });

  // 不变量 5：补回缺失内置
  it('restores missing builtins to canonical positions at the front', () => {
    const result = clampSettings(
      {
        search: {
          engines: [{ id: 'baidu', name: '百度', urlTemplate: 'https://www.baidu.com/s?wd={query}', builtin: true }],
        },
      },
      cur(),
    );
    // 前 4 个必须是 BUILTIN_SEARCH_ENGINES 顺序
    const ids = result.search!.engines!.map((e) => e.id);
    expect(ids.slice(0, 4)).toEqual(BUILTIN_SEARCH_ENGINES.map((e) => e.id));
  });

  it('keeps customs after builtins after restore', () => {
    const result = clampSettings(
      {
        search: {
          engines: [
            { id: 'so', name: 'StackOverflow', urlTemplate: 'https://stackoverflow.com/search?q={query}', builtin: false },
          ],
        },
      },
      cur(),
    );
    const ids = result.search!.engines!.map((e) => e.id);
    expect(ids).toEqual([...BUILTIN_SEARCH_ENGINES.map((e) => e.id), 'so']);
  });

  // 不变量 6：activeId 校验
  it('falls back activeId to "google" when out of range', () => {
    const result = clampSettings(
      { search: { activeId: 'unknown-id' } },
      cur(),
    );
    expect(result.search?.activeId).toBe('google');
  });

  it('falls back activeId when patch.engines removes the current active', () => {
    const c = cur();
    c.search.activeId = 'so';
    c.search.engines = [...BUILTIN_SEARCH_ENGINES, {
      id: 'so', name: 'SO', urlTemplate: 'https://so.com/?q={query}', builtin: false,
    }];
    const result = clampSettings(
      {
        search: {
          // engines 没含 'so' → activeId 校验失败 → fallback google
          engines: [...BUILTIN_SEARCH_ENGINES],
        },
      },
      c,
    );
    expect(result.search?.activeId).toBe('google');
  });

  it('passes through valid activeId unchanged', () => {
    const result = clampSettings(
      { search: { activeId: 'duckduckgo' } },
      cur(),
    );
    expect(result.search?.activeId).toBe('duckduckgo');
  });

  // 空 patch 不放 search 进结果
  it('returns no search field when partial.search === undefined', () => {
    expect(clampSettings({}, cur()).search).toBeUndefined();
  });

  it('drops null and non-object entries in engines array (trust-boundary guard)', () => {
    const result = clampSettings(
      {
        search: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          engines: [null, undefined, 'string', { id: 'x' }, { id: 'y', name: 'Y', urlTemplate: 'https://y.com/?q={query}', builtin: false }] as any,
        },
      },
      cur(),
    );
    // Only the last entry is well-formed (id+name+template+builtin); plus 4 builtins restored.
    // null/undefined/'string' / { id:'x' only } all dropped.
    expect(result.search!.engines!.length).toBe(5);
    expect(result.search!.engines!.map((e) => e.id))
      .toEqual([...BUILTIN_SEARCH_ENGINES.map((e) => e.id), 'y']);
  });
});
