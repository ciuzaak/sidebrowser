# M7：托盘图标 + 关闭行为 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-24
**前置：** `m6-settings-persistence` tag、`main` clean。

**Goal:** 系统托盘图标上线；窗口关闭行为按 `settings.lifecycle.closeAction` 分支（`'quit'` 真退出、`'minimize-to-tray'` 隐到托盘）；托盘左键唤回、右键菜单 Show / Quit；托盘 icon 平台资源就位；M6 SettingsDrawer 里 `closeAction` 选项的 `(M7)` 注释清掉。

**Architecture:**
- `src/main/close-action-resolver.ts` 纯函数 `resolveCloseAction({ closeAction, isQuitting }) → 'hide' | 'destroy'`：close 事件发生时 main 读当前 settings + quit flag，返回处理决策。纯函数 = 决策矩阵 100% 单测覆盖。
- `src/main/tray-manager.ts` 类：wrap `electron.Tray` + `Menu`；DI `TrayBackend` 接口（`setImage / setToolTip / setContextMenu / on('click', cb) / destroy`）让单测无需 Electron。暴露 `showWindow() / requestQuit()` 两个绑定到菜单项/左键的命令，具体 win/app 调用由 bootstrap 注入。
- `resources/tray/` 新目录放 tray icon：`tray-16.png`、`tray-24.png`、`tray-32.png`（Windows 通常自动选尺寸；ICO 不强制，Electron `Tray` 能吃 PNG）。在 `electron-builder.yml` 的 `extraResources` 也要加上。
- `src/main/index.ts`：
  - 新增模块级 `isQuitting = false` flag，`app.on('before-quit', () => { isQuitting = true; ... })`。
  - `win.on('close', (e) => { ... })` 用 `resolveCloseAction` 分支：`'hide'` 则 `e.preventDefault()` + `win.hide()`；`'destroy'` 什么都不做（默认关闭流程继续）。
  - `new TrayManager({...})`，左键 / `'Show'` 菜单 → `win.show() + win.focus()`；`'Quit'` 菜单 → `app.quit()`。
  - TrayManager 在 `app.on('before-quit')` 里调 `tray.destroy()` 避免 icon 悬挂。
  - `window-all-closed` 处理：Windows 下 `'minimize-to-tray'` 时窗口只是 `.hide()` 而非关闭，此事件不会触发——正确；`'quit'` 分支时走默认 `app.quit()` 路径。
- `src/renderer/src/components/SettingsDrawer.tsx`：Lifecycle section 的 `closeAction` `<option>` 文案里去掉 `(M7)` 标注；无其它 renderer 改动。
- E2E：新增一个 spec 用测试钩 `requestWindowClose()` / `getIsWindowVisible()` 验证两条分支行为；托盘 icon 本身不在 DOM 层可测（Windows 原生），留手动冒烟。

**Tech stack delta vs M6:** 无新依赖。Electron 原生 `Tray` + `Menu`。

**Spec references:** §2 表（关闭按钮默认行为）、§4.1（TrayManager 归属）、§5（无）、§7（lifecycle.closeAction schema）、§10（无）、§13 M7 目标、§16（平台代码隔离——macOS 路径留扩展）、§17（v1 Windows-only）。

**M7 特定 guardrails：**
- **`isQuitting` flag 必要性**：tray 菜单 Quit → `app.quit()` → `before-quit` 事件触发 → 设 `isQuitting=true` → 后续各 window 的 `close` 事件 `resolveCloseAction` 看到 flag 直接 return `'destroy'`，避免被 minimize-to-tray 截死循环。
- **closeAction 每次 close 现读 settings**：不 cache 到 handler 闭包里；用 `settingsStore.get().lifecycle.closeAction` 直接读。与 M6 live-apply 矩阵一致（该字段标注 "❌ 不 live"——指的是既有 close handler 不会被重新注册，但每次 close 时读的值是 store 当前值；这不是 live-apply 场景，而是 "读时拉取"）。
- **Tray icon 资源路径**：dev `${projectRoot}/resources/tray/tray-32.png`；packaged `${process.resourcesPath}/tray/tray-32.png`。`app.isPackaged` 分支选路径，或统一用 `join(__dirname, '../../resources/tray/...')` + `electron-builder.yml` 的 `extraResources` 保障打包时资源被复制。实现者选一种并注释说明。
- **图标大小选择**：给 Electron `new Tray(nativeImage.createFromPath(...))` 传 32px；Windows 托盘会自适配缩放。如果 32 在高 DPI 下糊，可用 `nativeImage` 的 `addRepresentation` 附 16/24/32 三套。v1 先传 32 够用。
- **托盘图标资源暂用占位**：v1 可以先用一张纯色 PNG（应用主题色 + 圆角方块 + 中心 S 字母）作为 placeholder；m8 打磨阶段再换正式 icon。plan 不禁止 AI 生成占位，但实现者应在 commit message 里明确是 placeholder。
- **macOS 兼容留口不实装**：spec §17 已确认 v1 仅 Windows；但 `tray-manager.ts` / close handler 不应写 `process.platform === 'win32'` 之外的硬编码 assumption——让 macOS 日后接入时只改 platform-specific 分支。托盘在 macOS 的语义不同（menubar 常驻、`app.dock` 概念），本 plan 不处理。
- **`win.hide()` 后的 cursor-watcher**：窗口隐藏期间 `win.isVisible()===false` 但 `win.getBounds()` 仍返有效矩形。现有 CursorWatcher 用 `win.isDestroyed()` 守卫，并不 check `isVisible()`；隐藏后 cursor-watcher 还会跑并拿 bounds——但 cursor 不在 bounds 内就不触发 leave，没有实际副作用。不动 CursorWatcher。
- **EdgeDock 状态**：`win.hide()` 不改 EdgeDock 状态机（它跟踪的是 "窗口是否贴边 + 是否被 hide 动画移出屏"）。`win.hide()` 走的是 Electron 级别 window visibility，不是我们的 hide 动画——两者语义正交。EdgeDock `DOCKED_*` 状态在 `win.show()` 恢复后还在。本 plan 不动 EdgeDock；仅验证 E2E 里 minimize→show 往返后 EdgeDock 行为不坏。
- **托盘菜单字符**：v1 英文 `Show`、`Quit`。i18n 推到 v2。
- **ipc-contract.ts 无改动**：M7 不引新 IPC 通道（托盘是 main-only 交互）。
- **无新依赖**。

**M7 Definition of Done:**
- 安装后关窗口（X）且 `closeAction='minimize-to-tray'` → 窗口 `isVisible()===false`，app 进程未退出，托盘 icon 可见。
- 托盘左键或右键菜单 Show → 窗口恢复可见 + focus；M6 tabs / UA / EdgeDock / dim / settings drawer 均正常。
- 托盘菜单 Quit → app.quit() → 进程干净退出，不被 minimize-to-tray 阻挡。
- `closeAction='quit'` 时 X 按钮直接退出（行为 === M6 现状）。
- `minimize-to-tray` 隐藏期间拖鼠标在原窗口坐标外 → 不 leak cursor event、不崩。
- 重启 → 设置保留（M6 已覆盖，此处仅回归）。
- 单测：`close-action-resolver`（≥4 case 覆盖决策矩阵）+ `tray-manager`（≥6 case，DI fake backend 覆盖菜单构造 + 左键 + Show/Quit 菜单项 + destroy）。
- E2E：1 个新 spec，≥2 case（两条 closeAction 分支行为）。
- M6 及以前全部 E2E 不倒退。
- spec §13 M7 状态从 "待实现" → M7 ship；spec §4.1 / §2 表 文案若需微调一并同步。
- `pnpm typecheck / lint / test / test:e2e / build` 全绿。
- `m7-tray-close-action` tag。

**What this plan does NOT build（推后）：**
- Tray 通知气泡 / balloon messages（用户提示"仍在运行"）。v2 nice-to-have。
- 托盘 icon 动态改变（e.g. 有未读）。未定义需求，推。
- macOS 托盘 / menubar 实装（v2 平台扩展）。
- Tray 菜单 "New Tab" / 其它快捷项（YAGNI，v1 只要 Show/Quit）。
- 按 M6 抽屉配置的主题切换 tray icon（主题未实装）。
- Tray icon 正式设计稿（m8 打磨或外包）；v1 用占位图标。
- 托盘图标的 E2E 断言（Windows 原生 API 不在 Playwright 触达面内）。

---

## Task 1: Tray icon placeholder 资源

**Files:** 新增 `resources/tray/tray-16.png`、`tray-24.png`、`tray-32.png`；修改 `electron-builder.yml`。

### 资源产出

三张正方形 PNG，主色 sidebrowser theme（建议 `#0ea5e9` sky-500 或类似）+ 白色 `S` 字母或圆角方块。实现者可以用任何方式生成——以下三种都可接受：

1. **最简**：用 `node` + `canvas`/`sharp`/`pngjs` 脚本跑一次生成三张纯色 + 文字 PNG；脚本文件可保留在 `scripts/` 下或一次性跑完删掉。
2. **外部工具**：实现者本地用 Figma / Photoshop / online SVG→PNG 工具手搓。只要结果 commit 进 `resources/tray/` 即可。
3. **纯色占位**：哪怕是 16×16、24×24、32×32 三张纯蓝 PNG 也行——spec §13 M7 定义的是"托盘 icon 上线"功能，不是设计稿。m8 打磨时换正式图标。

commit message 明确这是 placeholder（比如 `chore(resources): add M7 placeholder tray icons (16/24/32)`）。

### electron-builder.yml 扩展

查看当前 `electron-builder.yml`。添加：

```yaml
extraResources:
  - from: resources/tray
    to: tray
    filter:
      - "**/*"
```

（若已有 `extraResources` 则 append；若已有 `files` 字段把 `resources/**` 打包进主 bundle 则可能不需要，先读当前配置再决定。）

目标：packaged app 在 `process.resourcesPath/tray/tray-32.png` 能读到。

### 单测

无。

**Commit message（建议）：** `chore(resources): add M7 placeholder tray icons + electron-builder extraResources`

---

## Task 2: close-action-resolver 纯函数

**Files:** 新增 `src/main/close-action-resolver.ts`、`tests/unit/close-action-resolver.test.ts`。

### API

```ts
export type CloseAction = 'hide' | 'destroy';

export interface ResolveCloseActionInput {
  /** settings.lifecycle.closeAction: 用户配置意图 */
  closeAction: 'quit' | 'minimize-to-tray';
  /** true if tray menu Quit or app.quit() has been initiated */
  isQuitting: boolean;
}

/**
 * Decide how to handle a BrowserWindow close event.
 * - 'hide'    → caller does e.preventDefault() + win.hide()
 * - 'destroy' → caller lets the default close proceed
 */
export function resolveCloseAction(input: ResolveCloseActionInput): CloseAction;
```

### 决策矩阵

| `closeAction` | `isQuitting` | 结果 | 备注 |
|---|---|---|---|
| `'minimize-to-tray'` | `false` | `'hide'` | 正常 X 按钮路径 |
| `'minimize-to-tray'` | `true` | `'destroy'` | 托盘 Quit 或 app.quit() 发起；绕过 hide |
| `'quit'` | `false` | `'destroy'` | 显式配置退出 |
| `'quit'` | `true` | `'destroy'` | 幂等 |

### 单测（≥4 case）

覆盖以上 4 行矩阵。每条断言一条就够；不需要 describe 嵌套。

**Commit message：** `feat(main): add close-action-resolver pure function`

---

## Task 3: TrayManager + DI backend

**Files:** 新增 `src/main/tray-manager.ts`、`tests/unit/tray-manager.test.ts`。

### API

```ts
export interface TrayBackend {
  setImage(imagePath: string): void;
  setToolTip(tip: string): void;
  setContextMenu(template: TrayMenuTemplate): void;
  onClick(cb: () => void): void;
  destroy(): void;
}

export interface TrayMenuTemplate {
  items: { label: string; onClick: () => void }[];
}

export interface TrayManagerDeps {
  backend: TrayBackend;
  iconPath: string;      // 生产：process.resourcesPath/tray/tray-32.png；dev：project resources/tray/tray-32.png
  toolTip?: string;      // 默认 'sidebrowser'
  onShow: () => void;    // 左键 + 'Show' 菜单 → bootstrap 提供 (win.show + focus)
  onQuit: () => void;    // 'Quit' 菜单 → bootstrap 提供 (app.quit)
}

export class TrayManager {
  constructor(deps: TrayManagerDeps) { /* setImage, setToolTip, setContextMenu, onClick */ }
  destroy(): void { /* delegate to backend.destroy() */ }
}
```

### 生产 backend 工厂

在同文件（或 inline 在 bootstrap）加 `createElectronTrayBackend(): TrayBackend`，wrap `new Tray(nativeImage.createFromPath(...))` 和 `Menu.buildFromTemplate(...)`。Lazy-require 模式可选，但 Tray 必须在 `app.whenReady()` 之后用，所以 bootstrap 里直接 `import { Tray, Menu, nativeImage } from 'electron'` 也行（不会破坏 Vitest——该模块不在 test path 上）。

### 单测（≥6 case，DI fake backend）

1. 构造：backend.setImage 被调、参数等于 `iconPath`；setToolTip 被调，默认 `'sidebrowser'` 或自定义。
2. 构造：backend.setContextMenu 被调，template 包含恰好 2 项、label 为 `'Show'` 和 `'Quit'`。
3. 左键（backend.onClick 回调触发） → `deps.onShow` 被调。
4. 菜单 Show 项点击 → `deps.onShow` 被调。
5. 菜单 Quit 项点击 → `deps.onQuit` 被调。
6. `trayManager.destroy()` → `backend.destroy()` 被调。
7. （可选）自定义 toolTip 生效。

**Commit message：** `feat(main): add TrayManager with Show/Quit menu + DI backend`

---

## Task 4: Bootstrap 集成

**Files:** Modify `src/main/index.ts`。

### 变更点

1. **Module-level `isQuitting` flag**：
```ts
let isQuitting = false;
```
声明在 `app.whenReady()` 外部（bootstrap 模块顶端附近）。

2. **`app.on('before-quit')` 设 flag**（现有 handler 只 flush save，扩它）：
```ts
app.on('before-quit', () => {
  isQuitting = true;
  boundsPersister.flush();
  saver.flush();
});
```

3. **`win.on('close')` 新增 handler**：
```ts
win.on('close', (e) => {
  const action = resolveCloseAction({
    closeAction: settingsStore.get().lifecycle.closeAction,
    isQuitting,
  });
  if (action === 'hide') {
    e.preventDefault();
    win.hide();
  }
  // 'destroy' → 默认关闭流程继续
});
```

4. **TrayManager 实例化**（在 `app.whenReady()` body 末尾附近，在 before-quit handler 之前）：
```ts
const tray = new TrayManager({
  backend: createElectronTrayBackend(),
  iconPath: resolveTrayIconPath(),
  onShow: () => { win.show(); win.focus(); },
  onQuit: () => app.quit(),
});
```
`resolveTrayIconPath()` 分支：`app.isPackaged ? join(process.resourcesPath, 'tray', 'tray-32.png') : join(__dirname, '../../resources/tray/tray-32.png')`。实现者决定 inline 还是抽 helper。

5. **Tray 清理**（在 before-quit handler 扩展）：
```ts
app.on('before-quit', () => {
  isQuitting = true;
  tray.destroy();
  boundsPersister.flush();
  saver.flush();
});
```

6. **E2E 测试钩扩展**（`__sidebrowserTestHooks`）：
```ts
requestWindowClose: () => win.close(),
getIsWindowVisible: () => !win.isDestroyed() && win.isVisible(),
setCloseAction: (v: 'quit' | 'minimize-to-tray') =>
  settingsStore.update({ lifecycle: { closeAction: v } }),
```

注意 `win.close()` 会走 `close` 事件；测试可观察 `isVisible()` 在 `minimize-to-tray` 下变 false 但进程存活。

### 单测

无（bootstrap 是 integration 层；E2E 在 Task 6 覆盖）。

### 验证

`pnpm typecheck` + `pnpm lint` + `pnpm test`（应仍 >=174/174）+ `unset ELECTRON_RUN_AS_NODE && pnpm build` 全绿。

**Commit message：** `feat(main): wire TrayManager + close-action branch into bootstrap`

---

## Task 5: Renderer polish — 清掉 `(M7)` 注释

**Files:** Modify `src/renderer/src/components/SettingsDrawer.tsx`。

### 变更

SettingsDrawer 的 Lifecycle section 里 `closeAction` `<select>` 的两个 `<option>` 文本里 `(M7)` 标注去掉（或 M6 某处注释里提到"M7 前恒为 quit"的段落微调）。

实现者 grep `M7` 在 `src/renderer/src/components/SettingsDrawer.tsx` 找到现有位置（M6 Task 10 实现者在该行明确打了标）。

无新功能、无测试。

**Commit message：** `chore(renderer): drop (M7) annotation from closeAction options now that M7 ships`

---

## Task 6: E2E spec

**Files:** 新增 `tests/e2e/tray-close-action.spec.ts`。

### Test cases（≥2）

1. **closeAction='minimize-to-tray' 走 hide 分支**：
   - 启动 app（fresh `--user-data-dir`，`SIDEBROWSER_E2E=1`）。
   - `app.evaluate` 调 `__sidebrowserTestHooks.setCloseAction('minimize-to-tray')`。
   - `requestWindowClose()`。
   - 轮询 `getIsWindowVisible()` 变为 `false`。
   - 进程仍活（`app.evaluate(() => 1)` 不抛）。
   - 清理：`app.close()`。

2. **closeAction='quit' 走 destroy 分支**：
   - 启动 app。
   - `setCloseAction('quit')`。
   - `requestWindowClose()`。
   - 进程应终止：轮询 `app.evaluate(...)` 抛 / `app.windows()` 变空 / 用 `app.process().exitCode !== null`（Playwright Electron API）。
   - 无需 `app.close()`（已退）。

3. **（可选）tray icon 非空路径**：`app.evaluate` 返回 `typeof (globalThis as any).__sidebrowserTestHooks.getTrayIconPath === 'function' && (...).getTrayIconPath()`。需要 Task 4 加一个 `getTrayIconPath` 钩。纯字符串长度 > 0 即可——不是视觉断言，只是证明 `resolveTrayIconPath()` 选对了路径。

### 实现细节

- 复用 `tests/e2e/helpers.ts` 的 `getChromeWindow` + `waitForAddressBarReady`。
- 在 `try { ... } finally { try { await app.close(); } catch {} }` 中清理——第二个 case 可能 app 已退，`app.close()` 会抛，吞掉即可。
- 每 case 独立 `mkdtempSync` userData 目录。

### 验证

`unset ELECTRON_RUN_AS_NODE && pnpm test:e2e tests/e2e/tray-close-action.spec.ts` → 全绿。

**Commit message：** `test(e2e): add tray-close-action spec covering both closeAction branches`

---

## Task 7: 全量验收 + spec 同步 + tag

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test` — 新增 2 个单测文件（close-action-resolver + tray-manager）+ 若干 case。
- [ ] `unset ELECTRON_RUN_AS_NODE && pnpm build`
- [ ] `unset ELECTRON_RUN_AS_NODE && pnpm test:e2e` — 新增 1 个 spec（应全过；multi-tab 偶发 flake 不计）。
- [ ] **spec 同步：**
  - §4.1：`TrayManager` 归属描述已在，确认 M7 落地后描述仍准确（应已准确）。
  - §13 M7 行的"验证"栏：M6 文案 "手动 + E2E"；补一句 E2E 覆盖的具体是"close action 分支"，托盘 icon 本身留手动。
  - §8 数据流若无合适位置就不加新子节——托盘交互简单，不值得一个新 data-flow 示例。
  - `docs/superpowers/plans/2026-04-24-M7-tray-close-action.md`（本文档）自身无需同步（plan 是历史记录）。
- [ ] **手动冒烟（用户负责）**：
  - 启动 → 托盘区出现 icon、左键窗口隐藏后能唤回。
  - X 按钮：closeAction='minimize-to-tray' → 隐；closeAction='quit' → 退。
  - 托盘右键 → Show / Quit 菜单可见；Show 唤回、Quit 退出。
  - minimize-to-tray 隐藏数秒后 Show → M5 贴边状态、M4 dim、M2 tabs 都正常。
  - Settings 抽屉里 closeAction 选项的 "(M7)" 标注已消失。
- [ ] `git tag -a m7-tray-close-action -m "M7: system tray + close-action branch (quit vs minimize-to-tray)"`（**user 冒烟确认后才执行**）

---

## Transfer to M8

M8 打磨 + 打包：

- `electron-builder` 正式产出 NSIS 安装包（v1 Windows-only）。
- 正式 tray icon 替换 placeholder。
- `display-metrics-changed` / `display-removed` 边界收尾（M5 已基本覆盖，M8 做压力场景）。
- 错误边界：`loadURL` 网络失败 Chromium 默认错误页（spec §10 已拍板），验收其它异常。
- README：功能清单、快捷键、已知限制（反移动端检测、托盘在 macOS 不支持 v1）。
- 可选：CI 打包 artifact（GitHub Actions Windows runner）。
