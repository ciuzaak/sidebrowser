# M11：Search Engines + Page Zoom — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。Steps 用 checkbox 跟踪。

**Date:** 2026-04-27
**前置：** `m10-mobile-emulation-clienthints` tag、`main` clean。

**Goal:** (1) 默认搜索引擎从 DuckDuckGo 改为 Google；设置抽屉新增 Search section，内置 Google / DuckDuckGo / Bing / 百度 4 档 + 用户可添加/删除自定义条目。(2) 网页 Ctrl+滚轮触发当前 tab 的 zoom 调整（每 tab 独立、关 tab 即丢、范围 50–300% / 步进 10%），Ctrl+0 复位 100%。`m11-search-and-zoom` tag 落地。

**Architecture:** Search 走 settings 链路：扩 `Settings.search` schema → `clampSearch`（main 信任边界，含 builtins 不可改 + 6 不变量）→ `normalizeUrlInput(raw, template)` → SettingsDrawer 加 section。Zoom 完全在 main 内部闭环：`ViewManager.zoomFactors: Map<tabId, number>` + `webContents.on('zoom-changed')`（Chromium Ctrl+滚轮原生事件）+ `did-navigate` reapply + Ctrl+0 menu accelerator → `resetActiveZoom()`。**不开新 IPC**。

**Tech stack delta:** 无新依赖（`nanoid` 已在依赖里给自定义 engine id 用）。

**Spec reference:** [docs/superpowers/specs/2026-04-27-M11-search-and-zoom-design.md](../specs/2026-04-27-M11-search-and-zoom-design.md)

**全局 guardrails：**
- **Electron 命令前 `unset ELECTRON_RUN_AS_NODE`**：用户 shell env 全局污染该变量；走 `pnpm dev / build / test:e2e` 必须先 unset，或用 `scripts/run.mjs`（已 unset）。所有 `pnpm` 命令都通过 `node scripts/run.mjs` 包了一层，**直接 `pnpm test`/`pnpm typecheck`/`pnpm lint` 是安全的**（vitest 不需要 electron），但 `pnpm dev` / `pnpm test:e2e` 走 run.mjs。
- **Per-task commit**：每个 Task 末尾一次 atomic commit，message 见任务末。
- **不动**：M0–M10 已实现的 EdgeDock / DimController / SessionManager / MobileEmulation / 现有快捷键。M11 只在 SettingsStore + ViewManager + UI + url.ts 打 patch。
- **Plan execution convention**（用户偏好，记录在 memory）：每个 Task 完成后主动汇报；要偏离 plan 先问；用户负责手动冒烟；`m11-search-and-zoom` tag 用户确认手动冒烟通过后才打。

---

## File Structure

**新增文件（0 个）。** 全部在现有文件改动。

**改动文件清单（按里程碑结束态）：**

| 文件 | 角色 | 变化 |
|---|---|---|
| `src/shared/types.ts` | 类型定义 | + `SearchEngine` / `SearchSettings`，扩 `Settings`、`SettingsPatch` |
| `src/shared/settings-defaults.ts` | DEFAULTS 表 | + `BUILTIN_SEARCH_ENGINES` / `BUILTIN_SEARCH_ENGINE_IDS`，扩 `DEFAULTS.search` |
| `src/shared/url.ts` | URL 规范化纯函数 | `normalizeUrlInput` 加 `searchUrlTemplate` 参数 |
| `src/main/clamp-settings.ts` | Settings 验证 | + `clampSearch`，扩 `clampSettings` dispatch |
| `src/main/settings-store.ts` | SettingsStore | `fillMissingSections` 加 `search` 兜底一行 |
| `src/main/view-manager.ts` | tab 控制器 | + `zoomFactors` Map / `zoom-changed` 监听 / `did-navigate` reapply / `closeTab` 清理 / `resetActiveZoom()` |
| `src/main/keyboard-shortcuts.ts` | 隐藏 menu | + `ShortcutDeps.onResetZoom` 字段 + `Ctrl+0` menu item |
| `src/main/index.ts` | bootstrap | wire `onResetZoom` + 追加 zoom E2E hooks |
| `src/renderer/src/components/TopBar.tsx` | 顶栏 | submit 时按 `settings.search` 解析 active engine template |
| `src/renderer/src/components/SettingsDrawer.tsx` | 设置抽屉 | + Search section（select + engines list + add form + reset） |
| `tests/unit/url.test.ts` | 现有单测 | 表驱动改造 + 自定义 template 用例 |
| `tests/unit/clamp-settings.test.ts` | 现有单测 | + `clampSearch` 6 不变量 |
| `tests/unit/view-manager-zoom.test.ts` | 新单测 | Zoom Map + listener + reapply + reset |
| `tests/e2e/search-engine.spec.ts` | 新 E2E | 默认 / 切换 / 自定义 / 删除 active / 持久化 |
| `tests/e2e/zoom.spec.ts` | 新 E2E | ±10% 步进 / clamp / Ctrl+0 / 跨导航生效 |
| `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` | 主 spec §15 | + `Ctrl+0 — Reset zoom` 行 |

---

## Task 1: 扩 Settings schema — `SearchEngine` / `SearchSettings` 类型 + DEFAULTS

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/settings-defaults.ts`

### 设计

只添加类型 + 默认值常量，不改任何运行时行为。Task 2 之前所有现有代码继续用 7-section 的 Settings；TS 编译会要求 `Settings.search` 必填——所以本 task 必须**和 Task 2（fillMissingSections + clampSettings dispatch）一起 commit**，否则 typecheck 会断。

为了保持每 task 一次 atomic commit + green build，本 task 把 Task 2 的 SettingsStore + clampSettings dispatch 修改也一并做了。两件事其实都是"接入新 section 的机械改动"，独立 commit 没意义。

### Step

- [ ] **Step 1: 改 `src/shared/types.ts`**

在文件末尾（Settings interface 之前）加：

```ts
/**
 * 一个搜索引擎条目。Builtins 用稳定字符串 id（'google'/'duckduckgo'/'bing'/'baidu'），
 * 自定义条目由 renderer 在 + 时用 nanoid 生成 id。`urlTemplate` 必须含 `{query}` 占位符
 * 才能通过 main 侧 `clampSearch` 校验。`builtin` 字段以 main 侧的 `BUILTIN_SEARCH_ENGINE_IDS`
 * 为权威——外部传入的 builtin 标记会被 clamp 修正。
 */
export interface SearchEngine {
  id: string;
  name: string;
  urlTemplate: string;
  builtin: boolean;
}

/**
 * Search section（spec §3.1）。`engines` 数组前 N 个永远是 builtins（按
 * `BUILTIN_SEARCH_ENGINES` 表的顺序），自定义追加在后。`activeId` 必须存在
 * 于 `engines` 的 id 集合中，否则 main 侧 fallback 到 'google'。
 */
export interface SearchSettings {
  engines: SearchEngine[];
  activeId: string;
}
```

把 `Settings` 接口加一个字段（在 `appearance` 后追加）：

```ts
export interface Settings {
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
  lifecycle: LifecycleSettings;
  browsing: BrowsingSettings;
  appearance: AppearanceSettings;
  search: SearchSettings;
}
```

把 `SettingsPatch` 类型加一个字段：

```ts
export type SettingsPatch = {
  window?: Partial<WindowSettings>;
  mouseLeave?: Partial<MouseLeaveSettings>;
  dim?: Partial<DimSettings>;
  edgeDock?: Partial<EdgeDockSettings>;
  lifecycle?: Partial<LifecycleSettings>;
  browsing?: Partial<BrowsingSettings>;
  appearance?: Partial<AppearanceSettings>;
  search?: Partial<SearchSettings>;
};
```

- [ ] **Step 2: 改 `src/shared/settings-defaults.ts`**

在 `MOBILE_UA` 常量定义后、`DEFAULTS` 之前加：

```ts
/**
 * 内置搜索引擎表（spec §3.2）。顺序即 SettingsDrawer 列表显示顺序。
 * Google 排第一，因为是默认 active engine。`as const` 保证 readonly + 字符串字面量
 * 类型推断；构造 DEFAULTS 时浅拷贝成可变数组以匹配 `SearchEngine[]` 签名。
 */
export const BUILTIN_SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'google',     name: 'Google',     urlTemplate: 'https://www.google.com/search?q={query}', builtin: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q={query}',       builtin: true },
  { id: 'bing',       name: 'Bing',       urlTemplate: 'https://www.bing.com/search?q={query}',   builtin: true },
  { id: 'baidu',      name: '百度',        urlTemplate: 'https://www.baidu.com/s?wd={query}',      builtin: true },
] as const;

export const BUILTIN_SEARCH_ENGINE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SEARCH_ENGINES.map((e) => e.id),
);
```

文件顶部 import 增补：

```ts
import type { Settings, SearchEngine } from './types';
```

修改 `DEFAULTS` 常量（在 `appearance` 后追加 `search`）：

```ts
export const DEFAULTS: Settings = {
  window: { width: 393, height: 852, preset: 'iphone14pro', edgeThresholdPx: 8 },
  mouseLeave: { delayMs: 100 },
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 1.5,
    transitionMs: 150,
  },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
  lifecycle: { restoreTabsOnLaunch: true },
  browsing: { defaultIsMobile: true, mobileUserAgent: MOBILE_UA },
  appearance: { theme: 'system' },
  search: {
    engines: [...BUILTIN_SEARCH_ENGINES],
    activeId: 'google',
  },
};
```

- [ ] **Step 3: typecheck**

```
pnpm typecheck
```

Expected: **失败**——`fillMissingSections` 还没补 search 字段；`clampSettings` dispatch 也少 search 分支。两件事 Task 2 修。

- [ ] **Step 4（不 commit，留给 Task 2 一起 commit）**

Task 1 + Task 2 是同一个 commit，因为单独的 Task 1 让 build 红。下一 task 立即接上。

---

## Task 2: SettingsStore 与 clampSettings 接入新 section

**Files:**
- Modify: `src/main/settings-store.ts`
- Modify: `src/main/clamp-settings.ts`

### 设计

`fillMissingSections` 只是补一行；`clampSettings` 加 dispatch（`clampSearch` 本身在 Task 3 才实现，本 task 先用一个空实现 stub 让编译过 + Task 3 用 TDD 替换）。

### Step

- [ ] **Step 1: 改 `src/main/settings-store.ts`**

`fillMissingSections` 函数体，在 `appearance` 后追加 `search`：

```ts
function fillMissingSections(persisted: Partial<Settings>): Settings {
  return {
    window: persisted.window ?? DEFAULTS.window,
    mouseLeave: persisted.mouseLeave ?? DEFAULTS.mouseLeave,
    dim: persisted.dim ?? DEFAULTS.dim,
    edgeDock: persisted.edgeDock ?? DEFAULTS.edgeDock,
    lifecycle: persisted.lifecycle ?? DEFAULTS.lifecycle,
    browsing: persisted.browsing ?? DEFAULTS.browsing,
    appearance: persisted.appearance ?? DEFAULTS.appearance,
    search: persisted.search ?? DEFAULTS.search,
  };
}
```

`mergeSettingsPatch` 函数体也补一行：

```ts
search: patch.search ? { ...current.search, ...patch.search } : current.search,
```

- [ ] **Step 2: 改 `src/main/clamp-settings.ts` — 加 stub clampSearch + dispatch**

Task 3 会用 TDD 把 stub 替换成正式实现。这里只放最小骨架让编译过：

文件末尾（`clampAppearance` 之后、`clampSettings` 之前）加：

```ts
import type { SearchSettings } from '@shared/types';

/**
 * STUB — Task 3 用 TDD 实现完整 6 不变量。当前实现仅"原样透传"足够让编译过 +
 * 现有 Settings/IPC 链路在新 section 下不崩溃；UI 还没接到 search 上，所以 stub
 * 行为暂时不会被外部调用。Task 3 完成后这里会被完全替换。
 */
function clampSearch(
  partial: Partial<SearchSettings>,
  // current 在正式实现里会用，stub 阶段先标记为 unused 以满足 strict 编译
  _current: SearchSettings,
): Partial<SearchSettings> {
  const out: Partial<SearchSettings> = {};
  if (partial.engines !== undefined) out.engines = partial.engines;
  if (partial.activeId !== undefined) out.activeId = partial.activeId;
  return out;
}
```

修改 `clampSettings` 函数末尾，在 `appearance` 分支后追加：

```ts
if (partial.search !== undefined) {
  out.search = clampSearch(partial.search, _current.search);
}
```

把 `clampSettings` 签名里的 `_current: Settings` 的下划线**保留**（stub 阶段还是没用；Task 3 替换 clampSearch 后实际用到 current.search.activeId 时会消除下划线）。

- [ ] **Step 3: typecheck / lint / 现有单测全跑**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: **全过**。已有的 `tests/unit/clamp-settings.test.ts` 不应该挂——stub 透传 search，但所有现有用例都不传 search 字段，所以 dispatch 分支不被触发。`tests/unit/settings-store.test.ts` 如果有"完整 Settings 形状"快照测试可能会要求新增 search 字段——按当时实际报错调整。

- [ ] **Step 4: Commit Task 1 + Task 2**

```
git add src/shared/types.ts src/shared/settings-defaults.ts src/main/settings-store.ts src/main/clamp-settings.ts
git commit -m "feat(settings): add Search section schema (M11 Task 1+2)

- SearchEngine / SearchSettings types in @shared/types
- BUILTIN_SEARCH_ENGINES table (Google/DuckDuckGo/Bing/Baidu) + DEFAULTS.search
- SettingsStore.fillMissingSections + mergeSettingsPatch handle search
- clampSettings dispatch + clampSearch stub (Task 3 will TDD-replace)"
```

---

## Task 3: TDD `clampSearch` — 6 不变量

**Files:**
- Modify: `src/main/clamp-settings.ts`
- Modify: `tests/unit/clamp-settings.test.ts`

### 设计

把 Task 2 的 stub 替换成完整实现。spec §4.1 的 6 步顺序就是单测的 6 个 describe 块。

**实现要点：**
1. **过滤无效条目**：`name.trim() !== ''` 且 `urlTemplate.includes('{query}')`，否则整条丢弃。
2. **修正 builtin 标记**：`id ∈ BUILTIN_SEARCH_ENGINE_IDS` → 强制 `builtin = true`，否则 `false`。
3. **覆写内置项不可变字段**：内置 id 的条目，`name` / `urlTemplate` 用 `BUILTIN_SEARCH_ENGINES` 表的值覆盖。
4. **去重**（按 id，先到先得）。
5. **补回缺失内置**：扫 `BUILTIN_SEARCH_ENGINES` 顺序，缺哪个就 unshift 到结果开头。最终前 4 个永远是 builtins，按表的固定顺序。
6. **activeId 校验**：取最终 engines id 集合，`activeId` 不在则 fallback `'google'`。当 `partial.activeId === undefined` 但 `partial.engines` 删掉了当前 active 时，用 `current.activeId` 重做这一步检查。

### Step

- [ ] **Step 1: 写 failing 单测**

`tests/unit/clamp-settings.test.ts` 末尾追加（在文件末 `});` 之前）：

```ts
import {
  BUILTIN_SEARCH_ENGINES,
  BUILTIN_SEARCH_ENGINE_IDS,
} from '../../src/shared/settings-defaults';

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
});
```

- [ ] **Step 2: 跑单测看 fail**

```
pnpm test -- clamp-settings
```

Expected: 多个测试 FAIL（stub 实现透传，不做任何不变量校验）。

- [ ] **Step 3: 替换 clampSearch 实现**

`src/main/clamp-settings.ts` 顶部 import 处加：

```ts
import {
  BUILTIN_SEARCH_ENGINES,
  BUILTIN_SEARCH_ENGINE_IDS,
} from '@shared/settings-defaults';
import type { SearchEngine, SearchSettings } from '@shared/types';
```

把 Task 2 加的 stub `clampSearch` 整体替换为：

```ts
/**
 * Search section 的信任边界：所有从 IPC 入侵的 search patch 都过这一层。
 * 6 步顺序对应 spec §4.1 的不变量。`current` 用于 activeId 跨 patch 校验
 * （patch 删了当前 active 但没传 activeId 时，按 current.activeId 重新校验）。
 */
function clampSearch(
  partial: Partial<SearchSettings>,
  current: SearchSettings,
): Partial<SearchSettings> {
  const out: Partial<SearchSettings> = {};

  // engines 字段处理
  if (partial.engines !== undefined) {
    // 1. 过滤无效条目
    const valid = partial.engines.filter(
      (e) =>
        typeof e.name === 'string' &&
        e.name.trim() !== '' &&
        typeof e.urlTemplate === 'string' &&
        e.urlTemplate.includes('{query}'),
    );

    // 2/3. 修正 builtin 标记 + 覆写内置项不可变字段
    const normalized: SearchEngine[] = valid.map((e) => {
      if (BUILTIN_SEARCH_ENGINE_IDS.has(e.id)) {
        const canonical = BUILTIN_SEARCH_ENGINES.find((b) => b.id === e.id)!;
        return { id: e.id, name: canonical.name, urlTemplate: canonical.urlTemplate, builtin: true };
      }
      return { id: e.id, name: e.name, urlTemplate: e.urlTemplate, builtin: false };
    });

    // 4. 按 id 去重，先到先得
    const seen = new Set<string>();
    const deduped = normalized.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    // 5. 重建 engines：4 个 builtins（按 BUILTIN_SEARCH_ENGINES 表序、canonical
    // 内容）+ deduped 里所有 customs（保留用户输入序）。
    // 因为步骤 3 已经把 deduped 里的 builtin 条目 canonical 化过，这里直接用表
    // 重建 builtin section 是等价的（且自动覆盖"内置缺失需要补回"的情况）。
    const customs = deduped.filter((e) => !e.builtin);
    const orderedBuiltins = BUILTIN_SEARCH_ENGINES.map((b) => ({ ...b }));
    out.engines = [...orderedBuiltins, ...customs];
  }

  // 6. activeId 校验
  // 计算最终的 ids 集合：若本次 patch 改了 engines 用 out.engines；否则用 current.engines。
  const finalEngines = out.engines ?? current.engines;
  const finalIds = new Set(finalEngines.map((e) => e.id));

  if (partial.activeId !== undefined) {
    out.activeId = finalIds.has(partial.activeId) ? partial.activeId : 'google';
  } else if (out.engines !== undefined && !finalIds.has(current.activeId)) {
    // patch 删除了当前 active，但没显式传 activeId → 兜底 fallback
    out.activeId = 'google';
  }

  return out;
}
```

把 `clampSettings` 签名里的 `_current: Settings` 改回 `current: Settings`（去掉下划线，因为现在真用上了）。同步把内部 dispatch 那行：

```ts
if (partial.search !== undefined) {
  out.search = clampSearch(partial.search, current.search);
}
```

注意：其它 7 个 clampers 仍不读 `current`，TS strict 不会因为没用 current 报错（只在 noUnusedParameters 严格时才需要前缀下划线，本仓 tsconfig 走 strict 但允许函数参数 unused）。如 lint 抱怨，给这 7 个 clamper 的签名加 `_` 前缀。

- [ ] **Step 4: 跑单测看 pass**

```
pnpm test -- clamp-settings
```

Expected: 全过（含原 clampSettings 用例 + 新加的 search 用例）。

- [ ] **Step 5: typecheck + lint**

```
pnpm typecheck && pnpm lint
```

Expected: 全过。

- [ ] **Step 6: Commit**

```
git add src/main/clamp-settings.ts tests/unit/clamp-settings.test.ts
git commit -m "feat(clamp-settings): clampSearch enforces 6 invariants (M11 Task 3)

- filter invalid entries (no {query}, empty name)
- builtin flag follows BUILTIN_SEARCH_ENGINE_IDS, not input
- builtin name/urlTemplate canonicalized from table
- dedupe engines by id (first wins)
- restore missing builtins at canonical front positions
- activeId fallback to 'google' when out of range or active removed"
```

---

## Task 4: `normalizeUrlInput(raw, template)` — 改造现有签名

**Files:**
- Modify: `src/shared/url.ts`
- Modify: `tests/unit/url.test.ts`

### 设计

把硬编码 DuckDuckGo 改为 caller 传入 `searchUrlTemplate`。url.ts 是纯字符串变换层，不验 template 合法性（caller 保证 template 已过 clampSearch）。

### Step

- [ ] **Step 1: 改 failing 单测（修改现有 + 加新）**

完全替换 `tests/unit/url.test.ts` 的内容为：

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUrlInput } from '@shared/url';

const GOOGLE_T = 'https://www.google.com/search?q={query}';
const DDG_T = 'https://duckduckgo.com/?q={query}';
const BAIDU_T = 'https://www.baidu.com/s?wd={query}';

describe('normalizeUrlInput', () => {
  it('prepends https:// to bare hostnames', () => {
    expect(normalizeUrlInput('google.com', GOOGLE_T)).toBe('https://google.com');
    expect(normalizeUrlInput('example.com/path?x=1', GOOGLE_T)).toBe('https://example.com/path?x=1');
  });

  it('preserves explicit http:// urls', () => {
    expect(normalizeUrlInput('http://localhost:3000', GOOGLE_T)).toBe('http://localhost:3000');
  });

  it('preserves explicit https:// urls', () => {
    expect(normalizeUrlInput('https://github.com', GOOGLE_T)).toBe('https://github.com');
  });

  it('preserves about: and chrome: schemes', () => {
    expect(normalizeUrlInput('about:blank', GOOGLE_T)).toBe('about:blank');
    expect(normalizeUrlInput('chrome://settings', GOOGLE_T)).toBe('chrome://settings');
  });

  it('routes search-like input through google template', () => {
    expect(normalizeUrlInput('how to use electron', GOOGLE_T)).toBe(
      'https://www.google.com/search?q=how%20to%20use%20electron',
    );
  });

  it('routes search-like input through duckduckgo template', () => {
    expect(normalizeUrlInput('hello world', DDG_T)).toBe(
      'https://duckduckgo.com/?q=hello%20world',
    );
  });

  it('routes search-like input through baidu template (CJK encoded)', () => {
    expect(normalizeUrlInput('电子', BAIDU_T)).toBe(
      `https://www.baidu.com/s?wd=${encodeURIComponent('电子')}`,
    );
  });

  it('routes search-like input through a custom template', () => {
    const tpl = 'https://stackoverflow.com/search?q={query}';
    expect(normalizeUrlInput('vitest setup', tpl)).toBe(
      'https://stackoverflow.com/search?q=vitest%20setup',
    );
  });

  it('trims whitespace', () => {
    expect(normalizeUrlInput('  google.com  ', GOOGLE_T)).toBe('https://google.com');
  });

  it('returns about:blank for empty or whitespace-only input', () => {
    expect(normalizeUrlInput('', GOOGLE_T)).toBe('about:blank');
    expect(normalizeUrlInput('   ', GOOGLE_T)).toBe('about:blank');
  });
});
```

- [ ] **Step 2: 跑单测看 fail**

```
pnpm test -- url
```

Expected: FAIL — `normalizeUrlInput` 现签名只接受 1 个参数，TS 编译都过不去。

- [ ] **Step 3: 改 `src/shared/url.ts`**

整文件替换为：

```ts
/**
 * Normalize a user-entered address bar string into a loadable URL.
 *
 * Rules:
 * - Empty / whitespace → `about:blank`
 * - Already-qualified scheme (`http`, `https`, `about`, `chrome`, `file`, `data`) → passthrough
 * - Looks like a hostname (has a dot and no whitespace in the token) → prepend `https://`
 * - Otherwise → treat as search query, substitute into `searchUrlTemplate`
 *   (caller resolves the active engine's template from `Settings.search`).
 *
 * `searchUrlTemplate` MUST contain `{query}`. The caller's contract guarantees
 * this — `clampSearch` rejects any engine whose template lacks the placeholder.
 * url.ts is a pure string-transform layer and does not re-validate.
 */
export function normalizeUrlInput(raw: string, searchUrlTemplate: string): string {
  const input = raw.trim();
  if (input === '') return 'about:blank';

  if (/^(https?|about|chrome|file|data):/i.test(input)) {
    return input;
  }

  const firstToken = input.split(/\s+/, 1)[0]!;
  const looksLikeHost = firstToken === input && /\.[a-z]{2,}(?:[:/?#]|$)/i.test(input);
  if (looksLikeHost) {
    return `https://${input}`;
  }

  return searchUrlTemplate.replace('{query}', encodeURIComponent(input));
}
```

- [ ] **Step 4: 跑单测看 pass**

```
pnpm test -- url
```

Expected: 全过。

- [ ] **Step 5: typecheck**

```
pnpm typecheck
```

Expected: **失败**——`TopBar.tsx` 还在用 1-arg 签名。Task 5 修。

- [ ] **Step 6: 不 commit**，留给 Task 5 一起 commit（防止 build 红夹一段）。

---

## Task 5: TopBar 接入 active engine template

**Files:**
- Modify: `src/renderer/src/components/TopBar.tsx`

### 设计

从 `useSettingsStore` 读 `settings.search.engines + activeId`，找到对应 engine 的 `urlTemplate`，传给 `normalizeUrlInput`。settings 还没加载（`null`）时兜底硬编码 google template，确保用户在 ready 之前回车也不会卡死。

### Step

- [ ] **Step 1: 改 `src/renderer/src/components/TopBar.tsx`**

文件顶部 import 增补：

```ts
import { useSettingsStore } from '../store/settings-store';
```

在组件函数体内加 selector（与 `tab` / `hidden` 同区）：

```ts
const settings = useSettingsStore((s) => s.settings);
```

修改 `submit` 函数：

```ts
const submit = (e: FormEvent): void => {
  e.preventDefault();
  if (!tab) return;
  const search = settings?.search;
  // settings 未 hydrate 时兜底；hydrate 后用 active engine
  const tpl =
    search?.engines.find((eng) => eng.id === search.activeId)?.urlTemplate ??
    'https://www.google.com/search?q={query}';
  const url = normalizeUrlInput(draft, tpl);
  void window.sidebrowser.navigate(tab.id, url);
};
```

- [ ] **Step 2: typecheck**

```
pnpm typecheck
```

Expected: 全过。

- [ ] **Step 3: lint**

```
pnpm lint
```

Expected: 全过。

- [ ] **Step 4: 跑全部单测**

```
pnpm test
```

Expected: 全过（url + clamp-settings + 现有所有都已绿）。

- [ ] **Step 5: Commit Task 4 + Task 5**

```
git add src/shared/url.ts tests/unit/url.test.ts src/renderer/src/components/TopBar.tsx
git commit -m "feat(url,topbar): route search via active engine template (M11 Task 4+5)

normalizeUrlInput now takes a searchUrlTemplate parameter; TopBar resolves it
from settings.search.activeId. Default behavior changes: bare-search input
routes to Google (was DuckDuckGo)."
```

---

## Task 6: SettingsDrawer — Search section UI

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

### 设计

紧跟 `Browsing` section 后追加一个 `Search` section。布局参 spec §8.2。

**子组件**：
- `<select>` 选当前 active engine
- 列表展示所有 engines；自定义条目右侧 `[X]` 删除按钮
- 折叠的「+ Add custom engine」按钮，展开后显示 name / urlTemplate 两个 input 和 Add/Cancel 按钮
- Section 顶部右侧 Reset 按钮（与现有 `ResetIcon` 一致），仅在偏离默认时显示

**id 生成**：自定义条目用 `nanoid` 生成（已在 dependencies）。renderer 一侧 import：`import { nanoid } from 'nanoid'`。

**校验**：Add 按钮 disabled 直到 `name.trim() !== ''` 且 `urlTemplate.includes('{query}')`。

### Step

- [ ] **Step 1: 改 `SettingsDrawer.tsx` — import 增补**

文件顶部 import 区追加：

```ts
import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Plus, X as XIcon } from 'lucide-react';
import { BUILTIN_SEARCH_ENGINES } from '@shared/settings-defaults';
```

注意现有 `import { RotateCcw, X } from 'lucide-react'` 已经导入了 `X`——`X` 已被绑成 close-button 用途，所以新增删除按钮的 `X` icon 起别名 `XIcon` 避免冲突。或简单复用：所有删除按钮也用 `X`，无需别名。**为最小改动，复用现有 `X`，不引入 `XIcon`**：

实际 import 行变为：

```ts
import { RotateCcw, X, Plus } from 'lucide-react';
```

`useState` 现在还没有，要新加。

- [ ] **Step 2: 在 Browsing section 末尾、最外层 `</div>` 之前追加 Search section**

定位：找到 `{/* ── 6. Browsing ─────────────... */}` block 整段（直到该 `</Section>`），在它结束后、外层 `</div>` 关闭之前插入新 section：

```tsx
{/* ── 7. Search ────────────────────────────────────── */}
<Section
  title="Search"
  rightHeader={
    <ResetIcon
      show={
        settings.search.engines.length > BUILTIN_SEARCH_ENGINES.length ||
        settings.search.activeId !== 'google'
      }
      onClick={() =>
        void update({
          search: {
            engines: BUILTIN_SEARCH_ENGINES.map((e) => ({ ...e })),
            activeId: 'google',
          },
        })
      }
      testId="reset-search"
    />
  }
>
  <Row label="Active engine">
    <select
      data-testid="settings-search-active"
      value={settings.search.activeId}
      onChange={(e) =>
        void update({ search: { activeId: e.target.value } })
      }
      className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
    >
      {settings.search.engines.map((eng) => (
        <option key={eng.id} value={eng.id}>
          {eng.name}
        </option>
      ))}
    </select>
  </Row>

  <SearchEngineEditor
    engines={settings.search.engines}
    onAdd={(eng) =>
      void update({
        search: { engines: [...settings.search.engines, eng] },
      })
    }
    onDelete={(id) =>
      void update({
        search: {
          engines: settings.search.engines.filter((e) => e.id !== id),
        },
      })
    }
  />
</Section>
```

- [ ] **Step 3: 修改 `Section` 组件签名以支持 `rightHeader` slot**

定位 `function Section(...)` 当前签名：

```tsx
function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
```

替换为：

```tsx
function Section({
  title,
  children,
  rightHeader,
}: {
  title: string;
  children: ReactNode;
  rightHeader?: ReactNode;
}): ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <div className="mb-1 flex items-center justify-between border-b border-[var(--chrome-border)] pb-1">
        <h3 className="text-sm font-semibold text-[var(--chrome-fg)]">{title}</h3>
        {rightHeader}
      </div>
      {children}
    </section>
  );
}
```

旧的单行 `<h3>` 现在被替换成包了一个 flex 容器，能放可选 right slot。其它现有 Section 调用都没传 `rightHeader`，行为不变（旧有的 Reset 按钮放在每个 `Row` 的 `rightSlot`，不通过这个新 slot）。

- [ ] **Step 4: 在文件底部（`function ResetIcon` 之后）加 `SearchEngineEditor`**

```tsx
interface SearchEngineEditorProps {
  engines: SearchEngine[];
  onAdd: (engine: SearchEngine) => void;
  onDelete: (id: string) => void;
}

function SearchEngineEditor({ engines, onAdd, onDelete }: SearchEngineEditorProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');

  const valid = name.trim() !== '' && urlTemplate.includes('{query}');

  const submit = (): void => {
    if (!valid) return;
    onAdd({ id: nanoid(), name: name.trim(), urlTemplate, builtin: false });
    setName('');
    setUrlTemplate('');
    setExpanded(false);
  };

  const cancel = (): void => {
    setName('');
    setUrlTemplate('');
    setExpanded(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Engines</label>
      <ul data-testid="settings-search-engines" className="flex flex-col gap-1">
        {engines.map((eng) => (
          <li
            key={eng.id}
            className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-[var(--chrome-hover)]"
          >
            <span className="text-[var(--chrome-fg)]">{eng.name}</span>
            {eng.builtin ? (
              <span className="text-xs text-[var(--chrome-muted)]">built-in</span>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${eng.name}`}
                data-testid={`settings-search-delete-${eng.id}`}
                onClick={() => onDelete(eng.id)}
                className="rounded p-1 text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)]"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!expanded ? (
        <button
          type="button"
          data-testid="settings-search-add-toggle"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 self-start rounded p-1 text-xs text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)]"
        >
          <Plus size={14} /> Add custom engine
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 rounded border border-[var(--chrome-border)] bg-[var(--chrome-input-bg)] p-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Name</label>
            <input
              type="text"
              data-testid="settings-search-add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className="rounded bg-[var(--chrome-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">URL template</label>
            <input
              type="text"
              data-testid="settings-search-add-template"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://example.com/search?q={query}"
              spellCheck={false}
              className="rounded bg-[var(--chrome-bg)] px-2 py-1 font-mono text-xs text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            />
            <span className="text-xs text-[var(--chrome-muted)]">Must contain {'{query}'}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="settings-search-add-cancel"
              onClick={cancel}
              className="rounded px-2 py-1 text-xs text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="settings-search-add-confirm"
              onClick={submit}
              disabled={!valid}
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

文件顶部 import 加 `SearchEngine`：

```ts
import type { Settings, ThemeChoice, SearchEngine } from '@shared/types';
```

- [ ] **Step 5: typecheck / lint**

```
pnpm typecheck && pnpm lint
```

Expected: 全过。

- [ ] **Step 6: 全部单测跑一遍**

```
pnpm test
```

Expected: 全过（UI 改没动 unit 路径）。

- [ ] **Step 7: Commit**

```
git add src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat(settings-drawer): add Search section with custom engines (M11 Task 6)

- Active engine <select> drives settings.search.activeId
- Engine list with delete buttons for custom entries (builtins locked)
- Expandable + form to add custom engines (validates {query} placeholder)
- Section-level Reset returns to builtins-only + activeId='google'"
```

---

## Task 7: E2E — Search engines

**Files:**
- Create: `tests/e2e/search-engine.spec.ts`

### 设计

5 个场景：
1. **默认 Google**：地址栏输 `hello world` → URL 跳到 google.com 域。
2. **切到 Bing**：通过 `__sidebrowserTestHooks.updateSettings` 切 `activeId='bing'`，再输入 → 跳 bing.com。
3. **添加自定义 engine**：通过 UI（点 + → 填表 → Add），断言 list 出现新项 + select 出现新 option。
4. **删除当前 active 自定义 engine**：先切 active 到自定义，再删 → 断言 settings.search.activeId fallback 到 `'google'`（通过 hook 读 `getSettings()`）。
5. **重启持久化**：切到 Bing → 重启应用 → 断言仍然是 Bing。

**测试基础设施**：现有 `tests/e2e/settings-drawer.spec.ts` 已经覆盖了 settings drawer 打开 + `updateSettings` hook + 跨重启恢复，可以参考它的设置 / fixture 模式。**不需要新加 hooks**。

### Step

- [ ] **Step 1: 看 `tests/e2e/settings-drawer.spec.ts` 学 fixture 风格**

```
pnpm exec playwright codegen --help  # 不用真跑，知道工具存在即可
```

Read: `tests/e2e/settings-drawer.spec.ts`（手动看一眼前 50 行 + 末尾 `test.afterEach`/`test.beforeEach`），抄 pattern。

- [ ] **Step 2: 写 `tests/e2e/search-engine.spec.ts`**

完整内容（基于现有 e2e 风格猜测；如某些 import 路径与现有 specs 不一致，参照同目录其它 spec 调整 ）：

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.cjs')],
    env: { ...process.env, SIDEBROWSER_E2E: '1', ELECTRON_RUN_AS_NODE: '' },
  });
});

test.afterEach(async () => {
  await app?.close();
});

test('default search engine routes to Google', async () => {
  const page = await app.firstWindow();
  // 等待 React 挂载
  await page.waitForSelector('[data-testid=address-bar]');
  await page.fill('[data-testid=address-bar]', 'hello world');
  await page.press('[data-testid=address-bar]', 'Enter');
  // 等待 navigate 触发后 URL 更新
  await expect.poll(async () =>
    app.evaluate(({ }) =>
      (globalThis as any).__sidebrowserTestHooks.getActiveWebContents()?.getURL(),
    ),
  ).toMatch(/google\.com\/search\?q=hello/);
});

test('switching active engine to Bing routes via Bing', async () => {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=address-bar]');
  await app.evaluate(() => {
    (globalThis as any).__sidebrowserTestHooks.updateSettings({
      search: { activeId: 'bing' },
    });
  });
  await page.fill('[data-testid=address-bar]', 'foo bar');
  await page.press('[data-testid=address-bar]', 'Enter');
  await expect.poll(async () =>
    app.evaluate(() =>
      (globalThis as any).__sidebrowserTestHooks.getActiveWebContents()?.getURL(),
    ),
  ).toMatch(/bing\.com\/search\?q=foo/);
});

test('add custom engine via drawer UI', async () => {
  const page = await app.firstWindow();
  await page.click('[data-testid=topbar-settings-toggle]');
  await page.waitForSelector('[data-testid=settings-drawer]');

  await page.click('[data-testid=settings-search-add-toggle]');
  await page.fill('[data-testid=settings-search-add-name]', 'StackOverflow');
  await page.fill('[data-testid=settings-search-add-template]', 'https://stackoverflow.com/search?q={query}');
  await page.click('[data-testid=settings-search-add-confirm]');

  // engine list 出现新项
  await expect(page.locator('[data-testid=settings-search-engines]'))
    .toContainText('StackOverflow');
});

test('deleting active custom engine falls back to google', async () => {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=address-bar]');

  // 加自定义 + 切到它
  const customId = await app.evaluate(() => {
    const id = 'so-test-id';
    const cur = (globalThis as any).__sidebrowserTestHooks.getSettings();
    (globalThis as any).__sidebrowserTestHooks.updateSettings({
      search: {
        engines: [
          ...cur.search.engines,
          { id, name: 'SO', urlTemplate: 'https://so.com/?q={query}', builtin: false },
        ],
        activeId: id,
      },
    });
    return id;
  });
  expect(customId).toBe('so-test-id');

  // 现在删除该 engine
  await app.evaluate((id) => {
    const cur = (globalThis as any).__sidebrowserTestHooks.getSettings();
    (globalThis as any).__sidebrowserTestHooks.updateSettings({
      search: { engines: cur.search.engines.filter((e: any) => e.id !== id) },
    });
  }, customId);

  // activeId 应 fallback 到 google
  const finalActive = await app.evaluate(
    () => (globalThis as any).__sidebrowserTestHooks.getSettings().search.activeId,
  );
  expect(finalActive).toBe('google');
});

test('active engine persists across restart', async () => {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=address-bar]');
  await app.evaluate(() => {
    (globalThis as any).__sidebrowserTestHooks.updateSettings({
      search: { activeId: 'duckduckgo' },
    });
  });
  await app.close();

  // 重启
  app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.cjs')],
    env: { ...process.env, SIDEBROWSER_E2E: '1', ELECTRON_RUN_AS_NODE: '' },
  });
  await app.firstWindow().then((p) => p.waitForSelector('[data-testid=address-bar]'));

  const restored = await app.evaluate(
    () => (globalThis as any).__sidebrowserTestHooks.getSettings().search.activeId,
  );
  expect(restored).toBe('duckduckgo');
});
```

注意：上面写的 fixture 风格是参考型；实际 launch 路径 / env 设置请打开 `tests/e2e/settings-drawer.spec.ts` 抄过来再调整（比如 userData dir 隔离等）。

- [ ] **Step 3: 跑 E2E**

```
pnpm test:e2e -- search-engine
```

Expected: 5 个测试全过。如挂——常见原因：

- launch 路径与现有 specs 不一致 → 抄 settings-drawer.spec.ts
- userData 没隔离导致重启测受其它 spec 污染 → 检查现有 fixture 是否提供临时 userData dir
- `await page.waitForSelector('[data-testid=address-bar]')` 超时 → React 还没 mount，加 `await app.firstWindow()` 后再 wait

- [ ] **Step 4: Commit**

```
git add tests/e2e/search-engine.spec.ts
git commit -m "test(e2e): search engine selection / add / delete / persist (M11 Task 7)"
```

---

## Task 8: TDD ViewManager zoom — Map + zoom-changed listener + did-navigate reapply + closeTab cleanup

**Files:**
- Modify: `src/main/view-manager.ts`
- Create: `tests/unit/view-manager-zoom.test.ts`

### 设计

把 zoom 当成 ViewManager 的内部状态：`Map<tabId, number>`，由 `webContents.on('zoom-changed')` 驱动 + `did-navigate` reapply + `closeTab` 清理 + `resetActiveZoom()` 公共方法。

**为什么单测能 cover：** zoom-changed handler 是 closure 捕获 tabId + 调 setZoomFactor 的纯逻辑——伪造一个 minimal `webContents` mock（`on(event, handler)` 记录、`emit(event, ...)` 派发、`setZoomFactor(n)` 记录调用）就能跑。我们不依赖真 Electron WebContents。

**关键挑战：** ViewManager 构造需要 `BrowserWindow` 引用 + `getBrowsingDefaults` getter。单测里 `BrowserWindow` 也是 mock。但 ViewManager 的 zoom 路径只依赖 `webContents.on / setZoomFactor`，单测可绕开整个 createTab 流程，直接调用一个新拆出的小 helper 测：

**实现策略**：在 ViewManager 内部抽一个 `attachZoomHandlers(view, id)` 私有方法（与现有 `attachWebContentsEvents` 同模式），单测直接调它的子 helper，或单测整体测 ViewManager + mock 全套（如已有同模式 fixture，复用之）。

**保守路线（推荐）**：把 zoom 逻辑提取成 *exported pure-ish helpers*，让单测只测 helper：

```ts
// view-manager.ts 内部
export function nextZoomFactor(current: number, dir: 'in' | 'out'): number {
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.0;
  const ZOOM_STEP = 0.1;
  const delta = dir === 'in' ? +ZOOM_STEP : -ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta));
}
```

这是 pure；单测 cover ±10% / clamp / 浮点累积误差。

**集成行为（zoom-changed → setZoomFactor、did-navigate → reapply、closeTab → 清理）** 通过 E2E 测（Task 10）覆盖；纯函数走单测。

### Step

- [ ] **Step 1: 写 failing 单测 `tests/unit/view-manager-zoom.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { nextZoomFactor } from '../../src/main/view-manager';

describe('nextZoomFactor', () => {
  it('+0.1 on "in" from 1.0', () => {
    expect(nextZoomFactor(1.0, 'in')).toBeCloseTo(1.1, 5);
  });

  it('-0.1 on "out" from 1.0', () => {
    expect(nextZoomFactor(1.0, 'out')).toBeCloseTo(0.9, 5);
  });

  it('clamps at upper bound 3.0', () => {
    expect(nextZoomFactor(3.0, 'in')).toBeCloseTo(3.0, 5);
    expect(nextZoomFactor(2.95, 'in')).toBeCloseTo(3.0, 5);
  });

  it('clamps at lower bound 0.5', () => {
    expect(nextZoomFactor(0.5, 'out')).toBeCloseTo(0.5, 5);
    expect(nextZoomFactor(0.55, 'out')).toBeCloseTo(0.5, 5);
  });

  it('handles repeated "in" steps cumulatively', () => {
    let z = 1.0;
    for (let i = 0; i < 5; i++) z = nextZoomFactor(z, 'in');
    expect(z).toBeCloseTo(1.5, 5);
  });

  it('handles repeated "out" steps cumulatively', () => {
    let z = 1.0;
    for (let i = 0; i < 3; i++) z = nextZoomFactor(z, 'out');
    expect(z).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 2: 跑 fail**

```
pnpm test -- view-manager-zoom
```

Expected: FAIL — `nextZoomFactor` 还没 export。

- [ ] **Step 3: 改 `src/main/view-manager.ts`**

在文件顶层（class ViewManager 前）export `nextZoomFactor` + 常量：

```ts
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

/**
 * Pure helper for the zoom-changed handler. Computed step bounded by [0.5, 3.0]
 * so the handler can be unit-tested without a real WebContents.
 */
export function nextZoomFactor(current: number, dir: 'in' | 'out'): number {
  const delta = dir === 'in' ? +ZOOM_STEP : -ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta));
}
```

在 `class ViewManager` 内（与 `private suppressed = false;` 同区）加：

```ts
/**
 * Per-tab zoom factor (1.0 = 100%). Default 1.0 is implicit (`get(...) ?? 1.0`).
 * Map entries are removed on closeTab. Not persisted by design (spec §6.1).
 */
private readonly zoomFactors = new Map<string, number>();
```

修改 `attachWebContentsEvents`（参考 src/main/view-manager.ts:417-494 现有结构）：

a) 在 `const onNavigate = ...` 函数体里追加 reapply（**在现有 setUserAgent / CDP 调用块旁**）：

```ts
const onNavigate = (_e: Electron.Event, url: string): void => {
  this.updateTab(id, {
    url,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  });
  // M10.5 mobile reapply (existing) ...
  const tab = this.tabs.get(id)?.tab;
  if (tab?.isMobile && wc.debugger.isAttached()) {
    const ua = this.getBrowsingDefaults().mobileUserAgent;
    const b = this.window.getContentBounds();
    void attachCdpEmulation(wc, parseUaForMetadata(ua), ua, { width: b.width, height: b.height });
  }
  // M11 zoom reapply：Chromium 在 did-navigate 后重置 zoomFactor 为 1.0；
  // 我们的"每 tab 独立"语义要求 reapply 用户调整过的值。
  const z = this.zoomFactors.get(id);
  if (z !== undefined && z !== 1.0) {
    wc.setZoomFactor(z);
  }
};
```

b) 在 `attachWebContentsEvents` 末尾（return cleanup closure 之前），新加 zoom-changed listener + cleanup：

```ts
const onZoomChanged = (_e: Electron.Event, dir: 'in' | 'out'): void => {
  const cur = this.zoomFactors.get(id) ?? 1.0;
  const next = nextZoomFactor(cur, dir);
  this.zoomFactors.set(id, next);
  wc.setZoomFactor(next);
};
wc.on('zoom-changed', onZoomChanged);
```

把 cleanup closure 增补：

```ts
return (): void => {
  wc.off('did-start-loading', onStart);
  wc.off('did-stop-loading', onStop);
  wc.off('did-navigate', onNavigate);
  wc.off('did-navigate-in-page', onNavigate);
  wc.off('page-title-updated', onTitle);
  wc.off('page-favicon-updated', onFavicon);
  wc.off('devtools-opened', onDevtoolsOpened);
  wc.off('devtools-closed', onDevtoolsClosed);
  wc.off('zoom-changed', onZoomChanged);
};
```

c) 在 `closeTab` 函数体（第一行 `if (!managed) return;` 之后）加：

```ts
this.zoomFactors.delete(id);
```

- [ ] **Step 4: 跑单测**

```
pnpm test -- view-manager-zoom
```

Expected: 全过。

- [ ] **Step 5: typecheck + lint + 全单测**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。

- [ ] **Step 6: Commit**

```
git add src/main/view-manager.ts tests/unit/view-manager-zoom.test.ts
git commit -m "feat(view-manager): per-tab zoom via Ctrl+wheel (M11 Task 8)

- nextZoomFactor pure helper: [0.5, 3.0] bounded, ±0.1 step
- zoomFactors: Map<tabId, number> (default 1.0, not persisted)
- 'zoom-changed' listener handles Ctrl+wheel from Chromium
- did-navigate reapplies zoomFactor (Chromium resets to 1.0 on navigation)
- closeTab cleans up the Map entry"
```

---

## Task 9: `resetActiveZoom()` + Ctrl+0 menu accelerator

**Files:**
- Modify: `src/main/view-manager.ts`
- Modify: `src/main/keyboard-shortcuts.ts`
- Modify: `src/main/index.ts`

### 设计

加 `ViewManager.resetActiveZoom()` 公共方法 + `keyboard-shortcuts.ts` 的 Ctrl+0 menu item，wire 在 index.ts。无 IPC。

### Step

- [ ] **Step 1: `src/main/view-manager.ts` — 加 `resetActiveZoom`**

定位现有的 active-tab convenience wrappers 区（src/main/view-manager.ts:277-304），在 `toggleDevToolsActive` 之后追加：

```ts
/** Ctrl+0 handler. Resets the active tab's zoom to 100%. No-op when no tab is active. */
resetActiveZoom(): void {
  if (!this.activeId) return;
  const wc = this.getActiveWebContents();
  if (!wc) return;
  this.zoomFactors.set(this.activeId, 1.0);
  wc.setZoomFactor(1.0);
}
```

- [ ] **Step 2: `src/main/keyboard-shortcuts.ts` — 加 onResetZoom + menu item**

`ShortcutDeps` interface 追加：

```ts
/** Ctrl+0 — resets the active tab's zoom to 100%. */
onResetZoom: () => void;
```

`buildShortcutMenuTemplate` 的 submenu 数组追加（顺序放在 `Toggle DevTools` 之前；spec §15 不规定顺序，按现有 group 风格排在 reload/back/forward 之后比较合理）：

```ts
{ label: 'Reset Zoom',         accelerator: 'CmdOrCtrl+0',   click: () => deps.onResetZoom() },
```

具体位置（修改后的 submenu 顺序）：

```ts
const submenu: MenuItemConstructorOptions[] = [
  { label: 'New Tab',           accelerator: 'CmdOrCtrl+T',   click: () => deps.onNewTab() },
  { label: 'Close Tab',         accelerator: 'CmdOrCtrl+W',   click: () => deps.onCloseActiveTab() },
  { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L',   click: () => deps.emitToRenderer('focus-address-bar') },
  { label: 'Reload',            accelerator: 'CmdOrCtrl+R',   click: () => deps.onReloadActive() },
  { label: 'Reload (F5)',       accelerator: 'F5',            click: () => deps.onReloadActive() },
  { label: 'Back',              accelerator: 'Alt+Left',      click: () => deps.onGoBack() },
  { label: 'Forward',           accelerator: 'Alt+Right',     click: () => deps.onGoForward() },
  { label: 'Toggle Tab Drawer', accelerator: 'CmdOrCtrl+Tab', click: () => deps.emitToRenderer('toggle-tab-drawer') },
  { label: 'Toggle Settings',   accelerator: 'CmdOrCtrl+,',   click: () => deps.emitToRenderer('toggle-settings-drawer') },
  { label: 'Reset Zoom',        accelerator: 'CmdOrCtrl+0',   click: () => deps.onResetZoom() },
  { label: 'Toggle DevTools',   accelerator: 'F12',           click: () => deps.onToggleDevTools() },
];
```

- [ ] **Step 3: `src/main/index.ts` — wire onResetZoom**

定位 `installApplicationMenu({ ... })` 调用（src/main/index.ts:145-155），追加：

```ts
installApplicationMenu({
  onNewTab: () => { viewManager.createTab('about:blank'); },
  onCloseActiveTab: () => { viewManager.closeActiveTab(); },
  onReloadActive: () => { viewManager.reloadActive(); },
  onGoBack: () => { viewManager.goBackActive(); },
  onGoForward: () => { viewManager.goForwardActive(); },
  onToggleDevTools: () => { viewManager.toggleDevToolsActive(); },
  onResetZoom: () => { viewManager.resetActiveZoom(); },
  emitToRenderer: (action) => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.chromeShortcut, { action });
  },
});
```

- [ ] **Step 4: 跑 keyboard-shortcuts 单测（如存在）**

```
pnpm test -- keyboard-shortcuts
```

Expected: 现有测可能数 menu items 数量 = 10。本 task 让它变 11。如有 hard-coded count 断言，把 10 改 11，并加一条断言 Ctrl+0 存在：

```ts
const submenu = (template[0]!.submenu as MenuItemConstructorOptions[]);
expect(submenu).toHaveLength(11);
const resetZoom = submenu.find((i) => i.accelerator === 'CmdOrCtrl+0');
expect(resetZoom?.label).toBe('Reset Zoom');
resetZoom?.click?.(/* … */);  // 验 click 触发 onResetZoom
```

如现有测对应文件名是 `tests/unit/keyboard-shortcuts.test.ts`（按命名习惯），按上述补强。如不存在该文件，**不**新建（属于实现外的文档型工作）。

- [ ] **Step 5: typecheck + lint**

```
pnpm typecheck && pnpm lint
```

Expected: 全过。

- [ ] **Step 6: Commit**

```
git add src/main/view-manager.ts src/main/keyboard-shortcuts.ts src/main/index.ts tests/unit/keyboard-shortcuts.test.ts
git commit -m "feat(zoom): Ctrl+0 reset accelerator + ViewManager.resetActiveZoom (M11 Task 9)"
```

（如 keyboard-shortcuts.test.ts 不存在，从 add 列表去掉。）

---

## Task 10: E2E hooks + Zoom E2E spec

**Files:**
- Modify: `src/main/index.ts`（hooks 增加 3 个）
- Create: `tests/e2e/zoom.spec.ts`

### 设计

Zoom 的 IPC 不存在，E2E 必须通过 `__sidebrowserTestHooks` 直接戳 webContents。3 个新 hook：
- `getActiveZoomFactor(): number` — 读 active tab 的 `webContents.getZoomFactor()`
- `emitZoomChange(dir: 'in' | 'out'): void` — 在 active tab 的 webContents 上 `emit('zoom-changed', null, dir)`，模拟 Chromium 的 Ctrl+wheel
- `triggerResetZoom(): void` — 直接调 `viewManager.resetActiveZoom()`（绕开 menu accelerator 的测试 flake）

### Step

- [ ] **Step 1: 改 `src/main/index.ts` — 加 3 个 hook**

定位 `__sidebrowserTestHooks` 块（src/main/index.ts:317-335），在末尾对象字面量里追加 3 行：

```ts
(globalThis as Record<string, unknown>)['__sidebrowserTestHooks'] = {
  // ... 现有 hooks ...
  // M11 zoom hooks
  getActiveZoomFactor: () => viewManager.getActiveWebContents()?.getZoomFactor() ?? 1.0,
  emitZoomChange: (dir: 'in' | 'out') => {
    const wc = viewManager.getActiveWebContents();
    if (wc) wc.emit('zoom-changed', null, dir);
  },
  triggerResetZoom: () => viewManager.resetActiveZoom(),
};
```

- [ ] **Step 2: 写 `tests/e2e/zoom.spec.ts`**

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.cjs')],
    env: { ...process.env, SIDEBROWSER_E2E: '1', ELECTRON_RUN_AS_NODE: '' },
  });
});

test.afterEach(async () => {
  await app?.close();
});

test('Ctrl+wheel "in" three times → zoom = 1.3', async () => {
  await app.firstWindow();  // ensure ready
  await app.evaluate(() => {
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.emitZoomChange('in');
    h.emitZoomChange('in');
    h.emitZoomChange('in');
  });
  await expect.poll(async () =>
    app.evaluate(() => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor()),
  ).toBeCloseTo(1.3, 5);
});

test('clamps at upper bound 3.0', async () => {
  await app.firstWindow();
  await app.evaluate(() => {
    const h = (globalThis as any).__sidebrowserTestHooks;
    for (let i = 0; i < 25; i++) h.emitZoomChange('in');
  });
  const z = await app.evaluate(
    () => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor(),
  );
  expect(z).toBeCloseTo(3.0, 5);
});

test('clamps at lower bound 0.5', async () => {
  await app.firstWindow();
  await app.evaluate(() => {
    const h = (globalThis as any).__sidebrowserTestHooks;
    for (let i = 0; i < 10; i++) h.emitZoomChange('out');
  });
  const z = await app.evaluate(
    () => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor(),
  );
  expect(z).toBeCloseTo(0.5, 5);
});

test('triggerResetZoom restores 100%', async () => {
  await app.firstWindow();
  await app.evaluate(() => {
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.emitZoomChange('in');
    h.emitZoomChange('in');
  });
  await expect.poll(async () =>
    app.evaluate(() => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor()),
  ).toBeCloseTo(1.2, 5);

  await app.evaluate(
    () => (globalThis as any).__sidebrowserTestHooks.triggerResetZoom(),
  );
  await expect.poll(async () =>
    app.evaluate(() => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor()),
  ).toBeCloseTo(1.0, 5);
});

test('zoom survives navigation (did-navigate reapply)', async () => {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=address-bar]');
  await app.evaluate(() => {
    const h = (globalThis as any).__sidebrowserTestHooks;
    h.emitZoomChange('in');
    h.emitZoomChange('in');
  });
  // 导航到一个简单页（about:blank → about:blank 也触发 did-navigate？保险用 https URL）
  await page.fill('[data-testid=address-bar]', 'https://example.com');
  await page.press('[data-testid=address-bar]', 'Enter');
  // 等 did-navigate 触发后 reapply
  await expect.poll(
    async () =>
      app.evaluate(() => (globalThis as any).__sidebrowserTestHooks.getActiveZoomFactor()),
    { timeout: 10000 },
  ).toBeCloseTo(1.2, 5);
});
```

- [ ] **Step 3: 跑 E2E**

```
pnpm test:e2e -- zoom
```

Expected: 5 个测试全过。常见挂法：
- `wc.emit('zoom-changed', null, 'in')` 的事件 signature 与 Electron 内部不一致 → 改成 `wc.emit('zoom-changed', { sender: wc } as any, 'in')`，给伪 event 对象。
- `did-navigate` 在 `https://example.com` 被防火墙挡导致超时 → 用本地 about:blank 替代，但要确认 `setZoomFactor` 在 about: 页面被持久（实际 Chromium about:blank 跨 navigation 会同样重置）。如有疑虑，spec §6.4 写的 `did-navigate` 是对真 URL 触发，本测必须连真网站。
- 网络环境受限时把 `https://example.com` 改成 `data:text/html,<h1>x</h1>`（data: scheme 也触发 did-navigate）。

- [ ] **Step 4: Commit**

```
git add src/main/index.ts tests/e2e/zoom.spec.ts
git commit -m "test(e2e): zoom step / clamp / reset / cross-navigation (M11 Task 10)"
```

---

## Task 11: 主 design doc §15 同步 — 加 Ctrl+0 行

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-sidebrowser-design.md`

### 设计

机械追加。

### Step

- [ ] **Step 1: 改 §15 表**

定位 [docs/superpowers/specs/2026-04-23-sidebrowser-design.md:507](docs/superpowers/specs/2026-04-23-sidebrowser-design.md#L507) 附近的快捷键表（含 `F12 — 打开当前 tab 的 DevTools`）。在 `F12` 行之前插入：

```
| `Ctrl+0` | 复位当前 tab 缩放至 100% | 应用内 |
```

- [ ] **Step 2: typecheck / lint / test 一次（保险）**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过（spec 文件改动不影响代码）。

- [ ] **Step 3: Commit**

```
git add docs/superpowers/specs/2026-04-23-sidebrowser-design.md
git commit -m "docs(spec): §15 add Ctrl+0 reset zoom shortcut (M11)"
```

---

## Task 12: Final validation gate + 用户冒烟 + tag

**Files:** none（验证 + tag）

### 设计

走完整 CI 命令一遍 + 把球抛回用户做手动冒烟（spec §13 完成定义里列的 6 项）。用户确认通过后打 `m11-search-and-zoom` tag。

### Step

- [ ] **Step 1: 跑全部检查**

```
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: 全过。

- [ ] **Step 2: 报告用户做手动冒烟**

按 spec §13 的 6 项发清单给用户：

```
M11 实现完成，请手动冒烟以下 6 项后我打 tag：

1. pnpm dev 启动；地址栏输 "hello world" → 跳到 google.com/search?q=...
2. 设置抽屉切到 Bing → 同输入 → 跳 bing.com
3. 添加自定义 engine（如 StackOverflow + URL 含 {query}）→ 切到它 → 输入 → 跳自定义 URL
4. 网页内 Ctrl+滚轮上滑 → 内容明显放大；Ctrl+滚轮下滑 → 内容明显缩小
5. Ctrl+0 → 内容恢复 100%
6. 切 tab 后 zoom 各自独立（A tab 调到 1.5，切到 B tab 仍是 1.0）
7. 重启应用一次（pnpm dev 关掉再启），search engines 列表 + active 都还在
```

- [ ] **Step 3: 等用户回报"通过"后打 tag**

```
git tag m11-search-and-zoom
git push origin m11-search-and-zoom    # 用户授权才推
```

如果冒烟挂了某项，回到对应 task 修，重新走 Step 1-2 直到用户确认。

---

## Self-Review Checklist（plan 写完后我自查）

**1. Spec coverage：**
- §3 Settings schema → Task 1
- §4 clampSearch 6 不变量 → Task 3（10 子测试 1:1 对应）
- §5 normalizeUrlInput 改造 → Task 4
- §5.2 TopBar 接入 → Task 5
- §6 Zoom 实现（Map / zoom-changed / did-navigate reapply / closeTab 清理） → Task 8
- §6.6 resetActiveZoom → Task 9
- §7 Ctrl+0 menu accelerator → Task 9
- §8 SettingsDrawer Search section → Task 6
- §9.1 三个单测文件 → Task 3 / Task 4 / Task 8
- §9.2 两个 E2E spec → Task 7 / Task 10
- §9.3 三个 hook → Task 10
- §10 错误处理与边界场景 → 全部由 clampSearch（Task 3）/ TopBar 兜底（Task 5）/ did-navigate reapply（Task 8）覆盖
- 主 design doc §15 同步 → Task 11
- 最终 gate + tag → Task 12

**2. Placeholder scan：** 无 TBD/TODO；Task 9 Step 4 的"如不存在该文件，不新建"是机动指示，不是占位符。

**3. Type consistency：**
- `SearchEngine` 接口在 Task 1 定义、Task 3 / 6 引用——字段名 `id` / `name` / `urlTemplate` / `builtin` 全程一致。
- `nextZoomFactor(current, dir)` 在 Task 8 export，被 view-manager 内部 `onZoomChanged` 调用——签名匹配。
- `resetActiveZoom()` 在 Task 9 加，被 `index.ts` 的 `installApplicationMenu` deps 引用——一致。
- `BUILTIN_SEARCH_ENGINES` / `BUILTIN_SEARCH_ENGINE_IDS` 命名在 Task 1 定义、Task 3 / Task 6 引用——一致。
- E2E hooks 名 `getActiveZoomFactor` / `emitZoomChange` / `triggerResetZoom` 在 Task 10 同时定义 + 使用——一致。

无问题。
