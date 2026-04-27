# M11 设计文档 — Search engines + Page zoom

**日期：** 2026-04-27
**状态：** 待实现
**目标读者：** 实现本里程碑的开发者（含子 agent）
**前置：** [sidebrowser design](2026-04-23-sidebrowser-design.md) §7 Settings schema、§15 键盘快捷键

---

## 1. 目标

两个独立但同里程碑交付的 UX 增强：

1. **可定制搜索引擎**：默认搜索引擎从 DuckDuckGo 改为 Google；设置抽屉新增 Search section，内置 Google / DuckDuckGo / Bing / 百度 四档，用户可添加/删除自定义条目。
2. **网页级缩放**：Ctrl+滚轮调整当前 tab 的页面缩放；Ctrl+0 复位到 100%。每 tab 独立、关 tab 即丢、不持久化。

里程碑 ID：**M11**。命名沿用现有里程碑序列（M9 已交付，M10 是 mobile-emulation）。

---

## 2. 已确认的设计决定

| 项 | 决定 | 备注 |
|---|---|---|
| 默认搜索引擎 | Google | 老用户首次启动会从 DuckDuckGo 切到 Google（用户明确要求） |
| 内置引擎集合 | Google / DuckDuckGo / Bing / 百度 4 档 | 内置不可删、不可改 name/URL |
| 自定义引擎 | 支持 + URL 模板 | name + `urlTemplate`（含 `{query}` 占位符） |
| URL 模板占位符 | `{query}` | 浏览器界通用约定 |
| Zoom 作用域 | 每 tab 独立 | 关 tab 即丢，不持久化 |
| Zoom 范围 | 50% – 300% | 侧边窗 393px 宽，超出此区间收益低 |
| Zoom 步进 | ±10% 线性 | 比 Chrome 档位表实现简单一行 clamp |
| Zoom 复位快捷键 | Ctrl+0 | 与 Chrome/Firefox/Edge 一致，零学习成本 |
| Zoom UI 指示器 | v1 不做 | 需要时再加 |

---

## 3. Settings schema 扩展

新增 `search` section，**不动现有任何 section**。

### 3.1 类型（`src/shared/types.ts`）

```ts
export interface SearchEngine {
  /** Builtins 用稳定字符串 ('google'/'duckduckgo'/'bing'/'baidu')；自定义用 nanoid。 */
  id: string;
  name: string;
  /** 必含 '{query}' 占位符。例：'https://www.google.com/search?q={query}' */
  urlTemplate: string;
  /** true = 内置（不可删、不可改 name/urlTemplate）。 */
  builtin: boolean;
}

export interface SearchSettings {
  /** Builtins 永远在前；自定义条目追加在后。同 id 唯一。 */
  engines: SearchEngine[];
  /** 当前激活引擎 id。必须存在于 engines 的 id 集合中。 */
  activeId: string;
}

export interface Settings {
  // ...现有 7 个 section...
  search: SearchSettings;
}

export type SettingsPatch = {
  // ...现有...
  search?: Partial<SearchSettings>;
};
```

### 3.2 默认值（`src/shared/settings-defaults.ts`）

```ts
export const BUILTIN_SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'google',     name: 'Google',     urlTemplate: 'https://www.google.com/search?q={query}', builtin: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q={query}',       builtin: true },
  { id: 'bing',       name: 'Bing',       urlTemplate: 'https://www.bing.com/search?q={query}',   builtin: true },
  { id: 'baidu',      name: '百度',        urlTemplate: 'https://www.baidu.com/s?wd={query}',      builtin: true },
] as const;

export const BUILTIN_SEARCH_ENGINE_IDS = new Set(BUILTIN_SEARCH_ENGINES.map((e) => e.id));

export const DEFAULTS: Settings = {
  // ...现有 7 个 section...
  search: {
    engines: [...BUILTIN_SEARCH_ENGINES],   // 浅拷贝避免暴露 readonly array
    activeId: 'google',
  },
};
```

### 3.3 迁移

老用户的 `<userData>/config.json` 没有 `search` 字段。`SettingsStore.fillMissingSections` 已经"缺 section 整段补默认"——`search` section 在缺失时整体补 `DEFAULTS.search`。这意味着升级到 M11 后老用户会**自动从 DuckDuckGo 切到 Google**——这是用户明确要求的行为。

> 不需要为 search 写专门迁移代码。`fillMissingSections` 加一行 `search: persisted.search ?? DEFAULTS.search` 就行（与现有 7 个 section 同模式）。

---

## 4. clampSettings — Search 验证规则

`src/main/clamp-settings.ts` 新增 `clampSearch(partial)`，是 main 侧的"信任边界"——所有从 IPC 进入的 search patch 都先过这一层，UI bug 也无法破坏内置项或留下脏数据。

### 4.1 校验顺序

输入 `partial: Partial<SearchSettings>`，输出 `Partial<SearchSettings>`：

1. **engines 字段（如存在）**：
   1. **过滤无效条目**：每条必须 `typeof name === 'string' && name.trim() !== ''` 且 `urlTemplate.includes('{query}')`；不合规整条丢弃。
   2. **修正 builtin 标记**：条目 `id ∈ BUILTIN_SEARCH_ENGINE_IDS` → 强制 `builtin = true`，否则 `builtin = false`。"外部传入的 builtin 字段"无权威性。
   3. **覆写内置项不可变字段**：内置 id 的条目，`name` / `urlTemplate` 用 `BUILTIN_SEARCH_ENGINES` 表里的值覆盖（即便入参想改也不让）。
   4. **去重**（按 id，先到先得）：防止 UI 重复 `+` 同一条目导致 React `key` 冲突。
   5. **补回缺失的内置项**：扫描 `BUILTIN_SEARCH_ENGINE_IDS`，缺哪个 builtin 就追加补到结果开头（保证内置 4 条永远齐全 + 顺序固定）。
   6. **顺序约定**：结果数组前 4 个永远是 builtins（按 `BUILTIN_SEARCH_ENGINES` 顺序），自定义追加在后。
2. **activeId 字段（如存在或 engines 改变后需要重新校验）**：
   - 取最终 engines 的 id 集合，若 `activeId ∉ ids` → fallback 到 `'google'`。
   - 这一步用 `current.search.activeId`（当 patch 没传 activeId 但传了 engines 删除了当前 active 时）兜底校验。

### 4.2 关键不变量（实现后单测锁住）

- 调用 `clampSearch` 后，结果中 builtins 必齐 4 条 + 永远在前。
- builtins 的 `name` 和 `urlTemplate` 永远等于 `BUILTIN_SEARCH_ENGINES` 表里的值。
- `activeId` 永远指向 engines 中存在的 id。
- 自定义 id 的条目 `urlTemplate` 必含 `{query}`。
- 输入空 patch（`{}`）→ 输出空 patch（不触发不必要的 deep-merge）。

> `current` 入参在这里**首次被真正使用**——之前 7 个 section 的 clampers 都是无状态（只看 `partial`），search 因为 activeId 跨 patch 校验需要看当前 engines 列表。这是 `clampSettings` 签名里 `current` 参数终于有用的场景。

---

## 5. URL normalization 改造

### 5.1 `src/shared/url.ts` 签名变更

```ts
// 旧
export function normalizeUrlInput(raw: string): string

// 新
export function normalizeUrlInput(raw: string, searchUrlTemplate: string): string
```

行为：

- 走"搜索"分支时（既不像 host 也不像 scheme）：
  ```ts
  return searchUrlTemplate.replace('{query}', encodeURIComponent(input));
  ```
- 其它分支（about:blank / 已有 scheme / 像 host）行为不变。
- **不在此层做 template 校验**：调用方保证传进来的 template 来自 `Settings.search` 已经过 `clampSearch` 验证；`url.ts` 是纯字符串变换层，无校验责任。

### 5.2 调用方变更

**`src/renderer/src/components/TopBar.tsx`**：

```tsx
const settings = useSettingsStore((s) => s.settings);

const submit = (e: FormEvent): void => {
  e.preventDefault();
  if (!tab) return;
  const search = settings?.search;
  // 保护性兜底：settings 未加载时用硬编码 google template，避免地址栏在加载窗口内卡死。
  const tpl =
    search?.engines.find((eng) => eng.id === search.activeId)?.urlTemplate ??
    'https://www.google.com/search?q={query}';
  const url = normalizeUrlInput(draft, tpl);
  void window.sidebrowser.navigate(tab.id, url);
};
```

`useSettingsStore` 已经存在；TopBar 只是新增一个 selector。

### 5.3 单测改造（`tests/unit/url.test.ts`）

把现有"DuckDuckGo 路由"测试改造成表驱动：每个 builtin engine 的 template 跑一次，断言输出 URL 与预期匹配；并新增"传自定义 template（含 `{query}`）"用例。

---

## 6. Zoom 实现（main 侧）

### 6.1 数据模型

```ts
// view-manager.ts 内部
private zoomFactors = new Map<string /*tabId*/, number>();   // 缺省视为 1.0
private static readonly ZOOM_MIN = 0.5;
private static readonly ZOOM_MAX = 3.0;
private static readonly ZOOM_STEP = 0.1;
```

不进 `Tab` 接口（持久化体积不变）；不进 `Settings`（关 tab 即丢，与"每 tab 独立"语义一致）。

### 6.2 Ctrl+滚轮事件源

Electron 的 `webContents.on('zoom-changed', (event, zoomDirection: 'in' | 'out') => ...)` 在用户对网页内容按 **Ctrl+滚轮** 时由 Chromium 主动发出。我们不拦键盘、不监听 wheel——这是最干净的入口。

### 6.3 createTab 时挂 listener

```ts
// 在 view-manager.ts createTab(...) 末尾、其它 webContents 监听旁边
view.webContents.on('zoom-changed', (_e, dir) => {
  const cur = this.zoomFactors.get(tabId) ?? 1.0;
  const delta = dir === 'in' ? +ViewManager.ZOOM_STEP : -ViewManager.ZOOM_STEP;
  const next = clamp(cur + delta, ViewManager.ZOOM_MIN, ViewManager.ZOOM_MAX);
  this.zoomFactors.set(tabId, next);
  view.webContents.setZoomFactor(next);
});
```

### 6.4 导航后 reapply

Chromium 在 `did-navigate` 时把 zoom level 重置回默认值（per-page zoom 是 Chromium 的内置行为）。如果不 reapply，用户调整完 zoom 后跳到下一页就会变回 100%——这违背"每 tab"语义。

`view-manager.ts` 在已有的 `did-navigate` 监听中追加：

```ts
view.webContents.on('did-navigate', (...) => {
  // ...现有 url + canGoBack/canGoForward 更新...
  const z = this.zoomFactors.get(tabId);
  if (z !== undefined && z !== 1.0) {
    view.webContents.setZoomFactor(z);
  }
});
```

`z === undefined` 表示用户从未调过 zoom（保持 Chromium 默认 1.0）；`z === 1.0` 时 setZoomFactor 也是 no-op，跳过省事。

### 6.5 closeTab 时清理

```ts
this.zoomFactors.delete(tabId);
```

防止内存泄漏（虽然量级可忽略，但保持 Map 与 tab 生命周期对齐是好习惯）。

### 6.6 复位接口

按现有 ViewManager 惯例（`closeActiveTab` / `reloadActive` 等"Active-tab convenience wrappers"组），加一个：

```ts
// view-manager.ts 公共方法（与 reloadActive / goBackActive 同 group）
resetActiveZoom(): void {
  if (!this.activeId) return;
  const wc = this.getActiveWebContents();
  if (!wc) return;
  this.zoomFactors.set(this.activeId, 1.0);
  wc.setZoomFactor(1.0);
}
```

`activeId` 是 ViewManager 现有的 private 字段；`getActiveWebContents()` 是已有公共方法。被 `keyboard-shortcuts.ts` 的 Ctrl+0 直接调用，**不走 IPC**。

### 6.7 不需要 IPC

Ctrl+滚轮在 main 内部闭环（zoom-changed → setZoomFactor）；Ctrl+0 也在 main 内部闭环（accelerator → onResetZoom → viewManager.resetActiveZoom）。renderer 完全不需要参与，所以**不新增 IPC 通道**——契约更小、攻击面更窄。

将来要做 zoom 指示器 UI 时再加 `tab:zoom-changed` 广播事件即可，本里程碑不做。

---

## 7. 键盘快捷键扩展

### 7.1 `keyboard-shortcuts.ts` 新增

```ts
// ShortcutDeps 接口加一个字段：
onResetZoom: () => void;  // Ctrl+0 — 把活跃 tab 的 zoom 复位到 100%

// buildShortcutMenuTemplate 的 submenu 数组追加：
{ label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => deps.onResetZoom() },
```

按 spec §15 现有惯例，accelerator 用 `CmdOrCtrl+` 前缀（v1 仍 Windows-only，但保持 macOS 移植兼容性）。

### 7.2 `src/main/index.ts` wire 一行

`installApplicationMenu` 调用处（见现有 wire 代码）的 `deps` 对象追加：

```ts
onResetZoom: () => viewManager.resetActiveZoom(),
```

### 7.3 spec §15 表的更新（不在本里程碑代码内，仅在主 design doc 里登记）

主 design doc §15 的快捷键表会在 M11 完成时同步追加 `Ctrl+0 — Reset zoom — 应用内` 一行。本 spec 的实现不要求改动主 design doc 文件（避免本里程碑落地时改另一个 spec 引发评审混乱）；改 §15 的工作放进 plan 的最后一步 commit。

---

## 8. SettingsDrawer UI — 新增 `Search` section

### 8.1 位置

紧跟 `Browsing` section 之后（紧挨 mobile UA 配置，语义都属于"网页交互行为"）。

### 8.2 结构

```
─── Search ──────────────────────────────────────  [↻ reset]
Active engine:  [▼ Google                       ]

Engines:
  ● Google           (built-in)
  ○ DuckDuckGo       (built-in)
  ○ Bing             (built-in)
  ○ 百度              (built-in)
  ○ StackOverflow    [✕]
  
  [+ Add custom engine]

  ── 添加表单（点 + 后展开）──────────────
  Name:         [_________________]
  URL template: [_________________]   placeholder: https://example.com/search?q={query}
                必须包含 {query}
  [Add]  [Cancel]
```

### 8.3 控件细节

- **Active engine 选择器**：单个 `<select>`，列出所有 engines（builtins + 自定义）。改变 → `update({ search: { activeId } })`。
- **Engines 列表**：每行 = engine name + (built-in / 删除按钮)；自定义条目右侧渲染 `<button>` 删除（图标 `X` from lucide-react）。删除 → `update({ search: { engines: engines.filter(e => e.id !== id) } })`，main clamp 兜底 activeId fallback。
- **添加表单**：local state（`useState`）保存 `{ name, urlTemplate, expanded }`；`Add` 按钮 disabled 直到 `name.trim() !== ''` 且 `urlTemplate.includes('{query}')`。提交时 nanoid 生成 id，append 到 engines 数组并 `update`。提交成功后清空 form + 折回未展开态。
- **Reset 按钮**（section 标题右侧）：与现有 `ResetIcon` 组件一致，仅在 `engines.length > BUILTIN_SEARCH_ENGINES.length || activeId !== 'google'` 时显示。点击 → `update({ search: { engines: [...BUILTIN_SEARCH_ENGINES], activeId: 'google' } })`，等同"恢复出厂"——所有自定义条目被删除，用户得自己重加（自定义本来就是少量长期项，可接受）。

### 8.4 删除当前 active 自定义引擎的兜底

UI 不必特殊处理：删除 → main 收到新 engines（少了一项）→ `clampSearch` 跑 activeId 校验 → fallback 到 `'google'` → 广播回来的 settings 中 `activeId === 'google'` → `<select>` 自动跟随。**完全靠 main 的 clamp 兜底**，UI 写起来无分支。

### 8.5 i18n 注记

百度的中文 name `百度` 直接硬编码在 builtins 表里。M11 不引入 i18n 框架；UI 里其它字符串（"Active engine"、"Engines"、"Add custom engine"…）暂时用英文，与现有抽屉风格一致（"Theme"/"Window"/"Mobile leave" 等都是英文）。

---

## 9. 测试策略

### 9.1 单元测试（Vitest）

| 文件 | 覆盖目标 |
|---|---|
| `tests/unit/url.test.ts`（改造） | 表驱动：每个 builtin template + 1 个自定义 template，验证搜索分支输出；现有 about/scheme/host 分支无回归 |
| `tests/unit/clamp-settings.test.ts`（追加） | `clampSearch` 的 6 条不变量逐一锁住：（a）无效条目过滤、（b）builtin 标记修正、（c）内置 name/urlTemplate 不可改、（d）按 id 去重、（e）补回缺失内置、（f）activeId 越界 fallback 到 'google' |
| `tests/unit/view-manager-zoom.test.ts`（新增） | 用 fake `webContents`（捕获 setZoomFactor 调用 + 提供发射 `zoom-changed` 的方法），覆盖：±10% 步进、范围 clamp、reset 接口、`did-navigate` reapply、closeTab 清理 |

### 9.2 E2E 测试（Playwright `_electron`）

| 文件 | 覆盖目标 |
|---|---|
| `tests/e2e/search-engine.spec.ts`（新增） | (1) 默认 engine = Google：地址栏输 `hello world` → 跳到 google.com/search?q=...；(2) 切到 Bing → 同输入跳到 bing.com；(3) 添加自定义 engine（name + template）→ select 显示该项 → 切到该项后地址栏输入跳到自定义 URL；(4) 删除自定义 active engine → activeId 自动 fallback 到 google；(5) 重启后 active engine + 自定义条目都还在 |
| `tests/e2e/zoom.spec.ts`（新增） | (1) 通过 `__sidebrowserTestHooks` 直接调 `view.webContents.emit('zoom-changed', 'in')` 三次 → 断言 zoomFactor=1.3；(2) 'out' 五次直至 clamp 在 0.5；(3) 上限 'in' 至 3.0；(4) Ctrl+0 触发 menu accelerator → zoomFactor=1.0；(5) 同 tab 调 zoom → 导航到新 URL → zoomFactor 仍生效 |

### 9.3 测试钩追加

`tests/e2e/search-engine.spec.ts` 不需要新钩——`getSettings` / `updateSettings` / `address-bar` testid 都存在。

`tests/e2e/zoom.spec.ts` 在 `__sidebrowserTestHooks` 上追加：
- `getActiveZoomFactor(): number` — 读 `viewManager.zoomFactors.get(activeTabId) ?? 1.0`
- `emitZoomChange(dir: 'in' | 'out'): void` — 在 active tab 的 webContents 上 emit `'zoom-changed'`，同步流程
- `triggerResetZoomShortcut(): void` — 直接调 `viewManager.resetActiveZoom()`（绕开 menu accelerator 在测试环境的不稳定性）

---

## 10. 错误处理与边界场景

| 场景 | 处理 |
|---|---|
| 老 config.json 没 search section | `fillMissingSections` 自动补 DEFAULTS.search（Google + 4 builtins） |
| config.json 的 engines 数组中有损坏条目（缺 urlTemplate） | `clampSearch` 过滤 + 补回缺失内置；用户无感知，下一次写入时落盘修复 |
| 用户删了所有自定义后再 reset | reset 是空操作（已是 builtins-only + google），按钮自动隐藏 |
| 用户输入 `{query}` 之外的占位符（如 `%s`） | UI Add 按钮 disabled（不通过校验）；不解析 |
| 自定义 template 在 `{query}` 之外含其它 `{...}`（如 `{lang}`） | 不替换、不报错；保留字面量。这与"模板只识别 `{query}`"一致 |
| 导航到 about:blank | `did-navigate` reapply 时 setZoomFactor 在 about: 页面也合法，no-op-safe |
| 用户在 settings 加载完成前就在 TopBar 输入并回车 | 兜底 google template 写死在 TopBar 里（§5.2），地址栏不卡死 |
| 用户改 zoom 后立即关 tab | `closeTab` 清理 Map；不影响其它 tab |
| 打开 DevTools 后 Ctrl+滚轮 | DevTools 是另一个 webContents，不会触发 active tab 的 zoom-changed；与 Chrome 行为一致 |

---

## 11. v1 不做（YAGNI）

- **Zoom 持久化**（按 hostname / 跨重启） — 用户明确选了"关 tab 即丢"
- **Zoom 数值 UI 指示器**（Chrome 那种地址栏小徽章） — 加了 `tab:zoom-changed` 广播即可，本里程碑不做
- **内置引擎重命名 / 删除** — 内置 4 个固定下来，复杂度让给自定义槽位
- **多占位符模板**（`{lang}` / `{region}` 等） — 仅 `{query}`
- **导入/导出 engines 列表** — 自定义量少，手动重建可接受
- **搜索建议（搜索框下拉补全）** — 与浏览器历史一并归到 v2
- **Ctrl++ / Ctrl+- 通过键盘 zoom** — 用户只要求 Ctrl+滚轮，不扩范围；要加只是 `keyboard-shortcuts.ts` 加两条，留给后续

---

## 12. 文件改动清单（实现导航用）

**改：**
- `src/shared/types.ts` — `SearchEngine` / `SearchSettings` / `Settings.search` / `SettingsPatch.search`
- `src/shared/settings-defaults.ts` — `BUILTIN_SEARCH_ENGINES` / `BUILTIN_SEARCH_ENGINE_IDS` / `DEFAULTS.search`
- `src/shared/url.ts` — `normalizeUrlInput` 加 `searchUrlTemplate` 参数
- `src/main/clamp-settings.ts` — 新增 `clampSearch` + 在 `clampSettings` dispatch
- `src/main/settings-store.ts` — `fillMissingSections` 加 `search` 兜底一行
- `src/main/view-manager.ts` — `zoomFactors` Map + `zoom-changed` 监听 + `did-navigate` reapply + `closeTab` 清理 + `resetActiveZoom` 公共方法
- `src/main/keyboard-shortcuts.ts` — `ShortcutDeps.onResetZoom` + Ctrl+0 menu item
- `src/main/index.ts` — wire `onResetZoom: () => viewManager.resetActiveZoom()`
- `src/renderer/src/components/TopBar.tsx` — 用 settings.search 找 active template 传给 normalizeUrlInput
- `src/renderer/src/components/SettingsDrawer.tsx` — 新增 Search section UI
- `tests/unit/url.test.ts` — 表驱动改造
- `tests/unit/clamp-settings.test.ts` — 追加 `clampSearch` 不变量测试

**新增：**
- `tests/unit/view-manager-zoom.test.ts` — Zoom 单测
- `tests/e2e/search-engine.spec.ts` — Search engine E2E
- `tests/e2e/zoom.spec.ts` — Zoom E2E

**主 design doc §15 同步**（plan 最后一步）：
- `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` §15 表追加 Ctrl+0 行

---

## 13. 完成定义

- 单测 + E2E 全绿（CI Windows runner）
- `pnpm dev` 手测：地址栏输入触发 Google；设置抽屉切到 Bing 后再输入触发 Bing；添加并切到一个自定义引擎，地址栏输入触发自定义 URL；网页内 Ctrl+滚轮看到内容缩放；Ctrl+0 复位 100%；切 tab 后 zoom 各自独立
- 老 config.json 启动一次（手测）→ search section 自动落盘 + active = google
