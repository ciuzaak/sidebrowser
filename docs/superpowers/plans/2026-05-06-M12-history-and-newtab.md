# M12: History Store + NewTab + Address-bar Autocomplete — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。Steps 用 checkbox 跟踪。

**Date:** 2026-05-06
**前置：** `m11-search-and-zoom` 之后；`main` clean。

**Goal:** 给 sidebrowser 加浏览历史的持久化能力，并在两个面消费它：(1) `about:blank` 时 React 层覆盖一个 NewTab 页，列出最近 12 条访问；(2) 地址栏 focus 时显示最多 8 条历史下拉，输入时实时过滤、↑/↓/Enter/Esc 键盘可控。NewTab 顶部留 Globe icon 占位，下一里程碑替换为搜索框。`m12-history-and-newtab` tag 落地。

**Architecture:** 三段式后端：`HistoryStore`（CRUD + LRU + debounced persist，照 `settings-store.ts` 模式）→ `HistoryRecorder`（记录策略 + revoke，从 ViewManager 事件接进来）→ `suggestion-ranker`（纯函数，三档 tier + frecency score）。`ViewManager` 在已有的 `did-navigate` / `page-title-updated` / `page-favicon-updated` 回调里加 4 处 recorder 调用；新增 `did-fail-load` 监听做 revoke。3 个新 invoke + 1 个广播：`history:recent`、`history:suggest`、`history:remove`、`history:changed`。Renderer 加 3 个新组件 `Favicon` / `NewTab` / `AddressSuggestions`，`App.tsx` 把现有单源 `setViewSuppressed(settingsOpen)` 扩展为三源 OR（`settingsOpen || suggestionsOpen || isNewTab`）。

**Tech stack delta:** 无新依赖。`electron-store` / `lucide-react` 已在依赖里。

**Spec reference:** [docs/superpowers/specs/2026-05-06-history-and-newtab-design.md](../specs/2026-05-06-history-and-newtab-design.md)

**全局 guardrails：**
- **Electron 命令前 `unset ELECTRON_RUN_AS_NODE`**：用户 shell env 全局污染该变量；走 `pnpm dev / build / test:e2e` 必须先 unset，或用 `scripts/run.mjs`（已 unset）。所有 `pnpm dev` / `pnpm test:e2e` 命令通过 `node scripts/run.mjs` 包了一层。**直接 `pnpm test`/`pnpm typecheck`/`pnpm lint` 安全**（vitest 不需要 Electron 环境）。
- **Per-task commit**：每个 Task 末尾一次 atomic commit，message 见任务末。
- **不动**：M0–M11 已实现的 EdgeDock / DimController / SessionManager / MobileEmulation / Search engines / Zoom / 现有快捷键。M12 只在 SettingsStore 旁边新加 HistoryStore + 在 ViewManager / IPC / preload / renderer 打 patch。
- **Plan execution convention**（用户偏好，记录在 memory）：每个 Task 完成后主动汇报；要偏离 plan 先问；用户负责手动冒烟；`m12-history-and-newtab` tag 用户确认手动冒烟通过后才打。

---

## File Structure

**新增文件（10 个）：**

| 文件 | 角色 |
|---|---|
| `src/main/history-store.ts` | `HistoryStore` 类 + `HistoryStoreBackend` interface + `createElectronHistoryBackend()` 工厂 |
| `src/main/history-recorder.ts` | `HistoryRecorder` 类，把 ViewManager 事件翻译成 store 调用 + revoke 决策 |
| `src/main/suggestion-ranker.ts` | `rankSuggestions()` / `recentEntries()` / `stripScheme()` 纯函数 |
| `src/renderer/src/components/Favicon.tsx` | NewTab + AddressSuggestions 共用的小组件，favicon 图 + Globe 兜底 |
| `src/renderer/src/components/NewTab.tsx` | `about:blank` 时的覆盖层，列出最近访问 |
| `src/renderer/src/components/AddressSuggestions.tsx` | TopBar 下拉 + 键盘高亮（forwardRef + imperative handle） |
| `tests/unit/history-store.test.ts` | sanitize / upsert / patches / eviction / debounce |
| `tests/unit/history-recorder.test.ts` | scheme filter / revoke 决策 / forgetTab |
| `tests/unit/suggestion-ranker.test.ts` | tier 排序 / frecency score / 大小写 / stripScheme |
| `tests/unit/view-manager-history.test.ts` | ViewManager 在 did-navigate / did-fail-load / closeTab 时调对 recorder |
| `tests/e2e/newtab.spec.ts` | NewTab 显示/隐藏 / 列表 / 删除单条 |
| `tests/e2e/autocomplete.spec.ts` | 下拉 focus 出现 / 输入过滤 / 键盘选择 / Esc 关闭 |

**改动文件（8 个）：**

| 文件 | 变化 |
|---|---|
| `src/shared/types.ts` | + `HistoryEntry` / `Suggestion` |
| `src/shared/ipc-contract.ts` | + 4 个 channel + `IpcContract` 4 个条目 |
| `src/preload/index.ts` | + `historyRecent` / `historySuggest` / `historyRemove` / `onHistoryChanged` |
| `src/main/view-manager.ts` | 构造函数 + recorder；`onNavigate` / `onTitle` / `onFavicon` 各加一行；新增 `did-fail-load` 监听；`closeTab` 加 forgetTab |
| `src/main/ipc-router.ts` | + 3 个 handler；HistoryStore.onChanged → broadcast `history:changed` |
| `src/main/index.ts` | 构造 HistoryStore + HistoryRecorder，注入 ViewManager；`before-quit` flush；activate 路径同步加上 |
| `src/renderer/src/App.tsx` | 集中 suppression：三源 OR；`isNewTab && <NewTab />` 渲染 |
| `src/renderer/src/components/TopBar.tsx` | 集成 AddressSuggestions：focus / blur / 键盘 / picked URL 优先于 normalize |

---

## Task 1: 共享类型 + IPC 通道常量与 contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `tests/unit/ipc-contract.test.ts`

### 设计

机械改动，无运行时行为。把后续所有 task 都要 import 的类型和通道名一次性加好，避免后面互相 block。

`HistoryEntry` / `Suggestion` 字段 spec §3.1 已定义。4 个 channel：3 个 invoke（`history:recent` / `history:suggest`、皆带 payload；`history:remove` 是 fire-and-forget send）+ 1 个 M→R 广播 `history:changed`（payload = 空对象，仅信号）。

### Steps

- [ ] **Step 1: 在 `src/shared/types.ts` 末尾加 `HistoryEntry` 与 `Suggestion`**

```ts
// 末尾（在 SettingsPatch 之后）追加：

/**
 * 单条浏览历史。URL 是去重主键 — 重访同一 URL 只更新 lastVisitedAt + visitCount。
 * Title / favicon 由 page-title-updated / page-favicon-updated 事件后填，
 * 非空才覆盖（避免页面切换瞬间被空值清空）。
 */
export interface HistoryEntry {
  /** 去重主键。从 did-navigate 拿到的 canonicalized URL（host 已 lowercased）。 */
  url: string;
  /** 页面标题。空字符串 = 还没收到 page-title-updated 事件。 */
  title: string;
  /** Favicon URL（http(s) 或 data:）。null = 没收到事件或页面无 favicon。 */
  favicon: string | null;
  /** 首次访问的 epoch ms。LRU 计数不参考此字段。 */
  firstVisitedAt: number;
  /** 最近一次访问的 epoch ms。LRU 用此字段，autocomplete 排序也用。 */
  lastVisitedAt: number;
  /** 访问次数。≥ 1。每次 did-navigate（非 SPA 内导航）+1。 */
  visitCount: number;
}

/**
 * 自动补全单项。HistoryEntry 的子集（剥掉 firstVisitedAt 与 visitCount，前端不直接用）。
 * `tier` 用于调试 / 测试（v1 UI 不染色）。
 */
export interface Suggestion {
  url: string;
  title: string;
  favicon: string | null;
  /** 0 = URL 前缀；1 = URL substring；2 = title substring。 */
  tier: 0 | 1 | 2;
}
```

- [ ] **Step 2: 在 `src/shared/ipc-contract.ts` `IpcChannels` 对象末尾加 4 行**

```ts
// 在 nativeThemeGet 之后追加（注意尾逗号）：
  /** R→M invoke. 取最近 N 条历史，按 lastVisitedAt 倒序。 */
  historyRecent: 'history:recent',
  /** R→M invoke. 历史自动补全：按查询字符串返回 ≤8 条 Suggestion。 */
  historySuggest: 'history:suggest',
  /** R→M send. 删除一条历史；不存在的 URL 静默 no-op。 */
  historyRemove: 'history:remove',
  /** M→R event. 历史变更信号 — payload 空对象，renderer 自己 re-fetch。 */
  historyChanged: 'history:changed',
```

- [ ] **Step 3: 在 `IpcContract` interface 末尾加 4 个条目**

```ts
// 紧跟 nativeThemeGet 之后（注意 import HistoryEntry / Suggestion）：

  [IpcChannels.historyRecent]: {
    request: { limit: number };
    response: HistoryEntry[];
  };
  [IpcChannels.historySuggest]: {
    request: { query: string };
    response: Suggestion[];
  };
  [IpcChannels.historyRemove]: {
    request: { url: string };
    response: void;
  };
  [IpcChannels.historyChanged]: {
    /** 仅信号；renderer 收到后自己 re-fetch。 */
    request: Record<string, never>;
    response: void;
  };
```

文件顶部 import 加 `HistoryEntry, Suggestion`：

```ts
import type { HistoryEntry, Settings, SettingsPatch, Suggestion, Tab, TabsSnapshot, WindowState } from './types';
```

- [ ] **Step 4: 在 `tests/unit/ipc-contract.test.ts` 加新 channel 的断言**

文件末尾、`'all channel values follow ...'` 那一条之前插入：

```ts
  it('defines history channels', () => {
    expect(IpcChannels.historyRecent).toBe('history:recent');
    expect(IpcChannels.historySuggest).toBe('history:suggest');
    expect(IpcChannels.historyRemove).toBe('history:remove');
    expect(IpcChannels.historyChanged).toBe('history:changed');
  });
```

- [ ] **Step 5: typecheck + 单测**

Run: `pnpm typecheck && pnpm test`
Expected: PASS（包括新 ipc-contract 测试；其余测试不受影响）

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/ipc-contract.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(M12): add HistoryEntry/Suggestion types + history IPC channels"
```

---

## Task 2: `HistoryStore` — 持久化 + LRU + 订阅（TDD）

**Files:**
- Create: `src/main/history-store.ts`
- Create: `tests/unit/history-store.test.ts`

### 设计

照 `settings-store.ts` 的 backend 注入模式：把 electron-store 的真实 IO 隔离到 `HistoryStoreBackend` 接口，单测里用 fake backend。`HistoryStore` 内部持 `Map<string, HistoryEntry>`（按 URL 索引）；构造时同步 load + sanitize。每次写操作 schedule 一次 1000ms debounce 的 backend.set；`flush()` 立刻写。

LRU 策略：`upsert` 后若 `entries.size > 500` 则线性扫描找 `lastVisitedAt` 最小的删掉。500 条规模下每次 < 1ms。

`onChanged` 监听器使用一个 16ms 节流（multiple `patch*` 在同一 frame 内只 fire 一次）——避免 page-title-updated / page-favicon-updated 连发时 IPC 风暴。

### Steps

- [ ] **Step 1: 写 `tests/unit/history-store.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HistoryStore,
  type HistoryStoreBackend,
  sanitizePersistedHistory,
} from '../../src/main/history-store';
import type { HistoryEntry } from '@shared/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeBackend extends HistoryStoreBackend {
  setCount: number;
  lastSet: { entries: HistoryEntry[] } | undefined;
  seed(value: { entries: HistoryEntry[] } | undefined): void;
}

function createFakeBackend(initial?: { entries: HistoryEntry[] }): FakeBackend {
  let data = initial ? structuredClone(initial) : undefined;
  const backend: FakeBackend = {
    setCount: 0,
    lastSet: undefined,
    get: () => (data === undefined ? undefined : structuredClone(data)),
    set: (value) => {
      data = structuredClone(value);
      backend.lastSet = structuredClone(value);
      backend.setCount += 1;
    },
    seed: (value) => { data = value === undefined ? undefined : structuredClone(value); },
  };
  return backend;
}

const entry = (
  url: string,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  url,
  title: '',
  favicon: null,
  firstVisitedAt: 1_000_000,
  lastVisitedAt: 1_000_000,
  visitCount: 1,
  ...overrides,
});

// ---------------------------------------------------------------------------
// sanitizePersistedHistory
// ---------------------------------------------------------------------------

describe('sanitizePersistedHistory', () => {
  it('returns empty array for missing / malformed input', () => {
    expect(sanitizePersistedHistory(null)).toEqual([]);
    expect(sanitizePersistedHistory(undefined)).toEqual([]);
    expect(sanitizePersistedHistory({})).toEqual([]);
    expect(sanitizePersistedHistory({ entries: 'nope' })).toEqual([]);
  });

  it('drops entries with non-string url, illegal scheme, or visitCount < 1', () => {
    const cleaned = sanitizePersistedHistory({
      entries: [
        entry('https://a.com'),
        entry('javascript:bad'),                                       // dropped (scheme)
        { ...entry('https://b.com'), url: 42 as unknown as string },   // dropped (non-string)
        { ...entry('https://c.com'), visitCount: 0 },                  // dropped (visitCount)
        entry('http://d.com'),
      ],
    });
    expect(cleaned.map((e) => e.url)).toEqual(['https://a.com', 'http://d.com']);
  });

  it('preserves all valid fields verbatim', () => {
    const e = entry('https://x.com', { title: 'X', visitCount: 5, favicon: 'f' });
    const cleaned = sanitizePersistedHistory({ entries: [e] });
    expect(cleaned[0]).toEqual(e);
  });
});

// ---------------------------------------------------------------------------
// HistoryStore — basic CRUD
// ---------------------------------------------------------------------------

describe('HistoryStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts empty when backend has no data', () => {
    const store = new HistoryStore(createFakeBackend());
    expect(store.recent(10)).toEqual([]);
    expect(store.all()).toEqual([]);
  });

  it('hydrates from backend on construction', () => {
    const seeded = createFakeBackend({ entries: [entry('https://a.com')] });
    const store = new HistoryStore(seeded);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.url).toBe('https://a.com');
  });

  it('upsert returns true on insert, false on update; counts and timestamps mutate correctly', () => {
    const store = new HistoryStore(createFakeBackend());
    expect(store.upsert('https://a.com', 1000)).toBe(true);
    expect(store.upsert('https://a.com', 5000)).toBe(false);

    const e = store.all()[0]!;
    expect(e.visitCount).toBe(2);
    expect(e.firstVisitedAt).toBe(1000);
    expect(e.lastVisitedAt).toBe(5000);
  });

  it('patchTitle skips empty / whitespace; non-empty overwrites', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.patchTitle('https://a.com', '');
    store.patchTitle('https://a.com', '   ');
    expect(store.all()[0]?.title).toBe('');
    store.patchTitle('https://a.com', 'Hello');
    expect(store.all()[0]?.title).toBe('Hello');
  });

  it('patchFavicon overwrites including with null', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.patchFavicon('https://a.com', 'http://f.ico');
    expect(store.all()[0]?.favicon).toBe('http://f.ico');
    store.patchFavicon('https://a.com', null);
    expect(store.all()[0]?.favicon).toBeNull();
  });

  it('remove deletes; missing url is silent no-op', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.remove('https://a.com');
    store.remove('https://nope.com');     // no throw
    expect(store.all()).toEqual([]);
  });

  it('recent(N) returns N most recent by lastVisitedAt desc', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 3000);
    store.upsert('https://c.com', 2000);
    expect(store.recent(2).map((e) => e.url)).toEqual(['https://b.com', 'https://c.com']);
  });

  it('evicts the oldest entry once capacity 500 is exceeded', () => {
    const store = new HistoryStore(createFakeBackend());
    for (let i = 0; i < 500; i++) store.upsert(`https://e${i}.com`, 1000 + i);
    expect(store.all()).toHaveLength(500);

    store.upsert('https://new.com', 999_999);
    expect(store.all()).toHaveLength(500);
    // The oldest by lastVisitedAt was e0 with ts 1000.
    expect(store.all().some((e) => e.url === 'https://e0.com')).toBe(false);
    expect(store.all().some((e) => e.url === 'https://new.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HistoryStore — debounce + onChanged
// ---------------------------------------------------------------------------

describe('HistoryStore persistence', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces backend.set: 3 rapid upserts → 1 write after 1000ms', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 2000);
    store.upsert('https://c.com', 3000);
    expect(backend.setCount).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(backend.setCount).toBe(1);
    expect(backend.lastSet?.entries.map((e) => e.url).sort()).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('flush() forces an immediate write and cancels the timer', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://a.com', 1000);
    store.flush();
    expect(backend.setCount).toBe(1);

    vi.advanceTimersByTime(2000);
    // No additional write fired.
    expect(backend.setCount).toBe(1);
  });

  it('seed() replaces entries wholesale, writes to backend immediately, and notifies', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://old.com', 1000);
    const cb = vi.fn();
    store.onChanged(cb);

    store.seed([entry('https://new.com', { visitCount: 5 })]);
    expect(backend.lastSet?.entries.map((e) => e.url)).toEqual(['https://new.com']);
    expect(store.all().map((e) => e.url)).toEqual(['https://new.com']);

    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onChanged fires on mutation; same-frame mutations coalesce to one notification', () => {
    const store = new HistoryStore(createFakeBackend());
    const cb = vi.fn();
    const off = store.onChanged(cb);

    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 2000);
    store.patchTitle('https://a.com', 'Hello');
    expect(cb).not.toHaveBeenCalled();    // throttled

    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    store.upsert('https://c.com', 3000);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);   // unsubscribed
  });
});
```

- [ ] **Step 2: 跑测试，确认 fail**

Run: `pnpm test tests/unit/history-store.test.ts`
Expected: FAIL — `Cannot find module '.../src/main/history-store'`

- [ ] **Step 3: 写 `src/main/history-store.ts`**

```ts
/**
 * HistoryStore — main 进程的浏览历史持久化层（M12）。
 *
 * 设计参照 settings-store.ts：
 *  - Backend 接口可注入，单测里用 fake；真实 backend 包 electron-store。
 *  - 构造时同步 load + sanitize，下游能立即读。
 *  - 写操作 1000ms debounce 后落盘；flush() 立即写（quit 前调）。
 *  - LRU 上限 500 条；超出删 lastVisitedAt 最小的一条。
 *  - onChanged 监听器 16ms 节流：连续 page-title-updated / page-favicon-updated
 *    在同一 frame 内合并为一次广播，避免 IPC 风暴。
 */

import { createRequire } from 'node:module';
import type { HistoryEntry } from '@shared/types';

const SAFE_SCHEME = /^https?:/i;
const CAPACITY = 500;
const DEBOUNCE_MS = 1000;
const NOTIFY_THROTTLE_MS = 16;

export interface HistoryStoreBackend {
  get(): { entries: HistoryEntry[] } | undefined;
  set(value: { entries: HistoryEntry[] }): void;
}

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

/**
 * Validate a raw blob from the backend. Drops entries with non-string url,
 * illegal scheme, missing fields, or visitCount < 1. Exported for unit testing.
 */
export function sanitizePersistedHistory(raw: unknown): HistoryEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { entries?: unknown };
  if (!Array.isArray(obj.entries)) return [];

  const cleaned: HistoryEntry[] = [];
  for (const e of obj.entries) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Partial<HistoryEntry>;
    if (typeof x.url !== 'string' || !SAFE_SCHEME.test(x.url)) continue;
    if (typeof x.title !== 'string') continue;
    if (x.favicon !== null && typeof x.favicon !== 'string') continue;
    if (typeof x.firstVisitedAt !== 'number' || typeof x.lastVisitedAt !== 'number') continue;
    if (typeof x.visitCount !== 'number' || x.visitCount < 1) continue;
    cleaned.push({
      url: x.url,
      title: x.title,
      favicon: x.favicon,
      firstVisitedAt: x.firstVisitedAt,
      lastVisitedAt: x.lastVisitedAt,
      visitCount: x.visitCount,
    });
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// HistoryStore
// ---------------------------------------------------------------------------

export class HistoryStore {
  private readonly entries = new Map<string, HistoryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly backend: HistoryStoreBackend;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(backend: HistoryStoreBackend) {
    this.backend = backend;
    for (const e of sanitizePersistedHistory(backend.get())) {
      this.entries.set(e.url, e);
    }
  }

  /** 插入或更新；返回 true 表示是新插入（recorder 据此决定能否 revoke）。 */
  upsert(url: string, now: number): boolean {
    const existing = this.entries.get(url);
    if (existing) {
      existing.visitCount += 1;
      existing.lastVisitedAt = now;
      this.markDirty();
      return false;
    }
    this.entries.set(url, {
      url,
      title: '',
      favicon: null,
      firstVisitedAt: now,
      lastVisitedAt: now,
      visitCount: 1,
    });
    this.evictIfOverCap();
    this.markDirty();
    return true;
  }

  patchTitle(url: string, title: string): void {
    if (title.trim() === '') return;
    const e = this.entries.get(url);
    if (!e) return;
    if (e.title === title) return;
    e.title = title;
    this.markDirty();
  }

  patchFavicon(url: string, favicon: string | null): void {
    const e = this.entries.get(url);
    if (!e) return;
    if (e.favicon === favicon) return;
    e.favicon = favicon;
    this.markDirty();
  }

  remove(url: string): void {
    if (!this.entries.delete(url)) return;
    this.markDirty();
  }

  /** 最近 N 条，按 lastVisitedAt 倒序。 */
  recent(limit: number): HistoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  /** 全量快照（autocomplete 用；规模 ≤500，每次浅复制 ok）。 */
  all(): HistoryEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** quit 前调；立即落盘并清掉 debounce 计时器。 */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.commitToBackend();
  }

  /**
   * E2E test helper. Replaces all entries wholesale + commits to backend
   * synchronously + schedules a notify so subscribers refresh. NOT for
   * production use — production paths go through upsert/patch which preserve
   * LRU + dedup invariants.
   */
  seed(entries: HistoryEntry[]): void {
    this.entries.clear();
    for (const e of entries) this.entries.set(e.url, { ...e });
    this.commitToBackend();
    this.scheduleNotify();
  }

  // ---------- private ----------

  private markDirty(): void {
    this.scheduleSave();
    this.scheduleNotify();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.commitToBackend();
    }, DEBOUNCE_MS);
  }

  private commitToBackend(): void {
    try {
      this.backend.set({ entries: [...this.entries.values()] });
    } catch (err) {
      console.error('[sidebrowser] history persist failed:', err);
    }
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const l of this.listeners) {
        try { l(); } catch (err) { console.error('[sidebrowser] history listener threw:', err); }
      }
    }, NOTIFY_THROTTLE_MS);
  }

  private evictIfOverCap(): void {
    if (this.entries.size <= CAPACITY) return;
    let oldestUrl: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [url, e] of this.entries) {
      if (e.lastVisitedAt < oldestTs) {
        oldestTs = e.lastVisitedAt;
        oldestUrl = url;
      }
    }
    if (oldestUrl !== null) this.entries.delete(oldestUrl);
  }
}

// ---------------------------------------------------------------------------
// Electron backend factory
// ---------------------------------------------------------------------------

interface ElectronStoreInstance {
  get(key: 'history'): { entries: HistoryEntry[] } | undefined;
  set(key: 'history', value: { entries: HistoryEntry[] }): void;
}

/**
 * Real backend — wraps `electron-store` under name `'sidebrowser-history'`
 * and key `'history'`. Mirrors the lazy-require pattern in
 * `settings-store.createElectronBackend` so this module stays Node-only-importable.
 *
 * Falls back to an in-memory backend if construction throws (corrupt JSON
 * before electron-store's clearInvalidConfig kicks in, FS permission errors,
 * etc.). The next successful save will overwrite a recovered file.
 */
export function createElectronHistoryBackend(): HistoryStoreBackend {
  const requireCjs = createRequire(import.meta.url);
  let store: ElectronStoreInstance | null = null;
  try {
    const StoreModule = requireCjs('electron-store') as
      | { default: new (opts?: unknown) => ElectronStoreInstance }
      | (new (opts?: unknown) => ElectronStoreInstance);
    const StoreCtor = typeof StoreModule === 'function' ? StoreModule : StoreModule.default;
    store = new StoreCtor({ name: 'sidebrowser-history' }) as ElectronStoreInstance;
  } catch (err) {
    console.error('[sidebrowser] history-store construction failed; in-memory fallback:', err);
  }
  if (store === null) {
    let memory: { entries: HistoryEntry[] } | undefined;
    return {
      get: () => memory,
      set: (v) => { memory = v; },
    };
  }
  return {
    get: () => store!.get('history'),
    set: (v) => { store!.set('history', v); },
  };
}
```

- [ ] **Step 4: 跑测试，确认全 PASS**

Run: `pnpm test tests/unit/history-store.test.ts`
Expected: PASS — 所有单测绿。

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/history-store.ts tests/unit/history-store.test.ts
git commit -m "feat(M12): add HistoryStore with persistence + LRU + debounced notify"
```

---

## Task 3: `HistoryRecorder` — 记录策略 + revoke（TDD）

**Files:**
- Create: `src/main/history-recorder.ts`
- Create: `tests/unit/history-recorder.test.ts`

### 设计

把"什么 URL 算访问 / 失败时怎么撤回"的策略从 ViewManager 抽出来。Recorder 持一个 `pending: Map<tabId, {url, wasInsert}>` 跟踪每个 tab 的当前导航——`did-fail-load` 来时查这个 Map：若 `wasInsert` 则从 store 删掉该 URL（用户输错域名不应留死链接）；否则保持原样（用户重访失败的页面，原条目还在）。

只记 `http(s)`：跳过 `about:blank` / `chrome:` / `devtools:` / `file:` / `data:` / 空字符串。

### Steps

- [ ] **Step 1: 写 `tests/unit/history-recorder.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HistoryStore } from '../../src/main/history-store';
import { HistoryRecorder } from '../../src/main/history-recorder';

const fakeBackend = () => {
  let data: Parameters<typeof JSON.stringify>[0];
  return {
    get: () => data as ReturnType<HistoryStore['all']> extends infer _ ? { entries: ReturnType<HistoryStore['all']> } | undefined : never,
    set: (v: { entries: ReturnType<HistoryStore['all']> }) => { data = v; },
  };
};

const makeRecorder = () => {
  const store = new HistoryStore({ get: () => undefined, set: () => {} });
  const recorder = new HistoryRecorder(store);
  return { store, recorder };
};

describe('HistoryRecorder.recordNavigation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('records http(s) URLs and tracks pending state per tab', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('tab1', 'https://a.com');
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.url).toBe('https://a.com');
  });

  it('skips about:blank, chrome:, devtools:, file:, data:, empty', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'about:blank');
    recorder.recordNavigation('t', 'chrome://settings');
    recorder.recordNavigation('t', 'devtools://devtools/bundled/inspector.html');
    recorder.recordNavigation('t', 'file:///C:/x.html');
    recorder.recordNavigation('t', 'data:text/html,hi');
    recorder.recordNavigation('t', '');
    expect(store.all()).toEqual([]);
  });

  it('skipped URL clears any prior pending state for that tab (revoke would be wrong)', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.recordNavigation('t', 'about:blank');       // skipped → clears pending
    recorder.revokeFailed('t');                          // no-op
    expect(store.all().some((e) => e.url === 'https://a.com')).toBe(true);
  });
});

describe('HistoryRecorder.revokeFailed', () => {
  it('removes the entry only when the last record was a fresh insert', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.revokeFailed('t');
    expect(store.all()).toEqual([]);
  });

  it('keeps the entry when the last record was a revisit', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=false (revisit)
    recorder.revokeFailed('t');                           // must NOT remove
    expect(store.all()).toHaveLength(1);
  });

  it('is idempotent — second call after revoke is a no-op', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.revokeFailed('t');
    recorder.revokeFailed('t');                           // pending cleared; no throw
    expect(store.all()).toEqual([]);
  });

  it('per-tab pending: revoking tab2 does not affect tab1', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t1', 'https://a.com');
    recorder.recordNavigation('t2', 'https://b.com');
    recorder.revokeFailed('t2');
    expect(store.all().map((e) => e.url)).toEqual(['https://a.com']);
  });
});

describe('HistoryRecorder.patchTitle / patchFavicon', () => {
  it('forwards non-empty title to store', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchTitle('https://a.com', 'Hello');
    expect(store.all()[0]?.title).toBe('Hello');
  });

  it('drops empty / whitespace title (does not overwrite existing)', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchTitle('https://a.com', 'Real');
    recorder.patchTitle('https://a.com', '');
    recorder.patchTitle('https://a.com', '   ');
    expect(store.all()[0]?.title).toBe('Real');
  });

  it('forwards favicon (including null) to store', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchFavicon('https://a.com', 'http://f.ico');
    expect(store.all()[0]?.favicon).toBe('http://f.ico');
    recorder.patchFavicon('https://a.com', null);
    expect(store.all()[0]?.favicon).toBeNull();
  });
});

describe('HistoryRecorder.forgetTab', () => {
  it('clears pending state so a later revoke is a no-op', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.forgetTab('t');
    recorder.revokeFailed('t');
    expect(store.all()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试，确认 fail**

Run: `pnpm test tests/unit/history-recorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 写 `src/main/history-recorder.ts`**

```ts
/**
 * HistoryRecorder — 把 ViewManager 的 webContents 事件翻译成 HistoryStore
 * 调用，并管理"导航是否新插入 → 加载失败时是否撤回"的决策。
 *
 * 一个独立模块的原因：
 *  - 让 ViewManager 不直接 import HistoryStore（保持事件接线层薄）；
 *  - 单测能在不构造 WebContents 的前提下覆盖记录策略；
 *  - 未来若加新的过滤规则（黑名单 / 隐私 schemes）只动这里。
 */

import type { HistoryStore } from './history-store';

const RECORDABLE_SCHEME = /^https?:/i;

interface PendingNavigation {
  url: string;
  wasInsert: boolean;
}

export class HistoryRecorder {
  private readonly store: HistoryStore;
  private readonly pending = new Map<string, PendingNavigation>();

  constructor(store: HistoryStore) { this.store = store; }

  /**
   * Called by ViewManager on webContents `did-navigate`. Filters non-http(s)
   * URLs (about:blank, chrome:, file:, data:, empty). Tracks per-tab
   * "is this a fresh insert" so revokeFailed can decide.
   */
  recordNavigation(tabId: string, url: string): void {
    if (!RECORDABLE_SCHEME.test(url)) {
      this.pending.delete(tabId);
      return;
    }
    const wasInsert = this.store.upsert(url, Date.now());
    this.pending.set(tabId, { url, wasInsert });
  }

  /** Called on `page-title-updated`. Empty / whitespace skipped at store level. */
  patchTitle(url: string, title: string): void {
    this.store.patchTitle(url, title);
  }

  /** Called on `page-favicon-updated` with the chosen favicon (or null). */
  patchFavicon(url: string, favicon: string | null): void {
    this.store.patchFavicon(url, favicon);
  }

  /**
   * Called on top-frame `did-fail-load` (errorCode != -3 ABORTED). Removes
   * the entry only if it was created by the most recent recordNavigation —
   * a previously-existing entry stays because the user has visited that page
   * successfully before.
   */
  revokeFailed(tabId: string): void {
    const pending = this.pending.get(tabId);
    if (!pending) return;
    if (pending.wasInsert) this.store.remove(pending.url);
    this.pending.delete(tabId);
  }

  /** Called on `closeTab` so a stale tabId can't leak into a future revoke. */
  forgetTab(tabId: string): void {
    this.pending.delete(tabId);
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test tests/unit/history-recorder.test.ts`
Expected: PASS — 所有断言绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/history-recorder.ts tests/unit/history-recorder.test.ts
git commit -m "feat(M12): add HistoryRecorder — recording strategy + fail-load revoke"
```

---

## Task 4: `suggestion-ranker` — 三档 tier + frecency（TDD）

**Files:**
- Create: `src/main/suggestion-ranker.ts`
- Create: `tests/unit/suggestion-ranker.test.ts`

### 设计

纯函数模块，无 I/O。`rankSuggestions(entries, query, now)` 三步：
1. 对每条 entry 算 `tier`：URL 去 scheme 前缀匹配 → tier 0；URL substring → tier 1；title substring → tier 2；都不匹配 → 跳过。
2. 同 tier 内按 `score = visitCount / (1 + ageDays / 7)` 降序。
3. 取前 8 条，输出 `Suggestion[]`。

`recentEntries(entries, limit)` 与空 query 配对：focus 但未输入时显示最近 N 条历史。

### Steps

- [ ] **Step 1: 写 `tests/unit/suggestion-ranker.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  rankSuggestions,
  recentEntries,
  stripScheme,
} from '../../src/main/suggestion-ranker';
import type { HistoryEntry } from '@shared/types';

const NOW = 1_000_000_000;
const day = 86_400_000;

const mk = (
  url: string,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  url,
  title: '',
  favicon: null,
  firstVisitedAt: NOW - day,
  lastVisitedAt: NOW - day,
  visitCount: 1,
  ...overrides,
});

describe('stripScheme', () => {
  it('strips http:// and https:// case-insensitively', () => {
    expect(stripScheme('https://github.com')).toBe('github.com');
    expect(stripScheme('HTTP://example.org/foo')).toBe('example.org/foo');
  });
  it('passes through non-http schemes unchanged', () => {
    expect(stripScheme('about:blank')).toBe('about:blank');
  });
});

describe('rankSuggestions — empty / trivial', () => {
  it('returns [] for empty query', () => {
    expect(rankSuggestions([mk('https://a.com')], '', NOW)).toEqual([]);
    expect(rankSuggestions([mk('https://a.com')], '   ', NOW)).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    expect(rankSuggestions([mk('https://a.com')], 'zzz', NOW)).toEqual([]);
  });
});

describe('rankSuggestions — tier ordering', () => {
  it('URL prefix (tier 0) ranks above URL substring (tier 1) above title substring (tier 2)', () => {
    const entries = [
      mk('https://other.com/githubpath', { title: 'noise' }),                 // tier 1: 'github' is in URL but not prefix
      mk('https://noise.org', { title: 'github official' }),                  // tier 2: 'github' is in title
      mk('https://github.com', { title: 'GitHub' }),                          // tier 0: prefix
    ];
    const out = rankSuggestions(entries, 'github', NOW);
    expect(out.map((s) => s.tier)).toEqual([0, 1, 2]);
    expect(out[0]?.url).toBe('https://github.com');
  });

  it('case-insensitive matching', () => {
    const entries = [mk('https://example.com', { title: 'Hello World' })];
    const out = rankSuggestions(entries, 'HELLO', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.tier).toBe(2);
  });
});

describe('rankSuggestions — within-tier score', () => {
  it('within tier 0, higher visitCount + more recent ranks first', () => {
    const entries = [
      mk('https://github.com/a', { visitCount: 1, lastVisitedAt: NOW - 1 * day }),
      mk('https://github.com/b', { visitCount: 10, lastVisitedAt: NOW - 1 * day }),
      mk('https://github.com/c', { visitCount: 1, lastVisitedAt: NOW - 30 * day }),
    ];
    const out = rankSuggestions(entries, 'github', NOW);
    expect(out.map((s) => s.url)).toEqual([
      'https://github.com/b', // visitCount 10, recent → highest score
      'https://github.com/a', // visitCount 1, recent
      'https://github.com/c', // visitCount 1, old
    ]);
  });
});

describe('rankSuggestions — limit', () => {
  it('caps output at 8 even when more match', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      mk(`https://e${i}.com`, { visitCount: 20 - i }),
    );
    const out = rankSuggestions(entries, 'e', NOW);
    expect(out).toHaveLength(8);
  });
});

describe('recentEntries', () => {
  it('returns N most recent by lastVisitedAt desc', () => {
    const entries = [
      mk('https://a.com', { lastVisitedAt: NOW - 1 }),
      mk('https://b.com', { lastVisitedAt: NOW - 100 }),
      mk('https://c.com', { lastVisitedAt: NOW - 50 }),
    ];
    expect(recentEntries(entries, 2).map((e) => e.url)).toEqual(['https://a.com', 'https://c.com']);
  });

  it('caps at provided limit', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      mk(`https://e${i}.com`, { lastVisitedAt: i }),
    );
    expect(recentEntries(entries, 5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: 跑测试，确认 fail**

Run: `pnpm test tests/unit/suggestion-ranker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 写 `src/main/suggestion-ranker.ts`**

```ts
/**
 * Suggestion ranker — 纯函数。
 *
 * `rankSuggestions(entries, query, now)`：地址栏自动补全用，三档 tier
 * (URL 前缀 → URL substring → title substring) + 同档内 frecency 降序。
 * `recentEntries(entries, limit)`：地址栏 focus 但 query 为空时使用，
 * 单纯按 lastVisitedAt 倒序取 N 条。
 *
 * 隔离成模块的原因：算法可独立单测，与 IO / 事件流解耦。
 */

import type { HistoryEntry, Suggestion } from '@shared/types';

const SUGGEST_LIMIT = 8;
const DAY_MS = 86_400_000;

/** Lowercase the URL after stripping `http://` or `https://`, for prefix matching. */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

interface Scored {
  entry: HistoryEntry;
  tier: 0 | 1 | 2;
  score: number;
}

function frecency(entry: HistoryEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastVisitedAt) / DAY_MS);
  return entry.visitCount / (1 + ageDays / 7);
}

export function rankSuggestions(
  entries: HistoryEntry[],
  query: string,
  now: number,
): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const scored: Scored[] = [];
  for (const e of entries) {
    const urlLc = e.url.toLowerCase();
    const urlNoScheme = stripScheme(urlLc);
    const titleLc = e.title.toLowerCase();
    let tier: 0 | 1 | 2;
    if (urlNoScheme.startsWith(q) || urlLc.startsWith(q)) {
      tier = 0;
    } else if (urlLc.includes(q)) {
      tier = 1;
    } else if (titleLc !== '' && titleLc.includes(q)) {
      tier = 2;
    } else {
      continue;
    }
    scored.push({ entry: e, tier, score: frecency(e, now) });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.score - a.score;
  });

  return scored.slice(0, SUGGEST_LIMIT).map(({ entry, tier }) => ({
    url: entry.url,
    title: entry.title,
    favicon: entry.favicon,
    tier,
  }));
}

export function recentEntries(entries: HistoryEntry[], limit: number): HistoryEntry[] {
  return [...entries]
    .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
    .slice(0, limit);
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test tests/unit/suggestion-ranker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/suggestion-ranker.ts tests/unit/suggestion-ranker.test.ts
git commit -m "feat(M12): add suggestion-ranker — tier + frecency for autocomplete"
```

---

## Task 5: ViewManager 集成 history-recorder（TDD）

**Files:**
- Modify: `src/main/view-manager.ts`
- Create: `tests/unit/view-manager-history.test.ts`

### 设计

`ViewManager` 构造函数加第三个参数 `recorder: HistoryRecorder | null`（null 表示禁用记录，单测和未来可选场景用）。`attachWebContentsEvents` 内：
- `onNavigate`：在更新 tab 状态后调 `recorder?.recordNavigation(id, url)`。
- `onTitle`：调 `recorder?.patchTitle(currentUrl, title)`。
- `onFavicon`：调 `recorder?.patchFavicon(currentUrl, fav)`。
- 新增 `onFailLoad`：top-frame 且 errorCode != -3 时调 `recorder?.revokeFailed(id)`。
- 在 cleanup 闭包里 `wc.off('did-fail-load', onFailLoad)`。
- `closeTab` 末尾调 `recorder?.forgetTab(id)`。

测试用一个 fake recorder（实现 4 个方法的 spy），构造一个最小的 fake `BrowserWindow`（沿用现有 `view-manager-zoom.test.ts` 不存在 BrowserWindow mock 的模式——但本测试需要构造完整 ViewManager 才能测事件回调串联，所以会比 zoom 测试稍微重）。**简化策略：把 `attachWebContentsEvents` 拆出一个纯函数 `bindHistoryToWebContents(id, wc, recorder)` 单独测**。这样我们不需要构造完整的 ViewManager + BrowserWindow，只 mock `EventEmitter`-style `wc`。

实际上现有 ViewManager 内部 `attachWebContentsEvents` 已经把事件回调闭包化得很整齐，我们直接把 history 相关的 4 个回调抽到一个新导出函数 `bindHistoryRecorderEvents(tabId, wc, recorder, getCurrentUrl)`，由 `attachWebContentsEvents` 调一次拿 `detach` 闭包合并。这样：
- 单测对 `bindHistoryRecorderEvents` 用 mock wc（一个简化的 EventEmitter）即可。
- ViewManager 改动局限在 `attachWebContentsEvents` 内 3 行 + closeTab 末尾 1 行。

### Steps

- [ ] **Step 1: 写 `tests/unit/view-manager-history.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { bindHistoryRecorderEvents } from '../../src/main/view-manager';

class FakeRecorder {
  recordNavigation = vi.fn();
  patchTitle = vi.fn();
  patchFavicon = vi.fn();
  revokeFailed = vi.fn();
  forgetTab = vi.fn();
}

const makeWc = () => {
  const wc = new EventEmitter() as EventEmitter & {
    off: EventEmitter['removeListener'];
  };
  wc.off = wc.removeListener.bind(wc);
  return wc;
};

describe('bindHistoryRecorderEvents', () => {
  let wc: ReturnType<typeof makeWc>;
  let recorder: FakeRecorder;
  let detach: () => void;
  let currentUrl: string;

  beforeEach(() => {
    wc = makeWc();
    recorder = new FakeRecorder();
    currentUrl = 'about:blank';
    detach = bindHistoryRecorderEvents('tab1', wc as never, recorder as never, () => currentUrl);
  });

  it('did-navigate calls recordNavigation with tabId + url', () => {
    wc.emit('did-navigate', null, 'https://a.com');
    expect(recorder.recordNavigation).toHaveBeenCalledWith('tab1', 'https://a.com');
  });

  it('did-navigate-in-page is NOT recorded (SPA hash navigations skipped)', () => {
    wc.emit('did-navigate-in-page', null, 'https://a.com#section');
    expect(recorder.recordNavigation).not.toHaveBeenCalled();
  });

  it('page-title-updated patches via current URL from getter', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-title-updated', null, 'Hello');
    expect(recorder.patchTitle).toHaveBeenCalledWith('https://a.com', 'Hello');
  });

  it('page-favicon-updated patches the first favicon', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-favicon-updated', null, ['http://f.ico', 'http://f2.ico']);
    expect(recorder.patchFavicon).toHaveBeenCalledWith('https://a.com', 'http://f.ico');
  });

  it('page-favicon-updated patches null when array is empty', () => {
    currentUrl = 'https://a.com';
    wc.emit('page-favicon-updated', null, []);
    expect(recorder.patchFavicon).toHaveBeenCalledWith('https://a.com', null);
  });

  it('did-fail-load top-frame non-aborted → revokeFailed', () => {
    // signature: (event, errorCode, errorDescription, validatedURL, isMainFrame, ...)
    wc.emit('did-fail-load', null, -105, 'NAME_NOT_RESOLVED', 'https://a.com', true);
    expect(recorder.revokeFailed).toHaveBeenCalledWith('tab1');
  });

  it('did-fail-load with isMainFrame=false is ignored (subframe)', () => {
    wc.emit('did-fail-load', null, -105, 'NAME_NOT_RESOLVED', 'https://a.com', false);
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('did-fail-load with errorCode -3 (ABORTED) is ignored', () => {
    wc.emit('did-fail-load', null, -3, 'ABORTED', 'https://a.com', true);
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('detach() removes all four listeners', () => {
    detach();
    wc.emit('did-navigate', null, 'https://a.com');
    wc.emit('page-title-updated', null, 'Hi');
    wc.emit('page-favicon-updated', null, ['x']);
    wc.emit('did-fail-load', null, -105, 'X', 'https://a.com', true);
    expect(recorder.recordNavigation).not.toHaveBeenCalled();
    expect(recorder.patchTitle).not.toHaveBeenCalled();
    expect(recorder.patchFavicon).not.toHaveBeenCalled();
    expect(recorder.revokeFailed).not.toHaveBeenCalled();
  });

  it('null recorder is a no-op (no throws when bound with null)', () => {
    detach();    // detach the previously-bound recorder
    const noopDetach = bindHistoryRecorderEvents('tab2', wc as never, null, () => 'https://a.com');
    expect(() => {
      wc.emit('did-navigate', null, 'https://a.com');
      wc.emit('did-fail-load', null, -105, 'X', 'https://a.com', true);
    }).not.toThrow();
    noopDetach();
  });
});
```

- [ ] **Step 2: 跑测试，确认 fail**

Run: `pnpm test tests/unit/view-manager-history.test.ts`
Expected: FAIL — `bindHistoryRecorderEvents` not exported.

- [ ] **Step 3: 修改 `src/main/view-manager.ts` — 新增 import 和 bind 函数**

文件顶部 import 块加：

```ts
import type { HistoryRecorder } from './history-recorder';
```

在文件 `// ---------------------------------------------------------------------------` zoom helpers 块**之前**（即 import 之后第一个分隔符前）插入新的导出函数：

```ts
// ---------------------------------------------------------------------------
// History recorder wiring — M12 Task 5
// ---------------------------------------------------------------------------

/**
 * Bind history-recording listeners onto a webContents. Returns a detach
 * closure that removes all four listeners. Kept as a free function so it is
 * unit-testable with a fake EventEmitter — no BrowserWindow / WebContentsView
 * required.
 *
 * `getCurrentUrl` is a closure (not a snapshot) because page-title-updated
 * fires AFTER did-navigate has already updated the tab state — by the time
 * the title arrives, the URL we want is the freshly-set one. Threading a
 * snapshot at bind time would be wrong.
 *
 * `recorder = null` is a valid no-op binding (used in tests + future
 * "history disabled" config paths).
 */
export function bindHistoryRecorderEvents(
  tabId: string,
  wc: Electron.WebContents,
  recorder: HistoryRecorder | null,
  getCurrentUrl: () => string,
): () => void {
  if (recorder === null) return () => {};

  const onNavigate = (_e: Electron.Event, url: string): void => {
    recorder.recordNavigation(tabId, url);
  };
  const onTitle = (_e: Electron.Event, title: string): void => {
    recorder.patchTitle(getCurrentUrl(), title);
  };
  const onFavicon = (_e: Electron.Event, favicons: string[]): void => {
    recorder.patchFavicon(getCurrentUrl(), favicons[0] ?? null);
  };
  const onFailLoad = (
    _e: Electron.Event,
    errorCode: number,
    _desc: string,
    _validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame) return;
    if (errorCode === -3) return;     // ABORTED — not a real failure
    recorder.revokeFailed(tabId);
  };

  wc.on('did-navigate', onNavigate);
  wc.on('page-title-updated', onTitle);
  wc.on('page-favicon-updated', onFavicon);
  wc.on('did-fail-load', onFailLoad);

  return () => {
    wc.off('did-navigate', onNavigate);
    wc.off('page-title-updated', onTitle);
    wc.off('page-favicon-updated', onFavicon);
    wc.off('did-fail-load', onFailLoad);
  };
}
```

- [ ] **Step 4: 修改 `ViewManager` 构造函数与 `attachWebContentsEvents` 接入 recorder**

构造函数签名（class body 内的 `constructor`）改为：

```ts
constructor(
  window: BrowserWindow,
  getBrowsingDefaults: BrowsingDefaultsGetter,
  recorder: HistoryRecorder | null = null,
) {
  this.window = window;
  this.getBrowsingDefaults = getBrowsingDefaults;
  this.recorder = recorder;
  window.on('resize', this.onWindowResize);
  window.once('ready-to-show', () => this.applyBounds());
}
```

类的私有字段区域（`getBrowsingDefaults` 旁边）加一行：

```ts
private readonly recorder: HistoryRecorder | null;
```

`attachWebContentsEvents` 函数 `return` 的 cleanup 闭包**之前**插入一行调用：

```ts
const detachHistory = bindHistoryRecorderEvents(
  id,
  wc,
  this.recorder,
  () => this.tabs.get(id)?.tab.url ?? '',
);
```

把已有的 cleanup `return` 改成包含 `detachHistory()`：

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
  detachHistory();    // ← 新增
};
```

`closeTab` 函数末尾（zoom 清理之后、`removeChildView` 之前都行；放在最前面与 zoom 清理对齐）：

```ts
closeTab(id: string): void {
  const managed = this.tabs.get(id);
  if (!managed) return;
  this.zoomFactors.delete(id);
  this.recorder?.forgetTab(id);     // ← 新增

  managed.detach();
  // ... 余下不动
}
```

- [ ] **Step 5: 跑单测**

Run: `pnpm test tests/unit/view-manager-history.test.ts tests/unit/view-manager-zoom.test.ts`
Expected: PASS（zoom 测试不受影响）

- [ ] **Step 6: 跑全部单测**

Run: `pnpm test`
Expected: PASS（所有现有测试仍绿；新测试新加了断言）

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/view-manager.ts tests/unit/view-manager-history.test.ts
git commit -m "feat(M12): wire HistoryRecorder into ViewManager via bindHistoryRecorderEvents"
```

---

## Task 6: Main bootstrap + IPC router + preload API

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc-router.ts`
- Modify: `src/preload/index.ts`

### 设计

把后端打通到 renderer 边界。三件事并发改一个 commit 因为任何单独一项落地都不能独立运行：
1. `index.ts`：构造 `HistoryStore` + `HistoryRecorder`，传入 ViewManager；`before-quit` 加 `historyStore.flush()`；`activate` 路径同步加 recorder（macOS 兜底，沿用 existing `TODO(post-v1-Windows)` 注释，不增加新 TODO）。
2. `ipc-router.ts`：注册 3 个 handler；订阅 `historyStore.onChanged` 广播 `history:changed` 信号（payload 空对象）。
3. `preload/index.ts`：暴露 4 个 API。

### Steps

- [ ] **Step 1: 修改 `src/main/ipc-router.ts`**

文件顶部 import 改为同时拿 `HistoryStore` 和 `HistoryRecorder`：

```ts
import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';
import type { SettingsStore } from './settings-store';
import type { HistoryStore } from './history-store';
import { rankSuggestions, recentEntries } from './suggestion-ranker';
```

`registerIpcRouter` 签名加一个参数：

```ts
export function registerIpcRouter(
  window: BrowserWindow,
  viewManager: ViewManager,
  settingsStore: SettingsStore,
  historyStore: HistoryStore,
): void {
```

在文件末尾的 `viewManager.onSnapshot(...)` 块**之前**追加（紧挨现有 `viewManager.onTabUpdated` 之后即可）：

```ts
  // History RPCs (M12).
  ipcMain.removeHandler(IpcChannels.historyRecent);
  ipcMain.handle(
    IpcChannels.historyRecent,
    (_event, payload: IpcContract[typeof IpcChannels.historyRecent]['request']) =>
      historyStore.recent(payload.limit),
  );

  ipcMain.removeHandler(IpcChannels.historySuggest);
  ipcMain.handle(
    IpcChannels.historySuggest,
    (_event, payload: IpcContract[typeof IpcChannels.historySuggest]['request']) => {
      const q = payload.query.trim();
      if (q === '') {
        // Empty query (focus but no input): return recent 8 as Suggestions
        // with tier=0 just so the wire shape is uniform — UI doesn't render
        // the tier marker.
        return recentEntries(historyStore.all(), 8).map((e) => ({
          url: e.url,
          title: e.title,
          favicon: e.favicon,
          tier: 0 as const,
        }));
      }
      return rankSuggestions(historyStore.all(), q, Date.now());
    },
  );

  // history:remove — fire-and-forget.
  const onHistoryRemove = (
    _event: IpcMainEvent,
    payload: IpcContract[typeof IpcChannels.historyRemove]['request'],
  ): void => {
    historyStore.remove(payload.url);
  };
  ipcMain.on(IpcChannels.historyRemove, onHistoryRemove);
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.historyRemove, onHistoryRemove);
  });

  // history:changed — broadcast on store mutation. Throttling lives in
  // HistoryStore (16 ms); this fan-out is naturally rate-limited.
  const offHistoryChanged = historyStore.onChanged(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.historyChanged, {});
    }
  });
  window.once('closed', () => { offHistoryChanged(); });
```

注：`historyStore` 的引用还需要 E2E test hook 用，所以一会儿在 `index.ts` 里也要在 `__sidebrowserTestHooks` 上挂一个 `seedHistory` / `getHistoryAll` 入口。

- [ ] **Step 2: 修改 `src/main/index.ts` — 构造 + 注入 + flush**

文件顶部 import 加：

```ts
import { HistoryStore, createElectronHistoryBackend } from './history-store';
import { HistoryRecorder } from './history-recorder';
```

`app.whenReady().then(...)` 内 `// 1. Settings store + window-bounds persister.` 块的最后追加：

```ts
  // 1b. History store + recorder (M12).
  const historyStore = new HistoryStore(createElectronHistoryBackend());
  const historyRecorder = new HistoryRecorder(historyStore);
```

`new ViewManager(win, () => {...})` 调用改为 3 参：

```ts
  const viewManager = new ViewManager(win, () => {
    const s = settingsStore.get();
    return {
      defaultIsMobile: s.browsing.defaultIsMobile,
      mobileUserAgent: s.browsing.mobileUserAgent,
    };
  }, historyRecorder);
```

`registerIpcRouter(win, viewManager, settingsStore)` 改为 4 参：

```ts
  registerIpcRouter(win, viewManager, settingsStore, historyStore);
```

`app.on('before-quit', () => { ... })` 块内追加 flush：

```ts
  app.on('before-quit', () => {
    boundsPersister.flush();
    saver.flush();
    historyStore.flush();    // ← 新增
  });
```

`__sidebrowserTestHooks` 块（只在 `SIDEBROWSER_E2E === '1'` 下挂）末尾追加 M12 hooks：

```ts
      // M12 history hooks.
      seedHistory: (entries: HistoryEntry[]): void => historyStore.seed(entries),
      getHistoryAll: (): HistoryEntry[] => historyStore.all(),
```

`HistoryEntry` 顶部 import 加（如果还没）：

```ts
import type { HistoryEntry, Settings, SettingsPatch } from '@shared/types';
```

`activate` 分支内也用上 recorder（macOS 兜底）：

```ts
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // ... existing TODO comment unchanged ...
      const newWin = createWindow(initialBounds);
      const newViewManager = new ViewManager(newWin, () => {
        const s = settingsStore.get();
        return {
          defaultIsMobile: s.browsing.defaultIsMobile,
          mobileUserAgent: s.browsing.mobileUserAgent,
        };
      }, historyRecorder);                                        // ← 新增 recorder
      registerIpcRouter(newWin, newViewManager, settingsStore, historyStore);  // ← 4 参
      newWin.webContents.once('did-finish-load', () => {
        newViewManager.createTab('about:blank');
      });
    }
  });
```

- [ ] **Step 3: 修改 `src/preload/index.ts` — 暴露 4 个新 API**

文件顶部 import 调整：

```ts
import type {
  HistoryEntry, Settings, SettingsPatch, Suggestion, Tab, TabsSnapshot, WindowState,
} from '@shared/types';
```

`api` 对象内、`onNativeThemeUpdated` 之后（也就是文件末尾、`const api = {...}` 闭合花括号之前）追加：

```ts
  // History (M12)
  historyRecent: (limit: number): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IpcChannels.historyRecent, { limit }),

  historySuggest: (query: string): Promise<Suggestion[]> =>
    ipcRenderer.invoke(IpcChannels.historySuggest, { query }),

  historyRemove: (url: string): void => {
    ipcRenderer.send(IpcChannels.historyRemove, { url });
  },

  /** Subscribe to history mutation pings. Returns unsubscribe. */
  onHistoryChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb();
    ipcRenderer.on(IpcChannels.historyChanged, handler);
    return () => ipcRenderer.off(IpcChannels.historyChanged, handler);
  },
```

`api.d.ts` 不需要改（它从 preload 拿 `SidebrowserApi = typeof api`，自动同步）。

- [ ] **Step 4: 跑 typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: 跑全部单测**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: 手动冒烟（用户驱动；plan execution convention）**

报告"Task 6 完成，等待用户冒烟"。用户跑 `pnpm dev` 浏览几个 https 站、关 app、重启，确认：
- `app.getPath('userData')/sidebrowser-history.json` 出现且包含访问过的条目；
- 主进程日志无异常。

用户确认后再进入 Task 7。

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/main/ipc-router.ts src/preload/index.ts
git commit -m "feat(M12): wire HistoryStore through main bootstrap + IPC + preload"
```

---

## Task 7: `Favicon` 组件

**Files:**
- Create: `src/renderer/src/components/Favicon.tsx`

### 设计

最小组件：一个 16px favicon `<img>`，加载失败 / 无 src 时回退到 `<Globe>` lucide icon。NewTab 用 `size={16}`（即默认）；将来可以加 `size` prop 覆盖。

无单测——纯渲染逻辑、E2E 覆盖到。

### Steps

- [ ] **Step 1: 写 `src/renderer/src/components/Favicon.tsx`**

```tsx
import { useState, type ReactElement } from 'react';
import { Globe } from 'lucide-react';

interface Props {
  src: string | null;
  size?: number;
}

/**
 * Small favicon image with a Globe icon fallback.
 *
 * Rendering an `<img>` for an external favicon URL can fail — the host may be
 * down, the URL may have rotated, or the response may not be an image. We
 * track an `errored` flag and switch to the Globe icon on any of those
 * conditions, plus the trivial null-src case.
 */
export function Favicon({ src, size = 16 }: Props): ReactElement {
  const [errored, setErrored] = useState(false);
  if (src === null || errored) {
    return <Globe size={size} className="shrink-0 text-[var(--chrome-muted)]" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      onError={() => setErrored(true)}
    />
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS — 文件单独 typecheck 通过；尚未被引用，但合法。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Favicon.tsx
git commit -m "feat(M12): add Favicon component with Globe fallback"
```

---

## Task 8: `NewTab` 组件

**Files:**
- Create: `src/renderer/src/components/NewTab.tsx`

### 设计

`about:blank` 时由 `App.tsx` 条件渲染。挂载时 IPC 拉最近 12 条；订阅 `onHistoryChanged` 重拉。点击行用 `onMouseDown + preventDefault`（spec §7.4：避免地址栏 blur 竞争——但 NewTab 时地址栏未必 focused，仍统一 mousedown 比较稳）。删除按钮 `onMouseDown` 同理，且 `e.stopPropagation()` 阻止冒泡到行点击。

需要 active tab id 才能调 `navigate`。`useActiveTab()` 返回 `Tab | undefined`，取 `.id`。

### Steps

- [ ] **Step 1: 写 `src/renderer/src/components/NewTab.tsx`**

```tsx
import { useEffect, useState, type ReactElement, type MouseEvent } from 'react';
import { Globe, X } from 'lucide-react';
import type { HistoryEntry } from '@shared/types';
import { useActiveTab } from '../store/tab-store';
import { Favicon } from './Favicon';

const NEWTAB_RECENT_LIMIT = 12;

export function NewTab(): ReactElement {
  const tab = useActiveTab();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.sidebrowser
        .historyRecent(NEWTAB_RECENT_LIMIT)
        .then((es) => { if (!cancelled) setEntries(es); });
    };
    load();
    const off = window.sidebrowser.onHistoryChanged(load);
    return () => { cancelled = true; off(); };
  }, []);

  const navigate = (url: string): void => {
    if (!tab) return;
    void window.sidebrowser.navigate(tab.id, url);
  };

  const remove = (e: MouseEvent, url: string): void => {
    e.stopPropagation();
    e.preventDefault();
    window.sidebrowser.historyRemove(url);
    // Optimistic local update — onHistoryChanged broadcast will reconcile shortly.
    setEntries((prev) => prev.filter((entry) => entry.url !== url));
  };

  return (
    <div
      className="absolute inset-0 flex flex-col items-center bg-[var(--chrome-bg)] text-[var(--chrome-fg)] overflow-y-auto"
      data-testid="newtab"
    >
      <Globe size={64} className="mt-12 mb-8 text-[var(--chrome-muted)]" />
      {entries.length === 0 ? (
        <div className="text-sm text-[var(--chrome-muted)]" data-testid="newtab-empty">
          No recent pages yet
        </div>
      ) : (
        <ul className="w-full max-w-md px-4 space-y-1" data-testid="newtab-list">
          {entries.map((e) => (
            <li
              key={e.url}
              className="group flex items-center gap-2 rounded p-2 hover:bg-[var(--chrome-hover)] cursor-pointer"
              onMouseDown={(ev) => { ev.preventDefault(); navigate(e.url); }}
              data-testid="newtab-item"
            >
              <Favicon src={e.favicon} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{e.title || e.url}</div>
                <div className="text-xs text-[var(--chrome-muted)] truncate">{e.url}</div>
              </div>
              <button
                type="button"
                aria-label="Remove from history"
                onMouseDown={(ev) => remove(ev, e.url)}
                className="opacity-0 group-hover:opacity-100 text-[var(--chrome-muted)] hover:text-[var(--chrome-fg)] p-1"
                data-testid="newtab-remove"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/NewTab.tsx
git commit -m "feat(M12): add NewTab component listing recent visits on about:blank"
```

---

## Task 9: `AddressSuggestions` 组件

**Files:**
- Create: `src/renderer/src/components/AddressSuggestions.tsx`

### 设计

Forward-ref 子组件，TopBar 通过 ref 调 `moveUp() / moveDown() / currentUrl()`。键盘事件由 TopBar 的 input `onKeyDown` 处理（spec §4.6 解释了为何不在子组件里：input focus 时 dropdown 自身没焦点，事件得拦在 input）。

下拉项点击用 `onMouseDown + preventDefault`（spec §7.4），保留 input focus 直到 onPick 触发的 navigate 完成。

数据流：每次 `query` 或 `open` 变化，调 `historySuggest(query)` 拉条目。挂载期同时订阅 `onHistoryChanged` 触发刷新（删除单条历史的即时反馈）。

### Steps

- [ ] **Step 1: 写 `src/renderer/src/components/AddressSuggestions.tsx`**

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { Suggestion } from '@shared/types';
import { Favicon } from './Favicon';

const SUGGEST_DROPDOWN_MAX = 8;

export interface AddressSuggestionsHandle {
  /** Move highlight down by 1; wraps at the bottom. No-op if list empty. */
  moveDown(): void;
  /** Move highlight up by 1; wraps at the top. No-op if list empty. */
  moveUp(): void;
  /** URL of the currently highlighted item, or null if none. */
  currentUrl(): string | null;
}

interface Props {
  query: string;
  open: boolean;
  onPick: (url: string) => void;
}

/**
 * Address-bar dropdown. Shows up to 8 history suggestions. Highlight state
 * is internal; parent (TopBar) drives navigation via ref methods because the
 * input owns the keyboard event channel.
 */
export const AddressSuggestions = forwardRef<AddressSuggestionsHandle, Props>(
  function AddressSuggestions({ query, open, onPick }, ref): ReactElement | null {
    const [items, setItems] = useState<Suggestion[]>([]);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    // Latest items kept in a ref so the imperative handle's currentUrl()
    // returns a fresh value without re-creating the handle on every list update.
    const itemsRef = useRef<Suggestion[]>(items);
    itemsRef.current = items;
    const highlightRef = useRef<number>(-1);
    highlightRef.current = highlightIdx;

    // Fetch suggestions whenever query changes (or dropdown re-opens).
    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      void window.sidebrowser.historySuggest(query).then((next) => {
        if (cancelled) return;
        setItems(next.slice(0, SUGGEST_DROPDOWN_MAX));
        setHighlightIdx(-1);
      });
      return () => { cancelled = true; };
    }, [open, query]);

    // Refresh on history mutation (e.g. a deleted-from-NewTab entry vanishes
    // here too if the dropdown happens to be open at the time).
    useEffect(() => {
      if (!open) return;
      const off = window.sidebrowser.onHistoryChanged(() => {
        void window.sidebrowser.historySuggest(query).then((next) => {
          setItems(next.slice(0, SUGGEST_DROPDOWN_MAX));
        });
      });
      return off;
    }, [open, query]);

    useImperativeHandle(
      ref,
      () => ({
        moveDown(): void {
          const len = itemsRef.current.length;
          if (len === 0) return;
          setHighlightIdx((cur) => (cur + 1 + len) % len);
        },
        moveUp(): void {
          const len = itemsRef.current.length;
          if (len === 0) return;
          setHighlightIdx((cur) => (cur === -1 ? len - 1 : (cur - 1 + len) % len));
        },
        currentUrl(): string | null {
          const i = highlightRef.current;
          if (i < 0 || i >= itemsRef.current.length) return null;
          return itemsRef.current[i]!.url;
        },
      }),
      [],
    );

    if (!open || items.length === 0) return null;

    return (
      <ul
        className="absolute left-0 right-0 top-full mt-1 z-10 max-h-96 overflow-y-auto rounded border border-[var(--chrome-border)] bg-[var(--chrome-bg)] shadow-lg"
        data-testid="address-suggestions"
      >
        {items.map((s, i) => (
          <li
            key={s.url}
            className={
              'flex items-center gap-2 px-2 py-1 cursor-pointer ' +
              (i === highlightIdx ? 'bg-[var(--chrome-hover)]' : 'hover:bg-[var(--chrome-hover)]')
            }
            onMouseDown={(ev) => { ev.preventDefault(); onPick(s.url); }}
            onMouseEnter={() => setHighlightIdx(i)}
            data-testid="address-suggestions-item"
          >
            <Favicon src={s.favicon} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{s.title || s.url}</div>
              <div className="text-xs text-[var(--chrome-muted)] truncate">{s.url}</div>
            </div>
          </li>
        ))}
      </ul>
    );
  },
);
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AddressSuggestions.tsx
git commit -m "feat(M12): add AddressSuggestions dropdown with forwardRef keyboard API"
```

---

## Task 10: `App.tsx` + `TopBar.tsx` 集成

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`

### 设计

`App.tsx`：把 `setViewSuppressed(settingsOpen)` 扩为三源 OR：`settingsOpen || suggestionsOpen || isNewTab`。把 `setSuggestionsOpen` 作为 prop 下传给 TopBar；条件渲染 `<NewTab />`。

`TopBar.tsx`：增加 `focused` state（控制下拉 open）+ `pickedUrl` state（用户从下拉选了一个 URL，`Enter` 用它而不是 normalize draft）+ ref 到 AddressSuggestions。`onKeyDown` 处理 ↑/↓/Esc；`Enter` 走 form submit，submit 时若 `pickedUrl` 或 ref 当前高亮有值则用之，否则 normalize。

`onBlur` 不直接关下拉（因为点击下拉项时 blur 会先触发，下拉 unmount 后 mousedown 拿不到目标）—— spec §7.4 已说明用 `onMouseDown` + `preventDefault` 阻止 blur。但如果用户 Tab 离开 input，blur 也得关——所以 `onBlur` 还是要处理，只是相对于 mousedown 是兜底。`onMouseDown preventDefault` 阻断了点击行的 blur，所以 `onBlur` 不会被点击触发；只有真离开（Tab / 点击其它 chrome / Esc）时关。这是 design 的核心机制。

### Steps

- [ ] **Step 1: 修改 `src/renderer/src/App.tsx`**

完整替换：

```tsx
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NewTab } from './components/NewTab';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';
import { useSettingsStore } from './store/settings-store';
import { useActiveTab } from './store/tab-store';
import { useTheme } from './theme/useTheme';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

  const settings = useSettingsStore((s) => s.settings);
  useTheme(settings?.appearance.theme ?? 'system');

  const activeTab = useActiveTab();
  const isNewTab = activeTab?.url === 'about:blank';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;

    const report = (): void => {
      window.sidebrowser.setChromeHeight(el.getBoundingClientRect().height);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // M6 + M12: ViewManager suppression with three sources OR'd together.
  // SettingsDrawer / AddressSuggestions / NewTab all need the WebContentsView
  // hidden so the renderer-layer overlay can paint above. A single useEffect
  // computes the union and pushes it; the individual sources don't fight.
  const suppressed = settingsOpen || suggestionsOpen || isNewTab;
  useEffect(() => {
    window.sidebrowser.setViewSuppressed(suppressed);
  }, [suppressed]);

  // Spec §15: dispatch renderer-bound shortcut actions from the hidden
  // Application Menu. Same pattern as before — the address-bar focus action
  // calls `.focus()` which will trigger TopBar's onFocus and open the dropdown
  // automatically (Q2 option B).
  useEffect(() => {
    return window.sidebrowser.onShortcut((action) => {
      switch (action) {
        case 'focus-address-bar': {
          const input = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
          input?.focus();
          input?.select();
          return;
        }
        case 'toggle-tab-drawer':
          toggleDrawer();
          return;
        case 'toggle-settings-drawer':
          toggleSettings();
          return;
      }
    });
  }, [toggleDrawer, toggleSettings]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar
          drawerOpen={drawerOpen}
          onToggleDrawer={toggleDrawer}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
          onSuggestionsOpenChange={setSuggestionsOpen}
        />
        <TabDrawer open={drawerOpen} onSelect={closeDrawer} />
      </div>
      <div className="relative flex-1">
        {isNewTab && <NewTab />}
        <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 `src/renderer/src/components/TopBar.tsx`**

完整替换：

```tsx
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Layers, Smartphone, Monitor, Settings } from 'lucide-react';
import { useActiveTab } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import { useSettingsStore } from '../store/settings-store';
import { normalizeUrlInput } from '@shared/url';
import { AddressSuggestions, type AddressSuggestionsHandle } from './AddressSuggestions';

interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Called whenever the dropdown's open state changes; App lifts this for view-suppression. */
  onSuggestionsOpenChange: (open: boolean) => void;
}

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
  onSuggestionsOpenChange,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const hidden = useWindowStateStore((s) => s.hidden);
  const settings = useSettingsStore((s) => s.settings);
  const [draft, setDraft] = useState<string>('');
  const [syncedUrl, setSyncedUrl] = useState<string>(tab?.url ?? '');
  const [focused, setFocused] = useState<boolean>(false);
  const suggestionsRef = useRef<AddressSuggestionsHandle | null>(null);

  // Sync address bar when the active tab or its url changes externally.
  const currentUrl = tab?.url ?? '';
  if (currentUrl !== syncedUrl) {
    setSyncedUrl(currentUrl);
    setDraft(currentUrl === 'about:blank' ? '' : currentUrl);
  }

  const setOpen = (open: boolean): void => {
    setFocused(open);
    onSuggestionsOpenChange(open);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!tab) return;
    const picked = suggestionsRef.current?.currentUrl() ?? null;
    let url: string;
    if (picked !== null) {
      // User picked from the dropdown — bypass search-engine template entirely.
      url = picked;
    } else {
      const search = settings?.search;
      const tpl =
        search?.engines.find((eng) => eng.id === search.activeId)?.urlTemplate ??
        'https://www.google.com/search?q={query}';
      url = normalizeUrlInput(draft, tpl);
    }
    setOpen(false);
    void window.sidebrowser.navigate(tab.id, url);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionsRef.current?.moveDown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionsRef.current?.moveUp();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      // Keep focus + draft; user can keep typing.
    } else if (e.key === 'Tab') {
      // Tab leaves the input; the input's onBlur will close the dropdown.
    }
  };

  const handlePick = (url: string): void => {
    if (!tab) return;
    setOpen(false);
    void window.sidebrowser.navigate(tab.id, url);
  };

  const id = tab?.id ?? '';
  const disabled = !tab;

  return (
    <div className={`flex w-full items-center gap-1 border-b border-[var(--chrome-border)] bg-[var(--chrome-bg)] px-2 py-1.5 transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`}>
      <IconButton
        ariaLabel="Toggle tabs"
        testId="topbar-tabs-toggle"
        active={drawerOpen}
        onClick={onToggleDrawer}
      >
        <Layers size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Open settings"
        testId="topbar-settings-toggle"
        active={settingsOpen}
        onClick={onToggleSettings}
      >
        <Settings size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Back"
        disabled={disabled || !tab?.canGoBack}
        onClick={() => id && void window.sidebrowser.goBack(id)}
      >
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Forward"
        disabled={disabled || !tab?.canGoForward}
        onClick={() => id && void window.sidebrowser.goForward(id)}
      >
        <ArrowRight size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Reload"
        disabled={disabled}
        onClick={() => id && void window.sidebrowser.reload(id)}
      >
        {tab?.isLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
      </IconButton>
      <IconButton
        ariaLabel={tab?.isMobile ? 'Switch to desktop' : 'Switch to mobile'}
        testId="topbar-ua-toggle"
        disabled={disabled}
        active={tab?.isMobile}
        onClick={() => id && void window.sidebrowser.setMobile(id, !tab?.isMobile)}
      >
        {tab?.isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
      </IconButton>

      <form onSubmit={submit} className="relative flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Enter URL or search"
          spellCheck={false}
          data-testid="address-bar"
          disabled={disabled}
          className="w-full rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] placeholder-[var(--chrome-muted)] outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
        />
        <AddressSuggestions
          ref={suggestionsRef}
          query={draft}
          open={focused && !disabled}
          onPick={handlePick}
        />
      </form>
    </div>
  );
}

function IconButton({
  children,
  ariaLabel,
  testId,
  disabled,
  active,
  onClick,
}: {
  children: ReactElement;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded p-1 text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)] disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active ? 'bg-[var(--chrome-hover)] text-sky-400' : '')
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: 手动冒烟（用户驱动）**

报告"Task 10 完成，等待用户冒烟"。用户跑 `pnpm dev`，确认：
- 启动后 active tab 是 about:blank → 看到 NewTab 大 Globe icon + 历史列表（如果之前有访问过）；
- 点击列表行 → 在当前 tab 打开；
- 删除单行 → 该行消失；
- 地址栏 focus → 下拉出现（如果有历史）；输入字符 → 列表过滤；↓↓ Enter → 跳转所选；Esc → 下拉关闭、输入框保留；
- 设置抽屉打开时 NewTab 不被设置抽屉遮挡（两层独立运作）。

用户确认后再进入 Task 11/12。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TopBar.tsx
git commit -m "feat(M12): wire NewTab + AddressSuggestions into App + TopBar"
```

---

## Task 11: E2E — `newtab.spec.ts`

**Files:**
- Create: `tests/e2e/newtab.spec.ts`

### 设计

启动 app，断言：(1) 启动时 NewTab 容器可见（empty state 或 list）；(2) 导航到 `data:text/html,...` → NewTab 消失；(3) 在地址栏清空 + Enter → 回到 about:blank → NewTab 重新显示。

历史 seed：跑测试前在 userDataDir 下写一个 `sidebrowser-history.json`，测试断言列表中能看到。

### Steps

- [ ] **Step 1: 写 `tests/e2e/newtab.spec.ts`**

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, navigateActive } from './helpers';
import type { HistoryEntry } from '../../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Seed { url: string; title?: string }

/** Seed history through the SIDEBROWSER_E2E test hook (`__sidebrowserTestHooks.seedHistory`). */
async function seedHistory(app: ElectronApplication, urls: Seed[]): Promise<void> {
  const now = Date.now();
  const entries: HistoryEntry[] = urls.map((u, i) => ({
    url: u.url,
    title: u.title ?? '',
    favicon: null,
    firstVisitedAt: now - (urls.length - i) * 1000,
    lastVisitedAt: now - (urls.length - i) * 1000,
    visitCount: 1,
  }));
  await app.evaluate((_, payload: HistoryEntry[]) => {
    const hooks = (globalThis as { __sidebrowserTestHooks?: { seedHistory(e: HistoryEntry[]): void } }).__sidebrowserTestHooks;
    if (!hooks?.seedHistory) throw new Error('seedHistory hook not installed — was SIDEBROWSER_E2E=1 set?');
    hooks.seedHistory(payload);
  }, entries);
}

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

test.describe('NewTab', () => {
  test('shows empty-state when there is no history and active tab is about:blank', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await expect(window.getByTestId('newtab')).toBeVisible();
      await expect(window.getByTestId('newtab-empty')).toBeVisible();
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('shows seeded history list', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, [
        { url: 'https://example.org', title: 'Example' },
        { url: 'https://github.com', title: 'GitHub' },
      ]);
      // seed() schedules a 16ms-throttled notify → history:changed broadcast →
      // NewTab re-fetch. expect.poll absorbs that latency.
      await expect.poll(async () => (await window.getByTestId('newtab-item').count()), { timeout: 5_000 }).toBe(2);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('hides when navigating away from about:blank, returns when navigated back', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await expect(window.getByTestId('newtab')).toBeVisible();
      await navigateActive(window, 'data:text/html,<title>x</title><body>hi</body>');
      await expect(window.getByTestId('newtab')).toBeHidden();

      const bar = window.getByTestId('address-bar');
      await bar.fill('');
      await bar.press('Enter');
      await expect(window.getByTestId('newtab')).toBeVisible();
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('removes a single entry on × click', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-newtab-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, [
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
      ]);
      await expect.poll(async () => (await window.getByTestId('newtab-item').count()), { timeout: 5_000 }).toBe(2);
      // dispatchEvent bypasses opacity:0 — the button is in the DOM regardless of hover.
      await window.getByTestId('newtab-remove').first().dispatchEvent('mousedown');
      await expect(window.getByTestId('newtab-item')).toHaveCount(1);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 跑该 spec**

Run: `pnpm test:e2e tests/e2e/newtab.spec.ts`
Expected: PASS — 4 个用例全绿。

如果失败：先看 helpers.ts 是否有 getChromeWindow 等待逻辑超时（默认 10s）；其次确认 electron-store 文件名格式（如果 `sidebrowser-history.json` 没读到，可能是 electron-store 内部包了一层不同的 key 命名——回到 task 6 检查 `createElectronHistoryBackend` 的 `name: 'sidebrowser-history'` 实际生成的文件名）。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/newtab.spec.ts
git commit -m "test(M12): e2e for NewTab visibility, list, click-to-navigate, single-delete"
```

---

## Task 12: E2E — `autocomplete.spec.ts`

**Files:**
- Create: `tests/e2e/autocomplete.spec.ts`

### 设计

四个用例：(1) focus 出现下拉显示 8 条最近；(2) 输入 'git' 过滤；(3) ↓↓ Enter 跳转到第二条；(4) Esc 关闭、保留输入。

历史 seed 复用 newtab.spec.ts 的辅助（独立写一份避免 cross-file dep）。

### Steps

- [ ] **Step 1: 写 `tests/e2e/autocomplete.spec.ts`**

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';
import type { HistoryEntry } from '../../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface Seed { url: string; title: string }

async function seedHistory(app: ElectronApplication, urls: Seed[]): Promise<void> {
  const now = Date.now();
  const entries: HistoryEntry[] = urls.map((u, i) => ({
    url: u.url,
    title: u.title,
    favicon: null,
    firstVisitedAt: now - (urls.length - i) * 1000,
    lastVisitedAt: now - (urls.length - i) * 1000,
    visitCount: 1,
  }));
  await app.evaluate((_, payload: HistoryEntry[]) => {
    const hooks = (globalThis as { __sidebrowserTestHooks?: { seedHistory(e: HistoryEntry[]): void } }).__sidebrowserTestHooks;
    if (!hooks?.seedHistory) throw new Error('seedHistory hook not installed — was SIDEBROWSER_E2E=1 set?');
    hooks.seedHistory(payload);
  }, entries);
}

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

const FIXTURE: Seed[] = [
  { url: 'https://github.com', title: 'GitHub' },
  { url: 'https://gitlab.com', title: 'GitLab' },
  { url: 'https://example.com', title: 'Example' },
  { url: 'https://example.org', title: 'Example Org' },
];

test.describe('AddressSuggestions', () => {
  test('shows recent history when address bar focused with empty input', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      const bar = window.getByTestId('address-bar');
      await bar.click();   // focus
      await expect(window.getByTestId('address-suggestions')).toBeVisible();
      const items = window.getByTestId('address-suggestions-item');
      await expect(items).toHaveCount(4);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('filters items as user types', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      const bar = window.getByTestId('address-bar');
      await bar.click();
      await bar.fill('git');
      const items = window.getByTestId('address-suggestions-item');
      await expect(items).toHaveCount(2);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Down arrow x2 + Enter navigates to a git* highlighted item', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      const bar = window.getByTestId('address-bar');
      await bar.click();
      await bar.fill('git');
      // After 'git' filter: github + gitlab (tier 0), ranked by frecency.
      // With identical visitCount=1 and adjacent timestamps, exact ranking
      // is implementation-detail; we only assert keyboard nav lands on a
      // git* URL (not on the search-engine fallback).
      await bar.press('ArrowDown');
      await bar.press('ArrowDown');
      await bar.press('Enter');
      await expect.poll(async () => bar.inputValue(), { timeout: 10_000 }).toMatch(/^https:\/\/git/);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('Esc closes dropdown and keeps draft input', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ac-'));
    const app = await launch(userDataDir);
    try {
      const window = await getChromeWindow(app);
      await seedHistory(app, FIXTURE);
      await waitForAddressBarReady(window);
      const bar = window.getByTestId('address-bar');
      await bar.click();
      await bar.fill('git');
      await expect(window.getByTestId('address-suggestions')).toBeVisible();
      await bar.press('Escape');
      await expect(window.getByTestId('address-suggestions')).toBeHidden();
      await expect(bar).toHaveValue('git');
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 跑该 spec**

Run: `pnpm test:e2e tests/e2e/autocomplete.spec.ts`
Expected: PASS — 4 个用例全绿。

如果"Down arrow x2 + Enter"用例失败：检查 ranking 是否产生不同顺序（本测试假设 github/gitlab 都是 tier 0，按 frecency 排——seed 都是 visitCount=1、相邻 1s 时差，github 应排前因为 lastVisitedAt 更小（先 seed），gitlab 排后；↓↓ 选中第二个 = gitlab）。如果 frecency 公式调整过，更新断言里的 url pattern。

- [ ] **Step 3: 跑全套测试**

Run: `pnpm test && pnpm test:e2e`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/autocomplete.spec.ts
git commit -m "test(M12): e2e for autocomplete dropdown — focus, filter, keyboard, Esc"
```

---

## Task 13: 收尾 — README + tag

**Files:**
- Modify: `README.md`
- Modify: `package.json`（version bump）

### 设计

加 README 行说明 history 文件位置（隐私自处置入口）+ 列表中加 M12 特性。Version 从 `1.2.1` → `1.3.0`（minor，因为新增 IPC + 用户可见特性）。

Tag 步骤等用户确认手动冒烟通过后再做（plan execution convention）。

### Steps

- [ ] **Step 1: README 改动**

在 `README.md` 的 Features 列表加一行（位置参考现有格式）：

```md
- Recent-pages new tab + history-driven address-bar autocomplete (M12)
```

在隐私 / data 段落或 FAQ 类章节里加一行（如果没有相应章节就追加到底部新建一节）：

```md
### Privacy

History is stored locally at `<userData>/sidebrowser-history.json` (Windows: `%APPDATA%/sidebrowser/`). Delete the file to clear all history. There's currently no in-app "clear history" button — this is YAGNI for v1; revisit if requested.
```

- [ ] **Step 2: package.json version bump**

```json
"version": "1.3.0",
```

- [ ] **Step 3: typecheck + 全套测试 + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 全部 PASS

- [ ] **Step 4: Commit version bump + README**

```bash
git add README.md package.json
git commit -m "chore(release): M12 v1.3.0 — history store + NewTab + autocomplete"
```

- [ ] **Step 5: 等用户确认手动冒烟**

报告"M12 全部 task 完成，等待用户最终冒烟然后打 tag"。用户跑 `pnpm dev` 真用一会儿 + 跑一次 `pnpm build` 验证打包未坏。

- [ ] **Step 6: 用户确认后打 tag**

```bash
git tag -a m12-history-and-newtab -m "M12: history store + NewTab + address-bar autocomplete"
```

不 push tag——用户决定何时 push。

---

## Self-Review Checklist（写完后填）

- [ ] **Spec coverage**：spec §1–§12 每一节都有对应 task；§7.4 blur 竞争处理在 Task 8/9/10；§9 时序图涵盖在 Task 10 集成 + Task 12 E2E。
- [ ] **Placeholder scan**：无 TBD/TODO/"add appropriate"。
- [ ] **Type consistency**：`HistoryEntry` / `Suggestion` 字段名和顺序在 types.ts、history-store.ts、suggestion-ranker.ts、preload api、E2E seed 全部一致。`HistoryRecorder` 方法名（`recordNavigation` / `patchTitle` / `patchFavicon` / `revokeFailed` / `forgetTab`）从 Task 3 到 Task 5 到 ViewManager 到测试一致。`AddressSuggestionsHandle` 三方法名（`moveDown` / `moveUp` / `currentUrl`）在 Task 9 定义、Task 10 调用一致。
- [ ] **IPC 一致**：`historyRecent` / `historySuggest` / `historyRemove` / `historyChanged` 4 个 channel 在 Task 1 定义、Task 6 路由 + preload、E2E seed 文件结构一致。
