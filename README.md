# sidebrowser

A side-panel Electron browser for Windows with mobile UA emulation, persistent login, mouse-leave dim/blur, and edge auto-hide. Designed to sit alongside your main browser as a persistent side panel. Full design rationale and feature spec: `docs/superpowers/specs/2026-04-23-sidebrowser-design.md`.

## Features

- Edge auto-hide: dock to left/right edge, window collapses to a 3 px trigger strip and reveals on hover.
- Mobile UA emulation (per-tab): default iPhone Safari UA, viewport-sized for mobile layouts.
- Persistent login: all tabs share a `persist:sidebrowser` session — cookies survive restarts.
- Mouse-leave dim/blur: configurable dark / light / blur / none filter when cursor leaves the window.
- Always-on-top: sidebrowser stays above other windows including fullscreen browsers.
- Single-instance: launching a second copy focuses the existing window.
- **三档主题（System / Dark / Light）：** Settings → Appearance 可切换 Chrome UI 配色；System 跟随 OS 深色模式；页面内容不受影响。

## Install

Download `sidebrowser-Setup-1.1.0.exe` from GitHub releases (TBD) or build it locally:

```bash
pnpm build:installer   # produces release/sidebrowser-Setup-<version>.exe
```

Run the installer. Windows SmartScreen may show an "unknown publisher" warning on first run — click **More info** → **Run anyway** (no code signing in v1).

## Requirements

- Node.js ≥ 20
- pnpm ≥ 9
- Windows 10/11 (macOS planned for v1.5)

## Develop

```bash
pnpm install      # install dependencies
pnpm dev          # electron-vite dev server with hot reload
pnpm build        # bundle to out/
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # E2E tests (Playwright/Electron) — run pnpm build first
pnpm typecheck    # TypeScript strict check
pnpm lint         # ESLint
```

### Environment gotcha

If your shell has `ELECTRON_RUN_AS_NODE=1` set (some dev tools set it globally), Electron runs in Node-compat mode and the app fails to start. All pnpm scripts are wrapped with `node scripts/run.mjs` which strips the variable — just use the pnpm scripts and it should work. If you invoke `electron-vite` directly, run `unset ELECTRON_RUN_AS_NODE` first.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close current tab |
| `Ctrl+L` | Focus address bar |
| `Ctrl+R` / `F5` | Reload |
| `Alt+←` / `Alt+→` | Back / Forward |
| `Ctrl+Tab` | Toggle tab drawer |
| `Ctrl+,` | Toggle settings drawer |
| `F12` | Toggle DevTools |

## Known Limitations

- **Mobile emulation is UA + viewport only.** Sites with aggressive device-signal fingerprinting (Bilibili, X/Twitter) may still render their desktop layout. Full `Emulation.setDeviceMetricsOverride` is planned for v2.
- **macOS is not supported.** Platform-specific code is stubbed; a native macOS build is planned for v1.5.
- **关闭窗口即退出应用（无系统托盘）。**
- **窗口始终置顶（always-on-top）——对 DirectX exclusive fullscreen（极少数老游戏 / 部分 DRM 视频）仍会被遮挡，这是 OS 限制。**
- **Icons are placeholder.** The installer `.exe` ships with a sky-500 "S" placeholder glyph; polished design assets are planned for v1.2.
- **No code signing.** Windows SmartScreen shows an "unknown publisher" warning on first install. Click "More info" → "Run anyway". A signing certificate is out of v1 scope.
- **No in-page search, no download UI, no bookmarks.** Use Chromium's cookie-based login persistence plus OS-level bookmarks. See spec §11.

## Documentation

- Spec: `docs/superpowers/specs/2026-04-23-sidebrowser-design.md`
- Milestone plans: `docs/superpowers/plans/`
