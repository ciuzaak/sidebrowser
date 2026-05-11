# Changelog

All notable changes to sidebrowser are documented in this file.
Format inspired by [Keep a Changelog](https://keepachangelog.com/);
the project follows [Semantic Versioning](https://semver.org/) at the
minor level (each numbered milestone bumps the minor version).

## [1.4.0] — 2026-05-11

Major UX overhaul covering two milestones (M13 stealth/UX polish +
M14 macOS-style refresh) released together since M13 never got its
own version tag.

### Added — M14 (macOS-style UI overhaul)

- **Semantic design tokens.** Replaced the ad-hoc `--chrome-*` CSS
  variables with a layered token system (`--surface`,
  `--surface-elevated`, `--surface-sunken`, `--border`, `--fg`,
  `--fg-muted`, `--accent`, `--accent-tint`, plus radii and shadows).
  Dark and light themes are first-class.
- **Frameless window + Windows-native title-bar overlay.** Removed
  the standard OS title bar in favor of `titleBarStyle: 'hidden'` +
  `titleBarOverlay`. The min/max/close buttons remain Windows-native
  for OS integration; the rest of the chrome is ours. Overlay colors
  follow the resolved theme on launch and on every theme change.
- **Spotlight address bar.** The narrow inline address bar (which
  was unusable on a 380 px side-panel) is replaced with a SearchPill
  button in the chrome that opens a centered Spotlight modal hosting
  the input + suggestions dropdown. Cmd+L (Ctrl+L) and clicking the
  pill both open it; current URL is pre-selected for quick editing.
- **NewTab redesign.** Small app-icon hero + time-of-day greeting
  + "Recent" section with a "Clear" action. Closer to Safari Start /
  Notion home in feel.
- **Always-on-top setting.** New Settings → Window → "Always on top"
  toggle (default on). When enabled, the window claims a high z-order
  level via `screen-saver` + on-focus re-assert. Edge-dock force-
  overrides this while the window is docked/hiding so the trigger
  strip stays reachable regardless of the user choice.
- **`history:clear` IPC.** New `HistoryStore.clearAll()` method, IPC
  channel, preload binding, and ipc-router listener — driven by the
  NewTab Clear button. Mirrors the trust model of `history:remove`.
- **macOS-style controls.** SettingsDrawer sections render as
  elevated cards with uppercase muted titles; boolean rows use a CSS
  Mac toggle (replacing the native checkbox); sliders use a 3 px
  track + white knob (replacing the OS-tinted slider).
- **Alt-menu restoration.** Dropped M13's `setMenuBarVisibility(false)`
  call that permanently disabled Alt-toggle for the hidden Application
  Menu. With `titleBarStyle: 'hidden'`, the empty-menu-bar symptom
  that motivated the lock no longer exists.

### Fixed — M14

- **Dim feature now independent of edge-dock.** When the user disabled
  the Edge dock setting, the dim/blur effect on mouse-leave stopped
  working entirely because the reducer dropped every event behind its
  enabled-guard. MOUSE_LEAVE / MOUSE_ENTER now forward to the dim
  transitions regardless of `edgeDock.enabled`; other events remain
  no-ops.
- **Spotlight pre-fills the current URL on each open.** A first-pass
  bug where the component used `if (!open) return null` (rather than
  conditional mount in the parent) caused `useState` to freeze at the
  about:blank value. The component now mounts fresh on every open.
- **`titleBarOverlay` startup color respects the saved theme.** Prior
  to this fix, the OS buttons painted using `nativeTheme` only,
  leading to a mismatch on launch when the user had overridden the
  system theme. Codex review caught this.
- **Edge-dock toggle now flips always-on-top correctly.** When the
  user disabled edge-dock while the window was docked, the closure-
  level `edgeDockActive` flag stayed stuck at true and could override
  a follow-up `alwaysOnTop=false` toggle. Codex review caught this.

### Changed — M14

- **English-only UI strings.** Confirmed via a project-wide grep that
  no Chinese characters remain in `src/renderer/src/**/*.tsx` after
  the redesign.
- **E2E test helpers.** `navigateActive(page, url, app?)` takes an
  optional `app` argument so it can poll the active WebContents URL
  via the test hook as a navigation-committed fence; new
  `openSpotlight(page)` and `getActiveUrl(app)` helpers. About ten
  spec files migrated.

### Added — M13 (web context menu, tab UX, stealth dim)

- **Web page context menu.** Right-clicking a page surfaces page /
  link / text-selection menus (Copy, Search with active engine,
  Open in new tab, Open externally, View source, etc.).
- **TabCycler / Ctrl+Tab cycles tabs.** Ctrl+Tab now cycles through
  tabs by `tabOrder` and auto-opens the TabDrawer for the duration
  of the cycle, matching every mainstream browser. Drawer auto-hides
  on Ctrl release / outside-click / tab selection.
- **Drawer auto-close behaviors.** TabDrawer and SettingsDrawer
  auto-close on outside-click; SettingsDrawer also closes when the
  active tab changes (covers drawer-click and Ctrl+Tab cycle).
- **Stealth-grade dim.** `light` dim is now a white overlay
  (semantics shifted from "brightness multiplier" to "white opacity"
  so the screen can actually reach pure white). Dim now also tints
  the chrome (TopBar, drawers, NewTab) and clears the OS window
  title text — a more convincing "not browsing right now" disguise.

### Fixed — M13

- Numerous Ctrl+Tab edge cases (cycle end detection on Windows,
  outside-click ending the cycle, focus feedback loops between the
  cycler and the tab WebContents).
- English labels for context menu items + a clearer light-slider
  label.
- Codex review round 1 + 2 follow-ups (stale comments, activeId
  guard, `view-source:` handling, `openExternal` safety, type
  comments).

## [1.3.0] — 2026-05-07

M12: browsing history + NewTab + address-bar autocomplete.

## [1.2.1] — earlier

Mobile-emulation viewport tracking fix.

## [1.2.0] — earlier

M10: mobile emulation via Sec-CH-UA-* headers + JS signal flips.

## [1.1.0] — earlier

M9: UX-stability milestone (theme handling, settings-drawer
view suppression, etc.).

## [1.0.0] — earlier

M8: v1 release — initial Electron side-panel browser with multi-tab,
mobile-emulation toggle, edge-dock auto-hide, settings persistence,
single-instance lock, and Windows installer.
