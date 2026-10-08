# Changelog

All notable changes to sidebrowser are documented in this file.
Format inspired by [Keep a Changelog](https://keepachangelog.com/);
the project follows [Semantic Versioning](https://semver.org/) at the
minor level (each numbered milestone bumps the minor version).

## [1.5.0] — 2026-10-08

Two milestones released together: M16 (browser essentials — the things
a daily-driver browser is expected to do) and M17 (chrome polish).

### Added — M16 (browser essentials)

- **Permission policy.** Site permission requests (notifications,
  geolocation, camera/mic, MIDI, …) are denied by default; only
  harmless ones (sanitized clipboard write, fullscreen, pointer lock,
  storage access) are granted. External protocol links open only for
  `mailto:` and `tel:`.
- **Find in page** (Ctrl+F) with match count, next/previous and
  highlight cleared on tab switch.
- **Downloads.** Files are saved straight to the Downloads folder under
  a unique name (no Save dialog behind the always-on-top window), with a
  Downloads drawer showing progress, open, show-in-folder and cancel.
  Shortcut / shell-handler types (`.scf`, `.url`, `.lnk`, `.library-ms`,
  …) are blocked; executables are saved but never launched from the
  drawer.
- **Crash and hang recovery.** A crashed or unresponsive page shows an
  overlay with Reload (and Wait for a hung page); the tab list marks it.
- **In-window video fullscreen.** HTML fullscreen fills the side window
  instead of the screen; Esc exits; edge docking keeps working.
- **Popups.** `window.open` with features (OAuth "Sign in with …"
  flows) opens a real child window that can talk back to its opener and
  closes itself; at most 3 per tab. Ctrl/middle-click opens links in a
  background tab.
- **Lazy session restore.** Only the active tab loads on startup; the
  others keep title, favicon and back/forward history (up to 25 entries)
  and load when first shown. Scroll position is retained when unloading
  a tab during the current session, but is not saved across restarts.
- **Reopen closed tab** (Ctrl+Shift+T, last 10).
- **Auto-unload idle tabs** after 15 / 30 / 60 minutes (Settings →
  Session; default 30, or never). Tabs playing audio, with unsaved form
  input or an active download are kept.
- **Audio.** Per-tab mute in the tab list; optional auto-mute while the
  window is hidden at the screen edge (on by default).
- **Mobile zoom.** Ctrl+= / Ctrl+- / Ctrl+0 zoom mobile-mode pages with
  a real reflow (CSS viewport shrinks) rather than pinch-zoom.
- **Context menu.** Spelling suggestions, edit commands in text fields
  (undo/redo/cut/copy/paste/paste as plain text/select all), image
  items, and page zoom items.
- **Storage card** in Settings: disk usage, Clear cache (keeps logins)
  and Clear all site data (signs out of everything).
- **Address bar** treats IP addresses, `localhost:port` and IDN hosts
  as sites rather than searches.

### Added — M17 (chrome polish)

- **Self-drawn window controls** (minimize + close); the native title
  bar overlay is gone and the window is no longer maximizable.
- **Address pill** containing the mobile/desktop UA chip and
  reload/stop; Forward appears only when there is somewhere to go;
  thin load bar; tab-count badge.
- **Overlay drawers.** The tab drawer, find bar and downloads drawer
  slide over the page instead of resizing it, so the page no longer
  jumps.
- **Spotlight** shows a blurred snapshot of the page behind a single
  search card, with match emphasis and an Enter hint.
- **New-tab page** gets a Frequent sites grid (grouped by host).
- **Settings** controls restyled: styled selects, filled sliders, dim
  sliders shown only for the selected effect.

### Changed

- Settings writes are debounced and flushed on quit; tab-state saves
  are debounced with a max wait. Missing settings fields are filled
  individually on upgrade, so old profiles keep their values.
- Renderer bundle is minified (571 KB → 232 KB).
- E2E runs in quiet mode: the window is transparent, click-through and
  off the taskbar, so a test run no longer interrupts other work
  (`SIDEBROWSER_E2E_VISIBLE=1` to watch).

### CI

- GitHub Actions: typecheck, lint, unit tests, build and Playwright E2E
  on windows-latest for every PR and push to `main`; pushing a `v*` tag
  builds the installer on a clean runner and attaches it to a draft
  release.

## [1.4.1] — 2026-05-28

### Fixed

- **Mobile-mode Cloudflare verification loop.** Cloudflare-protected
  pages opened in mobile mode looped the verification challenge forever
  (solve → refresh → re-challenge); desktop mode was unaffected. The
  Cloudflare Turnstile challenge runs in a cross-origin out-of-process
  iframe (`challenges.cloudflare.com`), and neither
  `webContents.setUserAgent` nor the page-target CDP user-agent override
  reaches an OOPIF — so it fell back to the desktop Electron UA while the
  top frame was mobile. Cloudflare saw a top-frame/iframe device mismatch
  and never honored `cf_clearance`. `installMobileHeaderRewriter` now
  forces a consistent mobile identity (`User-Agent` + full `Sec-CH-UA`,
  alongside the existing `Sec-CH-UA-Mobile`/`-Platform`/`-Platform-Version`)
  on every request for a mobile tab — including OOPIF requests, which carry
  the host webContents id — so the Turnstile iframe matches the top frame.
  Verified against grok.com (403 `cf-mitigated=challenge` → 200).

### Changed

- **Default mobile user agent is now Android Chrome** (previously iOS
  Safari). An iOS Safari UA over a Chromium engine is an impossible
  fingerprint — real Safari exposes no `navigator.userAgentData` and sends
  no `Sec-CH-UA`, yet the engine leaks both (plus `window.chrome` and
  `navigator.vendor = "Google Inc."`) — which Cloudflare's bot detection
  rejects. Android Chrome matches the real Blink engine, keeping the JS and
  Client-Hints signals internally consistent. The `Sec-CH-UA` brand list is
  derived from the UA string's Chrome major (so the UA and Client-Hints
  versions can never skew across Electron upgrades or custom UAs) and is
  never empty; high-entropy Client-Hint headers
  (`Full-Version-List`/`Arch`/`Bitness`/`Model`) are normalized to
  mobile-consistent values when present. Existing customized/persisted UA
  settings are unaffected — only the default (and reset-to-default) changes.

### Tests

- +6 unit/e2e cases: `buildChromiumBrands` UA-major derivation and
  never-empty guarantee, high-entropy header rewrite-if-present, stale
  `Sec-CH-UA-Platform-Version` deletion, and a cross-site (OOPIF) subframe
  regression asserting the iframe request carries the mobile identity.

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
