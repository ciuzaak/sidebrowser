# History & NewTab 设计文档 — 浏览历史 + 新标签页 + 网址栏自动补全

**日期：** 2026-05-06
**状态：** 待实现
**目标读者：** 实现本里程碑的开发者（含子 agent）
**前置：** [sidebrowser design](2026-04-23-sidebrowser-design.md) §4.2 ViewSuppressed 机制、§5 ViewManager 事件流、§7 Settings schema

---

## 1. 目标

三个浏览器基础体验里的两个，本里程碑一起交付：

1. **浏览历史持久化**（`HistoryStore`）：记录用户访问过的 URL + 标题 + favicon + 时间 + 频次，作为后两个特性的共同数据源。
2. **新标签页（NewTab）的"最近访问"列表**：当 active tab 的 `url === 'about:blank'` 时，在 React 层覆盖原生 view，展示最近访问的页面，点击直接在当前 tab 内导航过去。
3. **网址栏自动补全**：地址栏 focus 时显示历史下拉，输入字符后实时过滤；↑/↓/Enter/Esc 键盘可控。

第三个相关特性 — **NewTab 上的搜索框 + 最近搜索** — 本期**不做**（标记为未来扩展，NewTab 顶部为它预留位置）。

里程碑 ID：**M12**。

---

## 2. 已确认的设计决定

| 项 | 决定 | 备注 |
|---|---|---|
| History 去重 | 按 URL 去重，记 `lastVisitedAt` + `firstVisitedAt` + `visitCount` | 重访只更新时间戳和计数 |
| History 容量 | LRU 上限 500 条 | 超出时丢 `lastVisitedAt` 最小的 |
| 不记录的 URL | `about:blank`、`chrome://*`、`devtools://*`、`file://`、空字符串 | 通过 scheme 白名单控制 |
| 加载失败处理 | top-frame `did-fail-load`（非 `-3 ABORTED`）：若该次导航是新插入则 revoke | 用户输错域名时不留下死链接 |
| SPA 内导航 | 不记录（不监听 `did-navigate-in-page`） | 噪音过大 |
| 标题/favicon 后填 | `page-title-updated` / `page-favicon-updated` 事件命中当前 URL 时 patch | 非空才覆盖（避免被空值清空） |
| NewTab 触发条件 | `activeTab.url === 'about:blank'` | 单一信号，整个 app 一处判断 |
| NewTab 最近访问条数 | 12 条，按 `lastVisitedAt` 倒序 | |
| NewTab 顶部 | 中央放一个 `Globe` icon（lucide-react），尺寸 64px、muted 色 | 占位给未来 #1 搜索框；本期就放 icon，不留空 |
| NewTab 点击行为 | 当前 tab 内导航（替换 about:blank） | 不开新 tab |
| NewTab 删除单条 | 每行 hover 出 × 按钮，点击调 `history:remove` | 隐私/纠错有用，便宜 |
| 自动补全触发 | 地址栏 focus 即开（Q2 选项 B） | 与 Chrome/Edge 行为一致 |
| 自动补全条数 | 最多 8 条 | |
| 自动补全匹配 | URL 前缀 → URL substring → title substring，三档优先级 | 大小写不敏感；同档内按 score 降序 |
| 排序 score | `visitCount / (1 + ageDays / 7)` | "frecency" 简化版：7 天衰减一半，访问次数线性加权 |
| 自动补全键盘 | ↑/↓ 选择、Enter 跳转、Esc 关闭、Tab 关闭 | 不实现 inline preview（光标位置补全） |
| View 层级冲突 | 下拉打开期间 `setViewSuppressed(true)`，关闭复原 | 简单可靠，闪烁可接受 |
| Suppression 多源协调 | 在 `App.tsx` 集中：`settingsOpen \|\| suggestionsOpen \|\| isNewTab` 三者 OR | 现有单源（settingsOpen）扩展为三源 |
| 隐私 | 暂不做"清除历史" UI；store 文件路径文档化 | YAGNI |
| 持久化路径 | `app.getPath('userData')/sidebrowser-history.json` | 与 `sidebrowser-tabs.json` 同目录 |
| 持久化 debounce | 1000ms（与 tab-persistence 一致） | quit 时 flush |

---

## 3. 数据模型

### 3.1 类型（`src/shared/types.ts`）

```ts
/**
 * 单条历史记录。URL 是去重主键 — 重访同一 URL 只更新 lastVisitedAt + visitCount。
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
 * `tier` 用于调试 / 测试 / UI 染色（v1 不染色）。
 */
export interface Suggestion {
  url: string;
  title: string;
  favicon: string | null;
  /** 0 = URL 前缀匹配；1 = URL substring；2 = title substring。 */
  tier: 0 | 1 | 2;
}
```

### 3.2 持久化 schema

```ts
// 写入 sidebrowser-history.json：
{
  "entries": HistoryEntry[]    // 数组形式，加载时再建 Map
}
```

数组顺序无意义（store 内部用 `Map<string, HistoryEntry>`，按 URL 索引）。读取时 sanitize 一遍：丢弃缺字段、URL 不通过白名单、`visitCount < 1` 的条目。

---

## 4. 模块划分

### 4.1 `src/main/history-store.ts`（新增）

底层存储 + 持久化 + 订阅。**不**懂"什么时候算访问"——纯 CRUD。

```ts
export interface HistoryStoreBackend {
  get(): { entries: HistoryEntry[] } | undefined;
  set(value: { entries: HistoryEntry[] }): void;
}

export class HistoryStore {
  private readonly entries: Map<string, HistoryEntry>;     // url → entry
  private readonly listeners = new Set<() => void>();
  private readonly backend: HistoryStoreBackend;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(backend: HistoryStoreBackend) { /* load + sanitize */ }

  /** 插入或更新；返回 true 表示是新插入（用于 recorder 的 revoke 决策）。 */
  upsert(url: string, now: number): boolean;
  patchTitle(url: string, title: string): void;
  patchFavicon(url: string, favicon: string | null): void;
  remove(url: string): void;
  /** 最近 N 条，按 lastVisitedAt 倒序。 */
  recent(limit: number): HistoryEntry[];
  /** 全量快照（autocomplete 用；规模 ≤500，每次复制 ok）。 */
  all(): HistoryEntry[];

  onChanged(cb: () => void): () => void;       // unsubscribe

  flush(): void;                                // quit 前调
  // private evictIfOverCap(): void;            // 超 500 条丢 lastVisitedAt 最小
  // private scheduleSave(): void;              // 1000ms debounce
}

export function createHistoryStore(): HistoryStore;  // 工厂，real backend = electron-store
```

**Cap 与 eviction**：超过 500 时找 `lastVisitedAt` 最小的删掉。500 条规模下线性扫描每次 < 1ms，不需要堆。

**降级**：`createHistoryStore` 内部 try/catch electron-store 构造，失败时用内存 fake（与 `tab-persistence.ts` 同模式）。

### 4.2 `src/main/history-recorder.ts`（新增）

把"什么算访问"的策略隔离出来，方便单测。

```ts
const RECORDABLE_SCHEME = /^https?:/i;       // 只记 http(s)；about:/file:/chrome: 都跳过

interface PendingNavigation {
  url: string;
  wasInsert: boolean;       // upsert 返回值；revoke 决策用
}

export class HistoryRecorder {
  private readonly store: HistoryStore;
  private readonly pending = new Map<string, PendingNavigation>();   // tabId → 上次 record

  constructor(store: HistoryStore) { this.store = store; }

  /** ViewManager 在 did-navigate 调。 */
  recordNavigation(tabId: string, url: string): void {
    if (!RECORDABLE_SCHEME.test(url)) {
      this.pending.delete(tabId);
      return;
    }
    const wasInsert = this.store.upsert(url, Date.now());
    this.pending.set(tabId, { url, wasInsert });
  }

  /** ViewManager 在 page-title-updated 调；空标题不覆盖。 */
  patchTitle(url: string, title: string): void {
    if (title.trim() === '') return;
    this.store.patchTitle(url, title);
  }

  /** ViewManager 在 page-favicon-updated 调。 */
  patchFavicon(url: string, favicon: string | null): void {
    this.store.patchFavicon(url, favicon);
  }

  /**
   * ViewManager 在 did-fail-load (top frame, errorCode !== -3) 调。
   * 仅当本次导航是新插入时撤回 — 已有条目（用户重访失败的页面）保持原样。
   */
  revokeFailed(tabId: string): void {
    const pending = this.pending.get(tabId);
    if (!pending) return;
    if (pending.wasInsert) this.store.remove(pending.url);
    this.pending.delete(tabId);
  }

  /** ViewManager 在 closeTab 调，清理状态。 */
  forgetTab(tabId: string): void { this.pending.delete(tabId); }
}
```

### 4.3 `src/main/suggestion-ranker.ts`（新增）

纯函数，输入 `HistoryEntry[]` + 查询字符串，输出排序后的 `Suggestion[]`。无副作用、易单测。

```ts
const SUGGEST_LIMIT = 8;

export function rankSuggestions(entries: HistoryEntry[], query: string, now: number): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  // 算 tier：URL 去 scheme 后做前缀比对，否则 substring，否则 title substring
  // 同 tier 内按 score = visitCount / (1 + ageDays / 7) 降序
  // 截前 8
}

/** 自动补全空查询时（focus 但未输入）— 取最近 N 条。 */
export function recentEntries(entries: HistoryEntry[], limit: number): HistoryEntry[];
```

`stripScheme(url)` = `url.replace(/^https?:\/\//, '')`，让"github" 能匹配 `https://github.com`。

### 4.4 `src/main/view-manager.ts`（改）

在已有事件回调里加 4-5 行调 recorder。

```ts
// 构造函数新增依赖（main bootstrap 注入）：
constructor(
  window: BrowserWindow,
  getBrowsingDefaults: BrowsingDefaultsGetter,
  recorder: HistoryRecorder | null,    // 测试时可传 null（保留单测路径）
) { /* ... */ }
```

`attachWebContentsEvents` 修改：

```ts
const onNavigate = (_e, url: string): void => {
  this.updateTab(id, { /* ... 现有 ... */ });
  this.recorder?.recordNavigation(id, url);     // 新增
  // ... 现有 CDP / zoom 逻辑保持 ...
};

const onTitle = (_e, title: string): void => {
  this.updateTab(id, { title });
  const url = this.tabs.get(id)?.tab.url;
  if (url) this.recorder?.patchTitle(url, title);   // 新增
};

const onFavicon = (_e, favicons: string[]): void => {
  const fav = favicons[0] ?? null;
  this.updateTab(id, { favicon: fav });
  const url = this.tabs.get(id)?.tab.url;
  if (url) this.recorder?.patchFavicon(url, fav);   // 新增
};

const onFailLoad = (_e, errorCode: number, _desc: string, _validatedURL: string, isMainFrame: boolean): void => {
  if (!isMainFrame) return;
  if (errorCode === -3) return;     // ABORTED（用户主动取消 / 跨进程导航的正常 abort）
  this.recorder?.revokeFailed(id);
};
wc.on('did-fail-load', onFailLoad);
```

`closeTab` 末尾加 `this.recorder?.forgetTab(id);`。

### 4.5 `src/renderer/src/components/NewTab.tsx`（新增）

```tsx
export function NewTab(): ReactElement {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const load = (): void => { void window.sidebrowser.historyRecent(12).then(setEntries); };
    load();
    return window.sidebrowser.onHistoryChanged(load);
  }, []);

  const navigate = (url: string): void => { /* 调 tab:navigate 当前 active id */ };
  const remove = (url: string): void => { void window.sidebrowser.historyRemove(url); };

  return (
    <div className="absolute inset-0 flex flex-col items-center bg-[var(--chrome-bg)] text-[var(--chrome-fg)] overflow-y-auto">
      <Globe size={64} className="mt-12 mb-8 text-[var(--chrome-muted)]" />
      {entries.length === 0 ? (
        <div className="text-sm text-[var(--chrome-muted)]">No recent pages yet</div>
      ) : (
        <ul className="w-full max-w-md px-4 space-y-1">
          {entries.map(e => (
            <li key={e.url} className="group flex items-center gap-2 rounded p-2 hover:bg-[var(--chrome-hover)] cursor-pointer">
              <Favicon src={e.favicon} />
              <div className="flex-1 min-w-0" onClick={() => navigate(e.url)}>
                <div className="text-sm truncate">{e.title || e.url}</div>
                <div className="text-xs text-[var(--chrome-muted)] truncate">{e.url}</div>
              </div>
              <button onClick={() => remove(e.url)} className="opacity-0 group-hover:opacity-100" aria-label="Remove from history">
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

挂载位置：`App.tsx`，`isNewTab && <NewTab />`。

### 4.6 `src/renderer/src/components/AddressSuggestions.tsx`（新增）

下拉子组件。父（TopBar）传入 query、open、onSelect、onClose 回调；自己负责调 IPC 拿 suggestions、键盘高亮、渲染。

```tsx
interface Props {
  query: string;
  open: boolean;
  onPick: (url: string) => void;     // 父调 navigate
  onClose: () => void;
}

export function AddressSuggestions({ query, open, onPick, onClose }: Props): ReactElement | null {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  useEffect(() => {
    if (!open) return;
    void window.sidebrowser.historySuggest(query).then(setItems);
  }, [open, query]);

  // ↑ ↓ Enter Esc 键盘处理通过父级 onKeyDown 桥接（input 还在父级 form 里）
  // ...
}
```

键盘处理放在 `TopBar` 的 input `onKeyDown`，而不是子组件里——input focus 时下拉自身没焦点，事件得在 input 拦。子组件通过 `useImperativeHandle` 暴露 `moveUp()` / `moveDown()` / `currentUrl()`。

### 4.7 `src/renderer/src/App.tsx`（改）

集中 suppression 决策：

```ts
const [suggestionsOpen, setSuggestionsOpen] = useState(false);
const isNewTab = activeTab?.url === 'about:blank';
const suppressed = settingsOpen || suggestionsOpen || isNewTab;
useEffect(() => { window.sidebrowser.setViewSuppressed(suppressed); }, [suppressed]);
```

把 `setSuggestionsOpen` 作为 prop 下传给 TopBar。`isNewTab && <NewTab />` 渲染在 SettingsDrawer 同层。

---

## 5. IPC contract

新增 3 个 invoke + 1 个广播 + 1 个 send（`src/shared/ipc-contract.ts`）：

```ts
historyRecent: 'history:recent',         // R→M invoke
historySuggest: 'history:suggest',       // R→M invoke
historyRemove: 'history:remove',         // R→M send
historyChanged: 'history:changed',       // M→R 广播
```

```ts
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
  request: Record<string, never>;        // 仅信号；renderer 自己 re-fetch
  response: void;
};
```

`history:changed` 只是个 ping，不带 payload，避免广播全量 500 条。频率限制：HistoryStore 内部 16ms 节流广播（不要每个 onTitle 各广播一次），最终态用户不可感知。

`preload/index.ts` 暴露：
- `historyRecent(limit: number): Promise<HistoryEntry[]>`
- `historySuggest(query: string): Promise<Suggestion[]>`
- `historyRemove(url: string): void`
- `onHistoryChanged(cb: () => void): () => void`（unsubscribe）

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| `electron-store` 构造失败 | 降级到内存 fake；本会话无持久化；下会话尝试覆盖 | 沿用 tab-persistence 模式 |
| `sidebrowser-history.json` 损坏（JSON 解析失败） | electron-store 自身丢弃；HistoryStore 拿到 undefined → 空 Map 启动 | |
| 单条 entry 缺字段 | sanitize 时跳过 | |
| `history:suggest` 在 store 还没 hydrate 时调 | 返回 `[]`（HistoryStore 启动是同步 load，实际不会发生） | |
| `historyRemove` 不存在的 URL | 静默 no-op | |
| Recorder 收到 SPA hash 切换 | 不会发生（不监听 `did-navigate-in-page`） | |
| 加载失败 errorCode `-3 ABORTED` | 不 revoke。原因：跨进程 / 用户主动 stop / 重定向产生的 abort 不是真失败 | |

---

## 7. UI 细节

### 7.1 NewTab 布局（手机宽 393px 基准）

```
┌─────────────────────────────────┐
│                                 │
│              [Globe]            │  ← 64px，mt-12
│                                 │
│  ┌──────────────────────────┐   │
│  │ 🌐 GitHub                │   │  ← 单行 hover；× 在右边 hover 出现
│  │    https://github.com    │   │
│  ├──────────────────────────┤   │
│  │ ...                      │   │
│  └──────────────────────────┘   │
│                                 │
└─────────────────────────────────┘
```

- 容器 `absolute inset-0`，背景跟 chrome 主题，可滚动
- 列表 `max-w-md`（宽窗口下不撑满；窄窗口 `px-4` 内边距）
- 行高紧凑（一行 title + 一行小灰字 url），整行点击导航
- × 按钮 `opacity-0 group-hover:opacity-100`，`aria-label="Remove from history"`

### 7.2 AddressSuggestions 布局

- `absolute` 定位在 TopBar input 下方，宽度同 input
- 背景 `bg-[var(--chrome-bg)]`、边框 `border-[var(--chrome-border)]`、圆角 + 阴影
- 单行：favicon 16px + title（一行截断） + URL（小字灰色，一行截断）
- 高亮行：`bg-[var(--chrome-hover)]`
- 最多 8 行；空 query 时显示 recent 8 条；空结果时不渲染（不显示空提示）

### 7.3 Favicon 兜底

若 `favicon === null`，渲染 `<Globe size={16} className="text-[var(--chrome-muted)]" />`。NewTab 和 AddressSuggestions 共用一个 `<Favicon src={...} size={n} />` 子组件，独立文件 `src/renderer/src/components/Favicon.tsx`，因为两个 caller 跨文件。

### 7.4 下拉点击 vs input blur 竞争

地址栏 input 失焦会关闭下拉（`setSuggestionsOpen(false)`），但用户点击下拉行的 `onClick` 在 input blur 之后才触发——下拉已经被关掉、组件被 unmount，点击事件丢失。

修法：下拉行用 `onMouseDown(e => { e.preventDefault(); onPick(url); })` 而不是 `onClick`。`mousedown` 早于 `blur`，且 `preventDefault` 阻止 input 失焦，input 保持 focus 状态直到 onPick 触发的导航完成（导航后 url 不再是 about:blank、suggestionsOpen 也会被 onPick 调用方主动设 false）。

× 删除按钮同理用 `onMouseDown`，确保单条删除不会因为先丢 focus 而 unmount 整个下拉。

---

## 8. 测试策略

### 8.1 单元（vitest）

- `history-store.test.ts`
  - sanitize：丢弃缺字段 / 错 scheme / `visitCount < 1`
  - upsert：新插入返回 true；重访返回 false 且 `visitCount` 自增、`lastVisitedAt` 更新、`firstVisitedAt` 不变
  - `patchTitle('')` 不覆盖；`patchTitle('foo')` 覆盖
  - eviction：插入第 501 条触发 LRU
  - debounce：连续 3 次 upsert 只产生 1 次 backend.set
- `history-recorder.test.ts`
  - 跳过 about:blank / chrome: / file: / data:
  - `revokeFailed` 仅在本次是新插入时删
  - `revokeFailed` 后 `pending` 清空（再调一次不重复删）
  - `forgetTab` 清状态
- `suggestion-ranker.test.ts`
  - tier 排序：URL 前缀 → URL substring → title substring
  - 同 tier 内 score 降序（构造 visitCount + age 组合验证）
  - 空 query 返回 `[]`
  - 大小写不敏感
  - `stripScheme` 让 "github" 匹配 `https://github.com`
- `view-manager.test.ts`（已有）
  - 增 case：传入 fake recorder，验证 `did-navigate` 调 `recordNavigation`、`did-fail-load (mainFrame, errorCode != -3)` 调 `revokeFailed`、`closeTab` 调 `forgetTab`

### 8.2 E2E（playwright）

- `newtab.spec.ts`
  - 启动时 active tab 是 about:blank → 看到 NewTab UI（`Globe` icon 和 `No recent pages yet` 或列表）
  - 导航到一个 URL → NewTab 消失，view 显示
  - 回到 blank（清空地址栏 → Enter）→ NewTab 重新出现
- `autocomplete.spec.ts`
  - 历史预 seed 几条 → focus 地址栏 → 看到下拉
  - 输入字符 → 列表过滤
  - ↓↓ Enter → 跳转到第二条
  - Esc → 下拉关闭，输入框保留

测试不用真上网；用 `data:text/html,...` 或本地 fixture（参考现有 e2e 测试）。

---

## 9. 时序：用户在地址栏输入字符的完整链路

```
focus input
  → TopBar setFocused(true)
  → setSuggestionsOpen(true) （bubble up）
  → App.tsx：suppressed = true → IPC viewSetSuppressed
  → ViewManager.applyBounds() → active view 缩到 0
  → AddressSuggestions effect：historySuggest('') → recentEntries → 渲染 8 条最近

用户按 'g'
  → TopBar setDraft('g')
  → AddressSuggestions effect 重跑：historySuggest('g')
  → main: rankSuggestions(store.all(), 'g', Date.now()) → 8 条
  → AddressSuggestions 重新渲染

用户 ↓↓ Enter
  → TopBar onKeyDown：第二次 ↓ 调子组件 moveDown
  → Enter：取子组件 currentUrl()，submit 用它（绕过搜索引擎模板）
  → tab:navigate
  → ViewManager.navigate → loadURL → did-navigate → HistoryRecorder.recordNavigation
  → HistoryStore.upsert：visitCount++、lastVisitedAt = now → emit changed
  → 所有 renderer onHistoryChanged 触发刷新（NewTab 不可见但订阅着 — 刷新便宜）

input blur
  → TopBar setFocused(false)
  → setSuggestionsOpen(false)
  → App.tsx：suppressed = isNewTab（导航成功的话已是 false）
  → view 复位
```

---

## 10. 与现有里程碑的兼容

- **M11 search engines**：地址栏 submit 时若用户没从下拉选条目，走原有 `normalizeUrlInput(draft, activeEngineTpl)` 路径；从下拉选了 URL 则跳过 normalize 直接用。
- **M10 mobile emulation**：NewTab 不是真页面，不涉及 emulation。当前 tab `url === 'about:blank'` 时 `tab.isMobile` 仍可切，下次导航生效——保持现有语义。
- **M9 tab persistence**：`PersistedTab` 已含 `url`，`about:blank` 已经过 `SAFE_SCHEME` 校验通过——重启后 active tab 是 blank 时，NewTab 自然出现。无需改动 tab-persistence。
- **设置抽屉 / TabDrawer**：当它们 open 时也调 setViewSuppressed，与本期的 `isNewTab || suggestionsOpen` 在 App.tsx 里 OR 起来——三源互不干扰。
- **键盘快捷键 §15**：`focus-address-bar`（Ctrl+L）已经 focus input；focus 即触发下拉，自然兼容。

---

## 11. 不做（YAGNI / 留给后续）

- **NewTab 上的搜索框 + 最近搜索**（原始 #1 需求）。NewTab 顶部已留位置（Globe icon 占位），后续把 icon 换成搜索框 + 引擎切换 + recent searches 即可。
- **chrome://history 风格的全量历史页**。
- **清除历史 UI**。手动删 `app.getPath('userData')/sidebrowser-history.json` 即可。本期把路径写到 README 注释。
- **历史导出 / 同步 / 多设备**。
- **域级折叠**（同域多页面合并显示）。
- **自动补全的 inline preview**（光标后部分自动填充）。
- **下拉 native popup**（用 BrowserWindow）。当前的 setViewSuppressed 闪烁可接受。
- **HTTPS-only / 隐私 schemes 分流**。
- **无痕模式**。

---

## 12. 文件清单

**新增**
- `src/main/history-store.ts`
- `src/main/history-recorder.ts`
- `src/main/suggestion-ranker.ts`
- `src/renderer/src/components/NewTab.tsx`
- `src/renderer/src/components/AddressSuggestions.tsx`
- `src/renderer/src/components/Favicon.tsx`
- 测试：`src/main/history-store.test.ts`、`src/main/history-recorder.test.ts`、`src/main/suggestion-ranker.test.ts`
- E2E：`tests/e2e/newtab.spec.ts`、`tests/e2e/autocomplete.spec.ts`

**修改**
- `src/shared/types.ts` — 加 `HistoryEntry` / `Suggestion`
- `src/shared/ipc-contract.ts` — 加 4 个 channel + IpcContract 条目
- `src/preload/index.ts` + `src/preload/api.d.ts` — 暴露 4 个新 API
- `src/main/index.ts` — 构造 HistoryStore + HistoryRecorder，注入 ViewManager；quit 前 flush
- `src/main/ipc-router.ts` — 注册 3 个 handler + 广播 changed
- `src/main/view-manager.ts` — 接受 recorder 参数，4 处事件回调注入；`closeTab` 加 forgetTab；`did-fail-load` 监听
- `src/renderer/src/App.tsx` — 集中 suppression；条件渲染 NewTab；下传 setSuggestionsOpen
- `src/renderer/src/components/TopBar.tsx` — 集成 AddressSuggestions；focus / blur / 键盘
- `src/renderer/src/store/tab-store.ts` — 可能需要从中导出 active id（现有 useActiveTab 提供 tab，已够用）

---
