# M8：加固 + 打包 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`。Steps 用 checkbox 跟踪。

**Date:** 2026-04-24
**前置：** `m7-tray-close-action` tag、`main` clean。

**Goal:** v1 收尾。Windows NSIS 安装包可装可跑、键盘快捷键齐 spec §15、错误边界全过 spec §10、README 写到外人能装能用、`m8-v1-release` tag 落地。

**Architecture:**
- `electron-builder.yml`：M7 只放了 appId/productName/extraResources 占位骨架。M8 补全 `directories.output / files / asarUnpack / win.target=nsis / win.icon / nsis.{oneClick,perMachine,allowToChangeInstallationDirectory,...}`。`pnpm build` 后跑 `pnpm dlx electron-builder --win` 产出 `release/sidebrowser-Setup-1.0.0.exe`。
- `resources/icon.ico`：Windows app icon（multi-size .ico，含 16/24/32/48/64/128/256）。tray PNG (M7 placeholder) 顺带换一版精修，**仍接受 placeholder 质量** —— 真正的设计稿排到 v1.1（YAGNI）。app icon 必须有合法 .ico 否则 NSIS 打不出。
- `src/main/keyboard-shortcuts.ts`（新）：导出 `installApplicationMenu(deps)` —— 用 `Menu.setApplicationMenu(Menu.buildFromTemplate(...))` 注册一份隐藏 menu（`visible: false` 但 accelerator 仍生效），覆盖 spec §15 的 8 条。需要触达 renderer 的（`Ctrl+L` 聚焦地址栏 / `Ctrl+Tab` tab 抽屉 / `Ctrl+,` 设置抽屉）走新 IPC `chrome:shortcut` (M→R event)，载荷 `{ action: 'focus-address-bar' | 'toggle-tab-drawer' | 'toggle-settings-drawer' }`。renderer 在 App.tsx 订阅一次。
- `src/main/settings-store.ts`：`SettingsStore` 构造里 `try { backend.get() } catch` —— electron-store 解析 JSON 失败时抛，捕获 → 写一条 `console.error` → 返回 defaults。同样地 `tab-persistence.ts` 已有的 `loadPersistedTabs` 也加 try/catch（如果还没有；实现者读时确认）。**不引 Zod**，spec §7 已拍板。
- `src/main/view-manager.ts`：spec §10 "持久化的 URL 非法 → 回退 about:blank" —— 在 `seedTabs` 路径 / `createTab(url)` 入口加一层 `isValidUrl(url)` 守卫（`about:` / `http:` / `https:` / `file:` 白名单），非法 → `'about:blank'`。同上"所有 tab 关光 → 自动新建 blank tab"——确认 M2 ViewManager 已实现；缺则补。
- E2E 新增 `tests/e2e/display-stress.spec.ts`：HIDDEN_LEFT/RIGHT 状态下 `emitDisplayChanged` 模拟显示器断开 → 断言 SNAP_TO_CENTER 后 EdgeDock 状态回 DOCKED_NONE、窗口可见、bounds 在主屏 workArea 内。M5 已覆盖大头，本 spec 是压力补一刀。
- README：从当前 44 行扩到 spec §17 交付物水平 —— 功能清单、`pnpm dev` / `pnpm build:installer` 命令、键盘快捷键表（直接抄 spec §15）、已知限制（反移动端检测 / macOS 不支持 / tray icon 是 placeholder）。

**Tech stack delta vs M7:** 无新运行时依赖。`electron-builder` 已是 devDep（26.8.1）。可能需要 `pnpm dlx electron-builder` 跑打包一次（不引为 script，但 `package.json` 加 `"build:installer": "electron-builder --win"` 脚本）。

**Spec references:** §10（错误边界全表）、§13 M8、§15（键盘快捷键全表）、§17（交付物清单）、§11（YAGNI 边界——别越界）。

**M8 特定 guardrails：**
- **快捷键走 hidden Application Menu，不用 `globalShortcut`**：spec §15 拍板"v1 不注册全局快捷键"。`Menu.setApplicationMenu` + `accelerator` 字符串是 Electron 的标准做法；菜单 `visible: false` 让 Windows 不显示 menubar。
- **`Ctrl+W` 语义**：关闭当前活跃 tab。如果只剩一个 tab 被关，ViewManager 会触发 spec §10 "所有 tab 关光 → 自动新建 blank tab" 路径 —— 不是关窗口（关窗口是 X 按钮，归 M7）。
- **`Ctrl+L` IPC 路径**：main → renderer (`chrome:shortcut` event with `'focus-address-bar'`) → renderer 的 App.tsx / TopBar 收到后调 `addressBarRef.current?.focus() + .select()`。renderer 已用 `data-testid="address-bar"` 暴露 input，加个 `useRef` 即可。
- **`Ctrl+,` 切换设置抽屉**：现有 SettingsDrawer 由 App.tsx 的 `settingsOpen` state 控；快捷键事件直接 toggle 该 state。同理 `Ctrl+Tab` 切 TabDrawer 的 open。
- **NSIS oneClick 模式选择**：`oneClick: false` + `allowToChangeInstallationDirectory: true` —— 给用户选目录的余地，更标准的桌面应用体验。`perMachine: false`（不需要管理员权限装到 Program Files）。
- **app icon .ico 占位也 OK**：Windows .ico 可以从 PNG 用 ImageMagick / online 工具 / 一段 Node 脚本（同 M7 placeholder 风格，纯 zlib + ICO 头手卷）转。**实现者建议**：抄 M7 `scripts/generate-tray-icons.mjs` 的零依赖路子，加一个 `scripts/generate-app-icon.mjs` 把 256×256 PNG 包成 `.ico`。或者就接受用一张 256×256 PNG → 用 `png-to-ico` devDep（10KB 纯 JS）—— 实现者选一种，commit message 注明。
- **electron-builder 打包验证不在 CI 自动化**：M8 验证 `electron-builder --win` 在本地一次跑过，产出 `.exe` 文件且体积合理（≤200MB Electron + 业务）。**用户负责**装一遍验装可用。
- **设置/tab-persistence 损坏恢复**：try/catch + console.error + 返回 defaults。**不删坏文件**——保留供 debug。下次正常 update() 自然覆盖。
- **`isValidUrl` 白名单要够松**：允许 `about:`、`http:`、`https:`、`file:`；禁止 `javascript:` / `data:` / `chrome:` 这些不该出现在持久化里的。M2 实现者大概率没做白名单；M8 补。
- **键盘快捷键的 E2E**：可选 1-2 个最关键的 case（`Ctrl+T` 新 tab、`Ctrl+,` 切抽屉），其它靠 spec §15 表 + 单测 menu template 构造。Playwright Electron 可用 `page.keyboard.press('Control+T')`。
- **README 别复制 spec**：放摘要 + 链接到 spec。spec 是真理，README 是入口。
- **版本 bump**：`package.json` `0.0.1` → `1.0.0`。语义化版本：v1 首发。
- **不动**：M0–M7 已实现的核心子系统（EdgeDock / DimController / ViewManager 主体 / SettingsStore 主体 / TrayManager / EdgeDock reducer）。M8 只在缝隙打 patch。

**M8 Definition of Done:**
- `pnpm build:installer`（新增 script）→ `release/sidebrowser-Setup-1.0.0.exe` 产出，体积 < 250MB。
- 装到全新 Windows 用户目录可启、可建 tab、托盘可见、关窗口走 minimize-to-tray、卸载干净（NSIS 标准卸载流程）。
- spec §15 全 8 条快捷键在 dev (`pnpm dev`) 下全部生效，行为对应。
- 故意把 `<userData>/config.json` 写一段非法 JSON → 启动不崩，日志一行 error，settings 全是 defaults。
- 故意把 `<userData>/sidebrowser-tabs.json`（或同等 tab persistence 文件）改成一个 URL = `'javascript:alert(1)'` → 启动该 tab 落到 `about:blank`，不执行任意代码。
- HIDDEN_LEFT 状态下 `__sidebrowserTestHooks.emitDisplayChanged` 模拟主屏断开 → SNAP_TO_CENTER → 窗口在主屏中心、可见、EdgeDock 状态 DOCKED_NONE。
- README 含安装、用法、快捷键表、3 条已知限制。
- `pnpm typecheck / lint / test / build / test:e2e` 全绿。tests 数量增长正常（菜单单测 + display-stress E2E）。
- `m8-v1-release` tag。
- `package.json` version `1.0.0`。

**What this plan does NOT build（推后到 v1.1+）：**
- 正式设计稿 tray / app icon（v1 接受 placeholder）。
- macOS 支持（spec §17 已拍板 v1 Windows-only）。
- GitHub Actions CI / Mac runner。spec §12 提到但没拍板必须 v1 上。先本地打、本地测，CI 推到 v1.1。
- 自动更新 (electron-updater)。
- 代码签名（需要购买证书；用户后续自理）。
- Crash reporter / 远端日志收集。
- i18n（tray + menu 仍英文）。
- 内置错误页 / 自定义 chromium error UI（spec §10 拍板用默认）。
- 组合滤镜（spec §11 已列）。
- Ctrl+F 页面内搜索（spec §11 已列）。
- Tab 拖拽重排 / 钉住 / 静音 等浏览器常规但未拍板的功能。

---

## Task 1: App icon (.ico) + tray icon polish

**Files:** 新增 `resources/icon.ico`（256×256 multi-size）；可选优化 `resources/tray/tray-{16,24,32}.png`；可能新增 `scripts/generate-app-icon.mjs` 或 add devDep `png-to-ico`。

### 资源选择

实现者选一种产出 `.ico`：

(a) **零依赖路子**：写 `scripts/generate-app-icon.mjs`，参考 M7 `generate-tray-icons.mjs` 的 PNG 编码思路，加 ICO header 包装一张 256×256 PNG（ICO 格式可以 embed PNG 而非 BMP）。最简、可复现。
(b) **加 devDep `png-to-ico`**：纯 JS、零原生依赖，~10KB。生成一张 256 PNG → 跑工具 → `.ico`。
(c) **手工外部工具**：online ICO generator、Figma export、ImageMagick `convert`。结果 commit 进 `resources/icon.ico`。

任意可。tray PNG 可顺带升级（更清晰的 S 字母 / 加圆角）也可以保留 M7 版本。**commit message 必须注明 placeholder**。

### Verification

`file resources/icon.ico` 应识别为 ICO；最低含 256×256 一档。

**Commit message：** `chore(resources): add Windows app .ico (placeholder) for M8 packaging`

---

## Task 2: electron-builder 完整 NSIS 配置 + build:installer 脚本

**Files:** Modify `electron-builder.yml`、`package.json`。

### electron-builder.yml 扩展

在 M7 已有的 appId / productName / extraResources 基础上加：

```yaml
directories:
  output: release
  buildResources: resources

files:
  - "out/**/*"
  - "package.json"

asarUnpack:
  - "resources/**"

win:
  target:
    - target: nsis
      arch: x64
  icon: resources/icon.ico
  publisherName: sidebrowser

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  allowElevation: false
  deleteAppDataOnUninstall: false
  artifactName: "${productName}-Setup-${version}.exe"
```

`deleteAppDataOnUninstall: false` —— 卸载留 cookies / settings，用户重装能继续；卸载强删要走"clean uninstall"开关，v1 不做。

### package.json scripts

加：
```json
"build:installer": "node scripts/run.mjs electron-builder --win"
```

`scripts/run.mjs` 已经处理 ELECTRON_RUN_AS_NODE 剥离，沿用。

### 验证

```
unset ELECTRON_RUN_AS_NODE && pnpm build && pnpm build:installer
ls release/
```

应见 `sidebrowser-Setup-1.0.0.exe`（version 待 Task 7 bump 后才是 1.0.0；当前 0.0.1 也行，验证流程通了即可）。**实现者无需在装机环境验装**——那是 Task 7 的用户冒烟项。但要确认 exe 文件生成且体积合理。

**Commit message：** `chore(build): wire electron-builder NSIS config + build:installer script`

---

## Task 3: 键盘快捷键 (spec §15)

**Files:** 新增 `src/main/keyboard-shortcuts.ts`、`tests/unit/keyboard-shortcuts.test.ts`；修改 `src/main/index.ts`、`src/shared/ipc-contract.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`（或 TopBar.tsx）。

### 设计

`src/main/keyboard-shortcuts.ts` 导出：
```ts
export interface ShortcutDeps {
  onNewTab: () => void;          // Ctrl+T
  onCloseActiveTab: () => void;  // Ctrl+W
  onReloadActive: () => void;    // Ctrl+R / F5
  onGoBack: () => void;          // Alt+Left
  onGoForward: () => void;       // Alt+Right
  onToggleDevTools: () => void;  // F12
  emitToRenderer: (action: 'focus-address-bar' | 'toggle-tab-drawer' | 'toggle-settings-drawer') => void;
}

export function buildShortcutMenuTemplate(deps: ShortcutDeps): MenuTemplateLike;
export function installApplicationMenu(deps: ShortcutDeps): void;
```

- `buildShortcutMenuTemplate` 是纯函数，单测覆盖（≥4 case：每个 click 调对应 deps、accelerator 字符串正确、structure 含 8 条目）。
- `installApplicationMenu` 包一层 `Menu.setApplicationMenu(Menu.buildFromTemplate(template))`，runtime 调用，单测不覆盖。

### IPC 新增

`src/shared/ipc-contract.ts`：
```ts
chromeShortcut: 'chrome:shortcut'
```
M→R event，载荷 `{ action: 'focus-address-bar' | 'toggle-tab-drawer' | 'toggle-settings-drawer' }`。

`src/preload/index.ts`：暴露 `onShortcut(cb)` 订阅 + 卸载。

### Bootstrap (`src/main/index.ts`)

`app.whenReady` body 内 ViewManager 实例化后加：
```ts
installApplicationMenu({
  onNewTab: () => viewManager.createTab('about:blank'),
  onCloseActiveTab: () => viewManager.closeActiveTab(),
  onReloadActive: () => viewManager.reloadActive(),
  onGoBack: () => viewManager.goBackActive(),
  onGoForward: () => viewManager.goForwardActive(),
  onToggleDevTools: () => viewManager.toggleDevToolsActive(),
  emitToRenderer: (action) => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.chromeShortcut, { action });
  },
});
```

实现者**先读 ViewManager** 看哪些方法已存在；缺的（如 `closeActiveTab` / `reloadActive` / `goBackActive` / `goForwardActive` / `toggleDevToolsActive`）按现有命名习惯补，逻辑应只是"找 active webContents → 调对应方法"，每个 1–3 行。

### Renderer (`src/renderer/src/App.tsx`)

`useEffect` 订阅 `window.sidebrowser.onShortcut(action => switch (action) ...)`：
- `'focus-address-bar'` → `addressBarRef.current?.focus(); .select();`（addressBarRef 通过 forwardRef 从 TopBar 传出，或用 `document.querySelector('[data-testid="address-bar"]')` 简化）
- `'toggle-tab-drawer'` → `setTabDrawerOpen(o => !o)`
- `'toggle-settings-drawer'` → `setSettingsOpen(o => !o)`

### 单测

`tests/unit/keyboard-shortcuts.test.ts`：≥4 case，DI fake deps 覆盖菜单 click 路由 + accelerator 字符串。

### E2E（可选，建议加 1 case）

在 `tests/e2e/keyboard-shortcuts.spec.ts` 加 1 个 case：`Ctrl+,` 打开/关闭设置抽屉，断言 `getByTestId('settings-drawer')` 可见性切换。其它 7 条不强求 E2E（菜单单测 + 手动冒烟）。

### 验证

`pnpm typecheck / lint / test`；新菜单单测应过；renderer 类型对齐 IPC 契约。

**Commit message：** `feat(main): wire spec §15 keyboard shortcuts via hidden application menu`

---

## Task 4: Error-boundary 加固

**Files:** Modify `src/main/settings-store.ts`、`src/main/tab-persistence.ts`、`src/main/view-manager.ts`；新增 `tests/unit/url-validator.test.ts`（如新写 `isValidUrl`）。

### 4a. 设置文件损坏 → defaults

`SettingsStore.get()` 或构造期间，try/catch backend.get → 失败时 `console.error('[settings] corrupt; falling back to defaults', err)` → 返回 `mergeDefaults({})`。**不删坏文件**——下次 `update()` 自然覆盖。

实现者需先读 `settings-store.ts` 看现有 backend 调用点，决定 try/catch 包在 SettingsStore 还是 createElectronBackend。倾向后者（边界处理在边界层，store 内部不污染）。

### 4b. tab-persistence 损坏

同上路径，`loadPersistedTabs` 加 try/catch → 返回 `null`（已是合法返回，bootstrap 会建 blank tab）。

### 4c. URL 白名单

新增小工具 `src/main/url-validator.ts`：
```ts
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'file:', 'about:'].includes(u.protocol)) return url;
  } catch { /* fall through */ }
  return 'about:blank';
}
```

ViewManager 的 `createTab(url)` 入口、`navigate(id, url)` 入口、`seedTabs` 复原路径都过一遍 `sanitizeUrl`。spec §10 要求"持久化的 URL 非法 → about:blank"。

### 4d. 所有 tab 关光自动建 blank

ViewManager 的 closeTab 实现里若 closeTab 后 tabs.length === 0 → 自动 `createTab('about:blank')`。**先读现有代码确认是否已有**——M2 实现者可能做了。已有就跳过本子项；commit message 注明。

### 单测

`tests/unit/url-validator.test.ts`：≥4 case（http、https、about:blank、javascript: → blank、malformed → blank）。
ViewManager 的相关补丁可以加 1–2 个针对性单测，看实现者判断。
SettingsStore 损坏路径单测可加（fake backend.get throws → store.get returns defaults）。

### 验证

`pnpm typecheck / lint / test`；手动制造一份坏 config.json 跑 dev 确认日志 + 启动正常（实现者可在 task 内本地试一次，非自动化要求）。

**Commit message：** `feat(main): error-boundary hardening — settings/tab-persistence corrupt fallback + URL whitelist`

---

## Task 5: Display-stress E2E

**Files:** 新增 `tests/e2e/display-stress.spec.ts`。

### Test cases (1–2)

1. **HIDDEN_LEFT 状态下显示器断开 → SNAP_TO_CENTER**：
   - 启动，设 closeAction='quit'（避免最后 cleanup 阻塞）。
   - 用 M5 钩 `setWindowBounds` 把窗口贴到左边缘；触发 MOUSE_LEAVE → 等动画完 → 进入 HIDDEN_LEFT（用 `getEdgeDockState` 断言）。
   - 调 `emitDisplayChanged()` —— 测试钩内部 `screen.getDisplayNearestPoint` mock 不容易，但当前实现的 onDisplayChanged 用真实 `screen.getAllDisplays()` 算 insideAny。可以代替路线：用 `setWindowBounds` 把窗口位置设到不在任何 display 的 bounds 内（如 x = -10000），再 `emitDisplayChanged`。
   - 断言：`getEdgeDockState() === 'DOCKED_NONE'`、`getIsWindowVisible() === true`、bounds 在主屏 workArea 内。

2. **（可选）DOCKED_LEFT 状态下相同流程**（非 HIDDEN）—— 验证 SNAP_TO_CENTER 在不同前置状态都干净。

### 实现细节

复用 `tests/e2e/edge-dock.spec.ts` 的钩调用模式。`emitDisplayChanged` 已在 M5 添加，无需新增钩。

### 验证

`unset ELECTRON_RUN_AS_NODE && pnpm build && pnpm test:e2e tests/e2e/display-stress.spec.ts` 全绿。

**Commit message：** `test(e2e): add display-stress spec covering offscreen → SNAP_TO_CENTER`

---

## Task 6: README 扩展

**Files:** Modify `README.md`。

### 内容（凝练版，不复制 spec）

- **What it is**：1 段。链接到 spec。
- **Install**：装 `sidebrowser-Setup-1.0.0.exe`（链接到 GitHub releases 占位 / 本地 release/ 目录）。
- **Dev**：`pnpm install / dev / build / build:installer / test`。
- **键盘快捷键**：直接抄 spec §15 的表（这一处 OK 复制）。
- **Known limitations**（3–5 条）：
  - 反移动端检测的站可能仍按桌面渲染（B 站、X 等）。
  - macOS 不支持（v1.1 计划）。
  - tray icon 是 placeholder。
  - 不内置代码签名 → Windows SmartScreen 首次会报警告。
  - 不支持页面内搜索 / 下载管理 UI / 书签（用户用 Cookie + 收藏夹外部管理）。
- 末尾：链 spec / plans 目录。

≤ 100 行。重点是外人能装能用。

**Commit message：** `docs(readme): expand README to v1 release level (install / shortcuts / limitations)`

---

## Task 7: 全量验收 + version bump + tag

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`（应含新菜单单测 + url-validator 单测 + 损坏恢复单测）
- [ ] `unset ELECTRON_RUN_AS_NODE && pnpm build`
- [ ] `unset ELECTRON_RUN_AS_NODE && pnpm test:e2e`（含 display-stress + 可选 keyboard-shortcuts）
- [ ] `unset ELECTRON_RUN_AS_NODE && pnpm build:installer` → `release/sidebrowser-Setup-1.0.0.exe` 产出
- [ ] **version bump**：`package.json` `0.0.1` → `1.0.0`，commit `chore(release): bump version to 1.0.0 for M8 v1 release`
- [ ] **spec 同步**：spec §13 M8 行从"待实现" → 完成 + 一句"NSIS installer + spec §15 shortcuts + error-boundary hardening"。
- [ ] **手动冒烟（用户负责）**：装 `release/sidebrowser-Setup-1.0.0.exe` 到全新目录 → 启 → 跑 spec §17 列的核心流程（建 tab、登录站、cookie 持久、贴边、minimize-to-tray、所有快捷键、卸载）。
- [ ] `git tag -a m8-v1-release -m "M8: v1 release — NSIS installer + spec §15 shortcuts + error-boundary hardening"` (**user 冒烟确认后才执行**)

---

## Post-M8

v1 ship 完。后续候选（不在本 plan 范围）：

- v1.1: GitHub Actions CI（Windows + macOS runner）+ artifact upload。
- v1.1: 正式 tray icon + app icon 设计稿。
- v1.5: macOS 支持（platform-specific 代码已隔离在 `src/main/platform/`，扩 `darwin.ts`）。
- v2: 反移动端检测 fix（CDP `Emulation.setDeviceMetricsOverride`）。
- v2: 自定义右键菜单（复制粘贴）。
- v2: i18n（tray + menu + settings drawer）。
- v2: auto-updater (`electron-updater`) + 代码签名。
