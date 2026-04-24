# sidebrowser

打工人的侧边栏摸鱼浏览器。一款 Electron 应用，贴屏幕边缘自动收起、只露 3px 触发条，鼠标离开还会自动暗化/模糊，手机 UA 让网页按手机版渲染，登录态跨重启持久。挂在显示器边上随时瞟一眼推/B 站/工单，老板路过——鼠标移开，窗口自动暗下去。

## 关于这个项目

这个仓库的**所有代码、测试、文档和 milestone 计划**，都是 Claude（Anthropic，主要是 Opus）在 [Claude Code](https://claude.ai/code) 里、配合 [superpowers 插件](https://github.com/obra/superpowers) 写出来的。人类（仓库 owner）只负责提需求、做决策、手动冒烟测试。

换句话说，这是一个"AI 主导开发"的实验项目，拿来给好奇这套工作流的人看的——不是产品级品质，是个人玩具，但它能用。

当前版本：**v1.1.0（M9 milestone）**，Windows only。macOS 预计 v1.5 支持。

## 核心功能

- **贴边自动隐藏**（左/右均可）：窗口收起后留 3px 触发条，鼠标悬停即呼出
- **鼠标离开自动变暗/模糊**：离开窗口后触发暗化 + 模糊滤镜，强度和效果均可在设置里调
- **手机 UA 模拟**（per-tab 可切换）：默认 iOS Safari UA，让大多数网页按手机版渲染
- **登录态持久化**：所有 tab 共享 `persist:sidebrowser` session partition，cookies 跨重启保留
- **始终置顶**：能盖住 F11 全屏浏览器和视频播放器
- **单实例锁**：已有实例时双击不会再开一个
- **System / Dark / Light 三档 chrome 主题**：Settings → Appearance 切换，System 跟随 OS 深色模式
- **所有设置项均有 reset-to-default 按钮**

## 安装

从 GitHub Releases 下载 `sidebrowser-Setup-1.1.0.exe` 直接运行。

首次安装 Windows SmartScreen 会弹"未知发布者"警告，这是正常的（没做代码签名）。点**"更多信息"→"仍要运行"**即可。

或者本地构建：

```bash
pnpm install
pnpm build:installer
# 产出 release/sidebrowser-Setup-1.1.0.exe
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
| `F12` | 打开/关闭 DevTools |

## 已知限制

- **反移动端检测的站依然按桌面版渲染。** B 站、X/Twitter 等会主动识别设备信号，仅靠 UA + viewport 不够，完整的 `Emulation.setDeviceMetricsOverride` 计划在 v2。
- **不支持 macOS。** v1.5 计划加。
- **关闭窗口即退出，没有系统托盘。**
- **始终置顶对 DirectX exclusive fullscreen 无效**（极少数老游戏 / 部分 DRM 视频），这是 OS 层限制。
- **无代码签名**，首次安装 SmartScreen 会叫，点"仍要运行"。
- **无页内搜索、无下载 UI、无书签管理**。这些交给浏览器本身解决。
- **图标是占位符**，v1.2 会换正式设计。

## 技术栈

Electron + React 19 + TypeScript + Vitest + Playwright + electron-vite + Tailwind CSS + Zustand + electron-store。不引入原生模块（Electron 本身除外）。

## 文档

- 主设计 spec：`docs/superpowers/specs/2026-04-23-sidebrowser-design.md`
- Milestone 计划文档：`docs/superpowers/plans/`
- 最新 milestone spec（M9）：`docs/superpowers/specs/2026-04-24-m9-ux-stability-design.md`

## 鸣谢

- **Claude (Anthropic)** — 代码实作、测试、文档全包
- **[superpowers 插件](https://github.com/obra/superpowers)** — brainstorming / writing-plans / subagent-driven-development 工作流，让 AI 主导开发变得可行
- **人类 owner** — 出需求、拍板、按按钮
