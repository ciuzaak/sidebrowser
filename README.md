# sidebrowser

打工人的侧边栏摸鱼浏览器。一款 Electron 应用，贴屏幕边缘自动收起、只露 3px 触发条，鼠标离开还会自动暗化/模糊，手机 UA 让网页按手机版渲染，登录态跨重启持久。挂在显示器边上随时瞟一眼推/B 站/工单，老板路过——鼠标移开，窗口自动暗下去。

## 关于这个项目

这个仓库的**所有代码、测试、文档和 milestone 计划**，都是 Claude（Anthropic，主要是 Opus）在 [Claude Code](https://claude.ai/code) 里、配合 [superpowers 插件](https://github.com/obra/superpowers) 写出来的。人类（仓库 owner）只负责提需求、做决策、手动冒烟测试。

换句话说，这是一个"AI 主导开发"的实验项目，拿来给好奇这套工作流的人看的——不是产品级品质，是个人玩具，但它能用。

Windows only。macOS 预计 v1.5 支持。

## 核心功能

- **贴边自动隐藏**（左/右均可）：窗口收起后留 3px 触发条，鼠标悬停即呼出
- **鼠标离开自动变暗/模糊**：离开窗口后触发暗化 + 模糊滤镜，强度和效果均可在设置里调
- **手机模拟（M10 hybrid CDP）**：UA + Client Hints 头 + Chromium device emulation + CDP touch/pointer override，让 X.com / B 站等靠 Client Hints 路由的站点也按真移动版渲染
- **可定制搜索引擎（M11）**：默认 Google，内置 4 项（Google / DuckDuckGo / Bing / 百度）+ 用户可添加/删除自定义条目（含 `{query}` 占位符的 URL 模板）
- **网页缩放（M11）**：Ctrl+滚轮调整当前 tab 大小（每 tab 独立、50–300% / ±10% 步进），Ctrl+0 复位 100%
- **登录态持久化**：所有 tab 共享 `persist:sidebrowser` session partition，cookies 跨重启保留
- **始终置顶**：能盖住 F11 全屏浏览器和视频播放器
- **单实例锁**：已有实例时双击不会再开一个
- **System / Dark / Light 三档 chrome 主题**：Settings → Appearance 切换，System 跟随 OS 深色模式
- **所有设置项均有 reset-to-default 按钮**

## 安装

去 [GitHub Releases 最新发布页](https://github.com/ciuzaak/sidebrowser/releases/latest) 下载 `sidebrowser-Setup-<version>.exe` 直接运行。

首次安装 Windows SmartScreen 会弹"未知发布者"警告，这是正常的（没做代码签名）。点**"更多信息"→"仍要运行"**即可。

或者本地构建：

```bash
pnpm install
pnpm build:installer
# 产出 release/sidebrowser-Setup-<version>.exe，<version> 取自 package.json
```

运行环境要求：Node.js ≥ 20，pnpm ≥ 9，Windows 10/11。

## 开发（如果你想魔改）

```bash
pnpm dev          # electron-vite 开发服务器，支持热重载
pnpm build        # 打包到 out/
pnpm build:installer  # 构建安装包
pnpm test         # 单元测试（Vitest）
pnpm test:e2e     # E2E 测试（Playwright/Electron），需要先跑 pnpm build
pnpm typecheck    # TypeScript 严格检查
pnpm lint         # ESLint
```

**环境坑**：如果你的 shell 里 `ELECTRON_RUN_AS_NODE` 被全局设置了（部分开发工具会这样），Electron 会进入 Node 兼容模式，导致应用启动失败。所有 pnpm 脚本都经过 `scripts/run.mjs` 包装，会自动剥离这个变量。如果你直接调用 `electron-vite`，记得先 `unset ELECTRON_RUN_AS_NODE`。

## 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+T` | 新 tab |
| `Ctrl+W` | 关闭当前 tab |
| `Ctrl+L` | 聚焦地址栏 |
| `Ctrl+R` / `F5` | 刷新 |
| `Alt+←` / `Alt+→` | 后退 / 前进 |
| `Ctrl+Tab` | 打开/关闭 tab 抽屉 |
| `Ctrl+,` | 打开/关闭设置抽屉 |
| `Ctrl+滚轮` | 缩放当前 tab（desktop 模式）|
| `Ctrl+0` | 复位当前 tab 缩放至 100% |
| `F12` | 打开/关闭 DevTools |

## 已知限制

- **极端反移动端检测的站可能仍识别为桌面。** M10 用 hybrid CDP 翻 `userAgentData.mobile` / `(pointer:coarse)` / `(hover:none)` / `'ontouchstart' in window` + Sec-CH-UA-* 头，覆盖了大多数靠 UA + Client Hints + 媒体查询路由的站点（包括 X.com、B 站等）。但极端的 device fingerprinting（细到 GPU 型号 / 字体集 / 时钟偏移）仍可能被识别。
- **Mobile tab（per-tab Mobile 开启时）的 Ctrl+滚轮 / Ctrl+0 不工作。** Chromium 的 device emulation 模式吃掉 Ctrl+wheel 事件（解释成模拟 pinch），且 `setZoomFactor` 被 emulation 锁死的 viewport scale 覆盖。Workaround：点 TopBar 的 Smartphone/Monitor 按钮切到 desktop 模式即可缩放。完整修复路径规划到 M11.1。
- **不支持 macOS。** v1.5 计划加。
- **关闭窗口即退出，没有系统托盘。**
- **始终置顶对 DirectX exclusive fullscreen 无效**（极少数老游戏 / 部分 DRM 视频），这是 OS 层限制。
- **无代码签名**，首次安装 SmartScreen 会叫，点"仍要运行"。
- **无页内搜索、无下载 UI、无书签管理**。这些交给浏览器本身解决。
- **图标是占位符**，后续版本会换正式设计。

## 技术栈

Electron + React 19 + TypeScript + Vitest + Playwright + electron-vite + Tailwind CSS + Zustand + electron-store。不引入原生模块（Electron 本身除外）。

## 文档

- 主设计 spec：`docs/superpowers/specs/2026-04-23-sidebrowser-design.md`
- Milestone 计划文档：`docs/superpowers/plans/`
- M10 spec（mobile emulation 增强）：`docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md`
- M11 spec（搜索引擎 + 网页缩放）：`docs/superpowers/specs/2026-04-27-M11-search-and-zoom-design.md`

## 鸣谢

- **Claude (Anthropic)** — 代码实作、测试、文档全包
- **[superpowers 插件](https://github.com/obra/superpowers)** — brainstorming / writing-plans / subagent-driven-development 工作流，让 AI 主导开发变得可行
- **人类 owner** — 出需求、拍板、按按钮
