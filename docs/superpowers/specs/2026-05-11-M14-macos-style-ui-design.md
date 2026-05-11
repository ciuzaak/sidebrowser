# M14 — macOS-style UI overhaul

**Status:** draft
**Author:** Claude (with user)
**Date:** 2026-05-11
**Supersedes / extends:**
- §M0 §4.3 directory structure (renderer styling tokens)
- §M6 SettingsDrawer (visual layer only — IPC contract unchanged)
- §M12 NewTab (content layout redesign — data source unchanged)
- §M13 §6 chrome dim (token names migrate; behavior preserved)

---

## 1. Motivation

The current chrome works but reads as "generic Electron app" — flat sky-blue accent, neutral grays, square corners on the Windows OS frame, dense list rows. The user wants a refined, modern, macOS-inspired look that visually rewards opening this app instead of Edge or Chrome. The app is a side-panel browser (~360–420 px wide, `alwaysOnTop`, edge-dock auto-hide), which means it lives more like Raycast / Stickies / a tool palette than a regular browser window — that framing is what makes a custom non-Windows window chrome acceptable, while still keeping native Windows window controls.

This milestone is a pure UX/visual overhaul. No new product features; no IPC contract changes; no data migrations.

## 2. Scope

In:

1. **Design tokens** — replace the ad-hoc `--chrome-*` CSS variables with a semantic token system (`--surface`, `--surface-elevated`, `--surface-sunken`, `--border`, `--border-subtle`, `--fg`, `--fg-muted`, `--fg-faint`, `--accent`, `--accent-fg`, `--accent-tint`, plus a radius/spacing scale). Two complete token sets — dark + light — wired to the existing `[data-theme='dark|light']` attribute.
2. **Window chrome — frameless + Windows-native titleBarOverlay** — `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height: 36 }`. Windows draws its own min/max/close into the top-right; everything else (drag region, page title text, chrome bar) is ours. The titleBarOverlay color updates on theme change.
3. **TopBar restyle** — Tahoe-Crisp visual: refined IconButton (smaller radius, subtle hover tint, accent-tinted "active" state), better-typographed address bar with focus ring, drag region on the chrome strip.
4. **TabDrawer restyle** — compact list, accent-tinted active row with inset left bar, refined hover, English-only labels. Structure unchanged.
5. **SettingsDrawer restyle** — section blocks rendered as elevated cards with rounded corners, tighter rhythm, refined sliders (track + thumb), Mac-style toggle for booleans (replacing the system checkbox), accent on focus rings.
6. **NewTab redesign** — small hero (app icon + time-of-day greeting in English + sub line) replaces the centered logo block; section header "Recent" with right-aligned "Clear" action; compact list rows preserved from M12 data source.
7. **AddressSuggestions restyle** — Spotlight-flavored dropdown (rounded card, subtle drop shadow, accent-tinted highlight row, mono URL line).
8. **Light theme parity** — every component verified in both themes via Playwright theme-switching scenarios.
9. **Hidden Application Menu compatibility** — M8's hidden menu + Alt-suppression stays.
10. **All UI text in English** — no Chinese strings introduced. Existing English labels preserved verbatim.

Out:

- macOS-style traffic lights (red/yellow/green). The Windows-native titleBarOverlay is the chosen compromise — users on Windows keep familiar controls.
- New product features (pinned tabs, tab thumbnails, top-sites tiles, custom backgrounds).
- Backdrop blur on the chrome (`backdrop-filter: blur(…)`). Tahoe Crisp is intentionally flat; a future M15 could add it.
- Animation overhaul. Existing transitions on dim / drawer are preserved; no new motion design in this milestone.
- Light-mode dim color recalibration. M13's `lightBrightness` semantics are unchanged.
- Accessibility audit beyond keeping focus-visible rings on every interactive element.
- Custom font bundling. Renderer uses the platform stack (`-apple-system`, `'SF Pro Text'`, `'Segoe UI Variable'`, `'Segoe UI'`, `system-ui`, `sans-serif`).

## 3. Design tokens

All tokens are CSS custom properties on `:root[data-theme='…']`. Components reference tokens, never raw hex.

### 3.1 Palette — Dark

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#1c1e24` | Window body, drawer body |
| `--surface-elevated` | `#23262e` | Card / suggestion-row hover, settings cards |
| `--surface-sunken` | `#14161b` | Address bar, search input, code input |
| `--surface-chrome-top` | `#25272d` | Top of chrome gradient |
| `--surface-chrome-bot` | `#1f2127` | Bottom of chrome gradient |
| `--border` | `#2a2d36` | Drawer separators, chrome bottom border |
| `--border-subtle` | `#23262e` | List-row separators |
| `--fg` | `#e6e7ea` | Primary text |
| `--fg-muted` | `#8a8f9b` | Secondary text, URLs, section headers |
| `--fg-faint` | `#6b7280` | Close-icon idle, disabled |
| `--accent` | `#5b8dff` | Primary accent (active row, focus ring, primary button bg) |
| `--accent-fg` | `#ffffff` | Text on filled `--accent` background |
| `--accent-tint` | `rgba(91,141,255,0.18)` | Active-state bg, hover-on-active |
| `--accent-text` | `#7fa8ff` | Accent text on dark surfaces |
| `--active-row-bg` | `#2a3146` | Selected tab row |
| `--active-row-fg` | `#cfe4ff` | Selected tab row text |

### 3.2 Palette — Light

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#f6f6f7` | Window body, drawer body |
| `--surface-elevated` | `#ffffff` | Cards, suggestion rows |
| `--surface-sunken` | `#ffffff` | Address bar (with `--border`) |
| `--surface-chrome-top` | `#fbfbfc` | Top of chrome gradient |
| `--surface-chrome-bot` | `#ececee` | Bottom of chrome gradient |
| `--border` | `#d8d8db` | Drawer separators, chrome bottom border |
| `--border-subtle` | `#ececee` | List-row separators |
| `--fg` | `#1d1d1f` | Primary text |
| `--fg-muted` | `#6b6b70` | Secondary text |
| `--fg-faint` | `#9aa1ad` | Close-icon idle, disabled |
| `--accent` | `#0066cc` | Primary accent (macOS System Blue) |
| `--accent-fg` | `#ffffff` | Text on filled `--accent` background |
| `--accent-tint` | `rgba(0,102,204,0.14)` | Active-state bg, hover-on-active |
| `--accent-text` | `#0066cc` | Accent text on light surfaces |
| `--active-row-bg` | `#e6efff` | Selected tab row |
| `--active-row-fg` | `#003d99` | Selected tab row text |

### 3.3 Radius / spacing scale

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `4px` | IconButton, slider thumb, small chip |
| `--radius-md` | `6px` | Address bar, suggestion row, list row |
| `--radius-lg` | `10px` | Settings card, NewTab section card |
| `--radius-xl` | `14px` | Future use (sheet / modal); not applied to BrowserWindow itself (see §4.3) |
| `--shadow-elevated` | `0 10px 30px -10px rgba(0,0,0,.45)` (dark) / `0 10px 30px -10px rgba(0,0,0,.12)` (light) | Suggestions dropdown |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.18), 0 0 0 1px var(--border)` | Settings cards |

### 3.4 Typography

Stack on `body`:

```
-apple-system, "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, "Inter", sans-serif
```

Tabular numbers (`font-variant-numeric: tabular-nums`) on slider value badges and any numeric metadata so values don't jitter while dragging.

### 3.5 Token migration

The existing `--chrome-bg`, `--chrome-fg`, `--chrome-border`, `--chrome-hover`, `--chrome-muted`, `--chrome-input-bg`, `--chrome-drawer-bg`, `--chrome-accent` variables are **removed**. Every reference is rewritten to the new semantic token. This is a hard sweep — no shim, no alias layer.

## 4. Window chrome

### 4.1 BrowserWindow options

In `src/main/index.ts` `createWindow`:

```ts
const win = new BrowserWindow({
  x, y, width, height,
  title: 'sidebrowser',
  alwaysOnTop: true,
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#25272d',        // matches --surface-chrome-top (dark)
    symbolColor: '#c8ccd4',
    height: 36,
  },
  webPreferences: { /* unchanged */ },
});
```

`frame` is automatically false when `titleBarStyle: 'hidden'`. `alwaysOnTop` + edge-dock behavior is unaffected because we do **not** set `transparent: true` (see §4.3).

### 4.2 Title-bar-overlay theme sync

Main subscribes to `nativeTheme.on('updated', …)` once (already present for the renderer broadcast in M0). On every update, recompute the resolved theme using `resolveTheme(currentSettingsThemeChoice, nativeTheme.shouldUseDarkColors)` and call `win.setTitleBarOverlay({ color, symbolColor })` with the dark or light pair. The same recomputation also runs on the `settings:update` IPC when `appearance.theme` changes.

A new pure helper `src/main/title-bar-overlay.ts` exports `resolveTitleBarOverlay(theme: 'dark' | 'light'): { color: string; symbolColor: string }` — single source of truth, unit-testable, no Electron dep.

### 4.3 No window border-radius

Rounding the BrowserWindow itself would require `transparent: true`, which on Windows interferes with `alwaysOnTop: 'screen-saver'` and the M5 edge-dock hide animation. We accept rectangular window outlines; the visual softness comes from the chrome content. This is explicitly Out-of-scope but documented so a future contributor doesn't relitigate it.

### 4.4 Drag region

The chrome strip (the row containing IconButtons + address bar) gets `-webkit-app-region: drag`. Every interactive child (buttons, address `<input>`) gets `-webkit-app-region: no-drag`. The 36 px high titleBarOverlay area on the right (where Windows draws min/max/close) is owned by the OS — we leave it alone visually.

### 4.5 Chrome height + ResizeObserver

`App.tsx` already reports `chromeRef.current.getBoundingClientRect().height` to main via `setChromeHeight`. This contract is preserved. Because the IconButton row is still the topmost chrome element (titleBarOverlay is an OS-side z-layer on top, not in the DOM), the measurement is correct without modification.

## 5. TopBar

File: [src/renderer/src/components/TopBar.tsx](src/renderer/src/components/TopBar.tsx)

Structural changes: none. Only `className` strings change, plus the addition of `-webkit-app-region: drag` on the outer wrapper and `no-drag` on each `<IconButton>` and the address `<input>`.

Visual rules:

- Outer row: `bg-[var(--surface-chrome-bot)]` with a top→bottom gradient (`--surface-chrome-top` → `--surface-chrome-bot`), `border-b border-[var(--border)]`, `h-9` (36 px), horizontal padding `px-2`.
- `IconButton`: 26×26 px hit target, `rounded-[var(--radius-sm)]`, idle `text-[var(--fg)]`, hover `bg-[var(--accent-tint)]`, active state `bg-[var(--accent-tint)] text-[var(--accent-text)]`, disabled at 40 % opacity. Icon size stays at 16 (lucide-react).
- Address bar: `bg-[var(--surface-sunken)]`, `border border-[var(--border)]`, `rounded-[var(--radius-md)]`, `h-[26px]`, font 12 px, focus ring uses `--accent` (2 px ring, no offset).
- Right reserved space: 138 px (the `titleBarOverlay` width on Windows is ~135 px for the three native buttons; we reserve a hair more to keep the address bar from clipping under). This is a constant in TopBar.tsx — `TITLEBAR_OVERLAY_PX = 138`.

## 6. TabDrawer

File: [src/renderer/src/components/TabDrawer.tsx](src/renderer/src/components/TabDrawer.tsx)

Structural changes: none. The "New tab" row and the per-tab row markup stay. Visual rules:

- Container: `bg-[var(--surface)]`, `border-b border-[var(--border)]`, `max-h-[60vh]` preserved.
- New-tab row: `text-[var(--accent-text)]`, 8 px vertical padding, `border-b border-[var(--border-subtle)]`, leading `+` icon at 14 px.
- Tab row idle: `text-[var(--fg)]`, 8 px vertical / 12 px horizontal padding, `border-b border-[var(--border-subtle)]`. Hover: `bg-[var(--accent-tint)]`.
- Tab row active: `bg-[var(--active-row-bg)] text-[var(--active-row-fg)]` + inset left bar 2 px `--accent` (via `box-shadow: inset 2px 0 0 var(--accent)`).
- Close (`×`) icon: idle `text-[var(--fg-faint)]`, hover row turns `text-[var(--fg-muted)]`, button hover `bg-[var(--accent-tint)] text-[var(--fg)]`.
- Favicon fallback (16×16 px placeholder when no favicon): `bg-[var(--border)]` rounded-sm.

`data-testid` attributes — `tab-drawer`, `tab-drawer-new`, `tab-drawer-item`, `tab-drawer-close`, `data-tab-id`, `data-active` — are preserved exactly. Existing E2E tests must continue to pass without modification.

## 7. SettingsDrawer

File: [src/renderer/src/components/SettingsDrawer.tsx](src/renderer/src/components/SettingsDrawer.tsx)

Two structural changes:

1. Each `<Section>` becomes a card: rounded-lg, `bg-[var(--surface-elevated)]`, `--shadow-card`, internal padding 12 px. The section-title bar (previously inline with a bottom border) moves to a card header with `--fg-muted` uppercase label + the existing right-slot. Visually the settings list now reads as a stack of grouped cards instead of one long page.
2. Boolean rows (Edge dock enabled, Restore tabs on launch, Default new tab = mobile) replace the native `<input type="checkbox">` with a Mac-style toggle. The toggle is a small CSS-only component (no new dependency): `<label class="toggle"><input type="checkbox" …/><span class="track"/></label>`, with `--accent` background when checked and white knob. `accent-color` is no longer used.

Other restyling:

- Slider track: `bg-[var(--surface-sunken)]`, 2 px height (was 8 px), thumb `bg-[var(--accent)]` with `--shadow-card`, no native `accent-color` (we draw it with `appearance: none`). Both `webkit-slider-runnable-track` / `webkit-slider-thumb` and `moz-range-…` rules in `globals.css`.
- Selects: `bg-[var(--surface-sunken)]`, `border-[var(--border)]`, accent focus ring.
- Reset icon (`<RotateCcw>`): unchanged behavior, restyled with `--fg-faint` → `--fg` on hover.
- Header: `text-base font-semibold` (was `text-sm`), 12 px vertical padding.

`data-testid` attributes preserved verbatim — every E2E selector in `e2e/settings.spec.ts` etc. continues to resolve.

## 8. NewTab

File: [src/renderer/src/components/NewTab.tsx](src/renderer/src/components/NewTab.tsx)

Layout change:

```
┌─────────────────────────────────────┐
│              (36 px gap)            │
│         ┌────────┐                  │
│         │  Icon  │   ← 56×56 px     │
│         └────────┘                  │
│         Good afternoon              │  ← 17 px, font-weight 600
│   Pick up where you left off,       │  ← 12 px, --fg-muted
│   or search above.                  │
│              (24 px gap)            │
│  RECENT                       Clear │  ← section header
│  ────────────────────────────────   │
│  🌐 Apple — Official Site           │
│      apple.com                      │
│  🌐 claude-code repo                │
│      github.com/anthropics/…        │
│  …                                  │
└─────────────────────────────────────┘
```

- Greeting: time-of-day branched on `new Date().getHours()` (5–11 → "Good morning", 12–17 → "Good afternoon", 18–22 → "Good evening", else → "Hello"). Computed once at mount (the page is short-lived).
- Sub line: constant English string `Pick up where you left off, or search above.`
- Section header "RECENT" with right-aligned "Clear" button — wires up to `window.sidebrowser.historyClear()`. **Open question resolved:** there is no existing `historyClear` IPC; we add one. See §11.
- Empty state: when `entries.length === 0`, keep the hero + greeting + sub line, replace the list with a single muted line `No recent pages yet.` (text moves into the position the list would occupy, keeping the page from collapsing). Existing `data-testid="newtab-empty"` reused.
- Existing `data-testid="newtab"`, `newtab-list`, `newtab-item`, `newtab-remove` preserved.

## 9. AddressSuggestions

File: [src/renderer/src/components/AddressSuggestions.tsx](src/renderer/src/components/AddressSuggestions.tsx)

Structural changes: none. Visual rules:

- Dropdown container: `mt-1.5`, `rounded-[var(--radius-lg)]`, `bg-[var(--surface-elevated)]`, `--shadow-elevated`, `border-[var(--border)]`, `overflow-hidden`, `p-1`.
- Row idle: `rounded-[var(--radius-md)]`, hover `bg-[var(--accent-tint)]`. Row highlighted via keyboard: `bg-[var(--accent-tint)] text-[var(--accent-text)]` — distinct from hover so keyboard nav is visible even when mouse is hovering elsewhere.
- Title line: 13 px `--fg`. URL line: 11 px `--fg-muted`, `font-variant-numeric: tabular-nums`, mono is NOT applied (Spotlight uses sans for URLs — matches the brief better than a tech-mono look).

## 10. Favicon

File: [src/renderer/src/components/Favicon.tsx](src/renderer/src/components/Favicon.tsx)

Structural changes: none. The Globe fallback color follows `--fg-muted`.

## 11. New IPC: `history:clear`

A single new IPC channel `history:clear` (handler `clearAll(): void`) added to the existing history store; verified absent in current code. Implementation: `historyStore.clearAll()` empties the store and broadcasts `history:changed`. Preload exposes `window.sidebrowser.historyClear(): Promise<void>`. Used only by the NewTab "Clear" button (§8). Same per-renderer trust model as the existing `historyRemove(url)` IPC.

Confirmation dialog is intentionally not shown — Clear is rare, reversible by re-visiting pages, and an extra modal would feel heavy in a tool palette. Mirrors the M12 decision not to confirm `historyRemove`.

## 12. Theme parity

The two token sets live in `src/renderer/src/styles/globals.css`. The `useTheme.ts` mechanism is untouched. Test plan:

- Unit test `title-bar-overlay.test.ts`: `resolveTitleBarOverlay('dark')` and `('light')` return the documented values.
- E2E: existing theme-switch coverage (`e2e/chrome-dim.spec.ts` etc.) continues to pass. Add one new E2E (`e2e/macos-style.spec.ts`) that:
  1. Boots the app, asserts dark tokens are applied (`getComputedStyle(html).getPropertyValue('--accent')` returns `#5b8dff`).
  2. Switches theme to `light` via settings, asserts `--accent` becomes `#0066cc`.
  3. Asserts the address bar `border` color matches `--border` for the active theme.

No screenshot tests. Visual regressions are intentionally human-smoked, not pixel-diffed (the project does not have a baseline corpus).

## 13. Testing strategy

- **Typecheck:** clean.
- **Lint:** clean. No new disable directives.
- **Unit:** existing suites pass without edits. New `title-bar-overlay.test.ts`.
- **E2E:** existing suites pass without edits to selectors (`data-testid` and `data-*` attributes are preserved verbatim). New `e2e/macos-style.spec.ts` (theme parity check above).
- **Manual smoke** (user-owned, per repo convention):
  - Launch app → see frameless window with Windows native min/max/close in top-right corner.
  - Drag chrome strip → window moves.
  - Cycle theme system / dark / light → all surfaces (TopBar, TabDrawer when open, SettingsDrawer, NewTab, AddressSuggestions) flip correctly. titleBarOverlay buttons recolor.
  - Open NewTab (Ctrl+T) → see greeting + recent list. "Clear" empties.
  - Open Settings → see grouped cards, Mac-style toggles, refined sliders.
  - Open TabDrawer (Layers icon) → compact list, active row tinted accent.
  - Open AddressSuggestions (focus address bar with history) → rounded dropdown, keyboard nav visible.
  - Ctrl+Tab cycles tabs.
  - EdgeDock hide/show still works (window slides off-screen on alwaysOnTop edge).
  - Dim still works in dark / light / blur modes.

## 14. Risks

| Risk | Mitigation |
|---|---|
| `titleBarStyle: 'hidden'` + `titleBarOverlay` on older Windows builds may render differently. | Electron 28+ supports `titleBarOverlay` on Win10+. Our `package.json` already requires Electron in a modern range. If issues found at smoke, fall back to `titleBarStyle: 'default'` (keeps OS title bar) via env override. |
| `-webkit-app-region: drag` swallows clicks if applied too broadly — IconButtons would stop working. | Explicit `no-drag` on every interactive child. Covered by existing E2E that exercises every TopBar button. |
| EdgeDock animation / `alwaysOnTop` interaction with frameless mode untested. | First smoke item. If EdgeDock breaks, the `titleBarOverlay` fallback (above) is a one-line revert. |
| Mac-style CSS toggles may render incorrectly across Chromium versions. | Pure CSS, no `appearance: none` reliance for the toggle (uses a hidden `<input>` + sibling-styled `<span>`). Verified pattern. |
| Global token rename may break unmigrated references. | Hard sweep: grep for `--chrome-` in `src/` after the rewrite should return zero matches. Lint gate added (custom `no-restricted-syntax` ESLint rule or simple pre-commit grep) is **out of scope** — verification is a one-time grep at PR review. |
| New `history:clear` IPC adds attack surface (renderer can wipe history). | Acceptable. The renderer is local + trusted; same threat surface as `historyRemove(url)` which already exists. |

## 15. Acceptance criteria

1. `grep -rE "--chrome-(bg|fg|border|hover|muted|input-bg|drawer-bg|accent)" src/` returns zero matches.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all green.
3. User-led manual smoke (§13) passes.
4. No new Chinese strings in `src/renderer/src/**/*.tsx`. (`grep -rP "[\\x{4e00}-\\x{9fff}]" src/renderer/src --include="*.tsx"` returns zero matches.)
