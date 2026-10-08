# M17 — Chrome polish: top bar, overlays, settings, NewTab

**Status:** draft
**Author:** Claude (with user)
**Date:** 2026-10-08
**Supersedes / extends:**
- M14 §4 window chrome (Windows-native `titleBarOverlay` → self-drawn window controls)
- M14 TopBar / TabDrawer / SettingsDrawer / NewTab / AddressSuggestions visual layer
- M6 view suppression (`{0,0,0,0}` bounds → `View.setVisible(false)`)
- M2 chrome-height reporting (TabDrawer no longer part of the reported chrome height)

> Numbering: M16 is reserved for the functionality / privacy / performance
> milestone (permission handler, crash recovery, find-in-page, downloads,
> background-tab throttling, …). M17 is independent of M16 and can ship first.

---

## 1. Motivation

A screenshot review of v1.4.1 at the default 393 px window width found:

1. **The address pill is ~65 px wide.** Windows' native min/max/close
   (`titleBarOverlay`, 3 × 46 px = 138 px) plus six 26 px IconButtons leave the
   pill with room for `Sea…` or half a hostname. It is the most-used control in
   the app and the least legible.
2. **Overlays cause visual jumps and layout work.**
   - TabDrawer lives in the chrome flow, so opening it grows the reported chrome
     height → every tab's view is resized (page reflow) and every mobile tab
     re-issues CDP `setDeviceMetricsOverride`.
   - Settings / Spotlight / NewTab suppression shrinks the active view to
     `{0,0,0,0}` and back — a full reflow + `resize` event per open/close, and
     the page area goes blank behind the translucent Spotlight scrim.
3. **Spotlight reads as two cards** (input card + absolutely-positioned
   suggestions card) and the 30 % black scrim lets NewTab rows show through,
   duplicating suggestion rows visually.
4. **Dark-theme details:** dark favicons (GitHub) vanish on dark rows; native
   Windows scrollbars (with arrow buttons) and native `<select>`s clash with
   the Mac-style chrome; no `color-scheme` is declared so form-control popups
   and scrollbars always render light.
5. **Settings:** slider tracks are nearly invisible in dark mode (no filled
   portion); Dim shows all three effect sliders even though only one applies.
6. **TabDrawer** shows `about:blank` as the label for new tabs; there is no
   indication anywhere of how many tabs are open.
7. **NewTab** has a large empty lower half; the hero loads a 372 KB `.ico`.

This milestone is a UX/visual pass. No new browsing features.

## 2. Decisions (confirmed with user, 2026-10-08)

| # | Question | Decision |
|---|---|---|
| D1 | Keep Windows-native caption buttons? | **No.** Self-drawn **Minimize + Close** only (no Maximize). `maximizable: false`. Win11 snap-layout flyout is lost (accepted). |
| D2 | Forward button | **Rendered only when `canGoForward`.** Back is always rendered (disabled when unavailable) so the left cluster is stable. |
| D3 | Mobile/desktop toggle placement | **Inside the address pill**, left edge, as a 20 px chip. |

## 3. Scope

In:

1. **Top bar re-layout** — `[Tabs+badge] [Settings] [Back] [Forward?] [ AddressPill ] [Min] [Close]`.
2. **AddressPill** — UA chip · scheme icon (lock / globe / search) · host label (opens Spotlight) · Reload/Stop button.
3. **WindowControls** — 2 × 32 px self-drawn buttons; Close hover uses Windows red.
4. **Loading bar** — 2 px accent bar at the bottom edge of the top bar, CSS-only.
5. **Tab count badge** on the Tabs button when ≥ 2 tabs.
6. **Suppression via `setVisible`** — active view keeps its bounds while suppressed.
7. **TabDrawer as a top inset** — drawer overlays the top of the page area; the
   active view is *offset* down by the drawer height without changing its size.
8. **Spotlight backdrop** — a downscaled JPEG snapshot of the active page is
   painted behind the Spotlight scrim; scrim gets `backdrop-filter: blur`.
9. **Spotlight single card** — suggestions in-flow inside the same card, a
   divider, an Enter-hint footer, and query-match emphasis in titles/URLs.
10. **Favicon tile** — favicons drawn on a theme token tile (light tile in dark theme).
11. **`color-scheme`** declared per theme; thin themed scrollbars.
12. **Settings polish** — styled `<select>` wrapper, filled slider tracks, Dim
    shows only the slider for the selected effect.
13. **TabDrawer polish** — "New Tab" label + Favicon component + bottom shadow.
14. **NewTab** — compact hero (128 px PNG), "Frequent" top-sites grid (8 tiles
    by origin frecency) above "Recent".
15. **Typography / build** — `Microsoft YaHei UI` in the font stack; renderer JS minified.

Out:

- Any M16 item (permissions, downloads, find-in-page, crash UI, throttling).
- Background (non-active) tabs keep `{0,0,0,0}` bounds — changing that is M16.
- Tab reordering, pinned tabs, tab thumbnails.
- Maximize / snap layouts.
- Real network progress (Electron exposes no per-load progress; the bar is indeterminate).
- Theme palette changes (M14 tokens stay; only new tokens are added).

## 4. Window chrome

### 4.1 BrowserWindow options

```ts
new BrowserWindow({
  …,
  titleBarStyle: 'hidden',   // unchanged — frameless, keeps thick-frame resize
  // titleBarOverlay: REMOVED
  maximizable: false,        // NEW — double-click on drag region must not maximize a side panel
  …
});
```

`resolveTitleBarOverlay`, `recomputeTitleBarOverlay`, `src/main/title-bar-overlay.ts`
and `tests/unit/title-bar-overlay.test.ts` are deleted. `setAutoHideMenuBar(true)`
stays (Alt still reveals the hidden accelerator menu).

### 4.2 IPC

| Channel | Dir | Payload | Effect |
|---|---|---|---|
| `window:minimize` | R→M send | `{}` | `win.minimize()` |
| `window:close` | R→M send | `{}` | `win.close()` (app quits via `window-all-closed`) |

### 4.3 WindowControls component

- Two buttons, each `w-8 h-9` (32 × 36), flush to the right edge, `app-no-drag`.
- Icons: lucide `Minus` / `X`, 14 px, `--fg`.
- Hover: Minimize → `--accent-tint`; Close → `--danger` bg + `--danger-fg` icon.
- `aria-label` "Minimize" / "Close"; `data-testid` `window-minimize` / `window-close`.

New tokens (both themes): `--danger: #c42b1c`, `--danger-fg: #ffffff`.

## 5. Top bar

### 5.1 Layout at 393 px

| Element | Width |
|---|---|
| left padding | 8 |
| Tabs, Settings, Back (3 × 26 + gaps) | ~86 |
| Forward (only when `canGoForward`) | 30 |
| AddressPill (`flex-1`) | **~215** (~185 with Forward) |
| WindowControls | 64 |

The 138 px `TITLEBAR_OVERLAY_PX` reservation is removed.

### 5.2 AddressPill

A `div` container (not a button — it hosts three buttons; nested buttons are invalid HTML):

```
┌──────────────────────────────────────────────┐
│ [📱] 🔒 www.bilibili.com                  [⟳] │
└──────────────────────────────────────────────┘
```

| Part | Element | testid / aria | Behavior |
|---|---|---|---|
| UA chip | `button` 20 × 20 | `topbar-ua-toggle`, "Switch to desktop/mobile" | unchanged `setMobile` toggle; accent tint when mobile |
| Main | `button` `flex-1` | `search-pill`, "Search or enter URL" | opens Spotlight (unchanged contract) |
| Scheme icon | inside Main | — | `https:` → `Lock`; blank → `Search`; else → `Globe` |
| Label | inside Main | — | host (unchanged logic); placeholder on blank |
| Reload/Stop | `button` 20 × 20 | "Reload" / "Stop" | Stop calls new `tab:stop` → `wc.stop()` |

Container: `h-[26px] rounded-[var(--radius-md)] border bg-[var(--surface-sunken)]`,
`hover:border-[var(--accent)]`, `focus-within:border-[var(--accent)]`.
All three buttons disabled when there is no active tab.

### 5.3 Tabs badge

`useTabsStore(s => s.tabOrder.length)`; render when ≥ 2, text `99+` above 99.
Accent background, `--accent-fg` text, 9 px, absolutely positioned top-right of
the Tabs IconButton. `data-testid="topbar-tab-count"`.

### 5.4 Loading bar

Stateless CSS keyed on `data-loading` (keeps clear of the
`react-hooks/set-state-in-effect` rule):

- loading → opacity 1, width animates 0 → 85 % over 4 s ease-out (`forwards`).
- not loading → width 100 %, opacity fades to 0 over 250 ms after 150 ms delay.
- Initial render with `loading=false` is invisible (opacity 0).

The top bar root gets `data-testid="topbar"` and `data-loading="true|false"`,
which replaces `.animate-spin` as the E2E load-completion fence.

## 6. View layout — suppression and top inset

### 6.1 Pure layout helper

```ts
export function computeViewLayout(i: {
  contentWidth: number; contentHeight: number;
  chromeHeightPx: number; topInsetPx: number;
  suppressed: boolean; isActive: boolean;
}): { bounds: Rectangle; visible: boolean }
```

- Active: `bounds = { x: 0, y: chrome + inset, width: W, height: max(0, H − chrome) }`
  — **height excludes the inset** so the view size is invariant while the
  drawer is open (the bottom `inset` px are clipped by the window).
- Active & suppressed: same bounds, `visible: false`.
- Background: `{0,0,0,0}`, `visible: true` (unchanged; M16 territory).

`webviewSize()` (mobile-emulation size) is unchanged: it never included the inset.

### 6.2 Suppression

`setSuppressed(v)` keeps its signature; `applyBounds()` now applies
`computeViewLayout` for every tab and calls `view.setVisible(visible)`.
The `{0,0,0,0}` early-return branch is deleted. Result: opening Settings /
Spotlight / NewTab no longer resizes the page.

### 6.3 Top inset (TabDrawer)

New R→M send `view:set-top-inset { px }` → `ViewManager.setTopInset(px)`.
TabDrawer moves out of the chrome-height measurement (`chromeRef` wraps only
TopBar, so reported chrome height becomes a constant 36 px) into the page area as
an absolutely-positioned overlay. While open it reports its own height via a
`ResizeObserver`; on close it reports 0.

Ctrl+Tab cycling keeps working with live pages: the active view is visible
(just offset), so switching tabs shows the new page under the drawer.

## 7. Spotlight

### 7.1 Backdrop snapshot

New R→M invoke `view:capture-active` → `string | null`:

```ts
const img = await wc.capturePage();
if (img.isEmpty()) return null;
const w = Math.max(1, Math.round(img.getSize().width / 2));
return 'data:image/jpeg;base64,' + img.resize({ width: w, quality: 'good' }).toJPEG(70).toString('base64');
```

Returns `null` when there is no active tab, the view is already suppressed, or
capture throws.

Renderer open path (`openSearch`, also used by Ctrl+L):

1. If the active tab is not NewTab, `await captureActiveView()` raced against a
   **150 ms** timeout (timeout → `null`).
2. In one state update: set `backdropUrl`, set `searchOpen = true`.
3. React paints the `<img data-testid="spotlight-backdrop">` (under the native
   view) → the existing suppression effect fires → view hides → backdrop visible.

Close path: `searchOpen = false` immediately (view re-shows); `backdropUrl` is
cleared 100 ms later so no blank frame shows between unsuppress and repaint.

### 7.2 Single card

- AddressSuggestions drops its own absolute positioning, border and shadow; it
  renders in-flow inside the Spotlight card below a `border-t` divider,
  `max-h-80 overflow-y-auto`.
- Footer hint row (`data-testid="spotlight-hint"`, 11 px, muted):
  - empty draft → "Type a URL or search"
  - highlighted suggestion → `Open <host>`
  - otherwise → `normalizeUrlInput` result: search template → `Search <Engine>`,
    else `Open <host>`.
  - right side: `↵` keycap.
- AddressSuggestions gains `onHighlightChange(url | null)` so the hint can follow ↑/↓.
- Scrim: new token `--scrim` (dark `rgba(0,0,0,.35)`, light `rgba(0,0,0,.18)`) +
  `backdrop-blur-[6px]` — blurs the snapshot or NewTab beneath.

### 7.3 Match emphasis

Pure helper `splitMatch(text, query): [before, match, after] | null` (first
case-insensitive occurrence; `null` for empty query / no match). Title and URL
lines render the match as `<mark>` styled `bg-transparent font-semibold text-[var(--fg)]`.

## 8. Favicons, scrollbars, color-scheme

- `:root[data-theme='dark'] { color-scheme: dark }`, light → `light`. Fixes
  native `<select>` popups, scrollbar defaults and theme-aware SVG favicons.
- New tokens `--favicon-tile` (dark `rgba(255,255,255,0.88)`, light `transparent`),
  `--scrollbar-thumb`, `--scrollbar-thumb-hover`.
- `Favicon` renders inside a tile `size + 4` px square, radius 4 px, background
  `--favicon-tile`. The Globe fallback has no tile.
- TabDrawer switches from its inline `<img>` to `<Favicon>`.
- Global `::-webkit-scrollbar` styling: 10 px, transparent track, rounded thumb
  with 3 px transparent border (`background-clip: content-box`), no arrow buttons.

## 9. Settings

- `SelectField` wrapper: `<span class="relative inline-flex">` + `select.mac-select`
  (`appearance: none`, 28 px, token colors, right padding for the icon) + lucide
  `ChevronsUpDown` 12 px absolutely positioned, `pointer-events-none`. All four
  selects migrate; their `data-testid`s stay on the `<select>`.
- Slider fill: `Slider` sets `--fill: <pct>%` inline on the `<input>`; the track
  background becomes `linear-gradient(to right, var(--accent) 0 var(--fill),
  var(--surface-sunken) var(--fill) 100%)`.
- Dim: render Blur only for `blur`, Dark brightness only for `dark`, Light
  brightness only for `light`, none for `none`. `Slider.dimmed` prop is removed.

## 10. TabDrawer

- Positioned `absolute inset-x-0 top-0 z-30` in the page area; `shadow-[var(--shadow-elevated)]`.
- Label: `about:blank` (or empty title on blank) → "New Tab".
- Uses `<Favicon size={14}>`.
- Reports height via `setTopInset` (§6.3).

## 11. NewTab

- Hero: icon `size-10` from `resources/newtab-icon.png` (128 px, generated by
  `scripts/generate-app-icon.mjs`), `pt-8 pb-4`, greeting `text-base`.
- **Frequent** grid (only when history is non-empty):
  - New pure `topSites(entries, limit, now): TopSite[]` in `suggestion-ranker.ts`:
    group http(s) entries by origin; score = Σ frecency; representative favicon =
    first non-null favicon from the highest-frecency entry in the group; sort by
    score desc; top `limit`.
  - `TopSite = { origin: string; host: string; favicon: string | null }`
    (`host` has a leading `www.` stripped).
  - New R→M invoke `history:top-sites { limit } → TopSite[]`; NewTab requests 8.
  - 4-column grid; tile = 40 px rounded square (`--surface-elevated` +
    `--shadow-card`) with a 20 px Favicon + 11 px host label (truncate).
    Click → navigate to `origin + '/'`. `data-testid="newtab-topsite"`.
  - Refreshes on `history:changed` (same subscription as Recent).
- Recent list unchanged (testids preserved).

## 12. Typography and build

- Font stack: insert `'Microsoft YaHei UI'` after `'Segoe UI'`.
- `electron.vite.config.ts` renderer `build.minify: true`.

## 13. Testing

Unit (Vitest):
- `computeViewLayout` (active / suppressed / inset / background / zero-size clamps).
- `splitMatch`.
- `topSites` (grouping, scoring order, www stripping, non-http filtered, favicon pick).
- `ipc-contract` channel names for the five new channels.
- Delete `title-bar-overlay.test.ts`.

E2E (Playwright `_electron`), new `tests/e2e/m17-chrome.spec.ts`:
1. Window controls render; Minimize → `isMinimized()` true.
2. Forward hidden on a fresh tab; present after Back.
3. Tab badge hidden with 1 tab, shows `2` with 2 tabs.
4. TabDrawer open → active view visible, `y == 36 + drawerHeight`, height unchanged; close → `y == 36`.
5. Spotlight over a real page → `spotlight-backdrop` `src` starts with `data:image/jpeg`; active view invisible; Esc → visible.
6. Settings Dim effect = dark → only `settings-dim-dark-brightness` rendered.
7. Top bar `data-loading` goes `true` → `false` across a navigation.

Updated E2E:
- `settings-drawer.spec.ts` test 1 asserts visibility (`getActiveViewVisible`) instead of `{0,0,0,0}` bounds.
- `navigation.spec.ts` `waitForLoadComplete` fences on `data-loading`.

New test hooks: `getActiveViewVisible()`, `getIsMinimized()`, `restoreWindow()`.

Manual smoke (user): §15.

## 14. Risks

| Risk | Mitigation |
|---|---|
| `View.setVisible(false)` doesn't hide the native view on Windows, or flashes on re-show | Task 1 spike gates the milestone; fallback = keep `{0,0,0,0}` for suppression |
| Child view taller than the window isn't clipped | Task 1 spike; fallback = shrink height by inset (accept reflow while drawer open) |
| `capturePage` too slow → Spotlight open lag | 150 ms race; spike measures p50/p95 |
| Removing `titleBarOverlay` loses resize borders | Task 1 spike checks `thickFrame` resize still works |
| Minimize while edge-docked confuses the edge-dock reducer | Manual smoke item; fix in a follow-up if seen |
| Favicon tile looks heavy in dark theme | Token-only; tune or set to `transparent` after smoke |

## 15. Manual smoke checklist

1. Both themes: top bar at default width shows a readable host; no overlap with window controls.
2. Minimize / Close work; double-click on the drag area does nothing; window still resizes from its edges.
3. Forward appears only after going back; Reload ↔ Stop swap while loading; loading bar animates and fades.
4. Tab badge counts correctly; TabDrawer slides over the page without the page reflowing (scroll position kept); Ctrl+Tab still shows live pages.
5. Spotlight over a page shows a blurred snapshot; no blank flash on open/close; hint follows ↑/↓.
6. Settings: themed scrollbar, selects, filled sliders; Dim shows only the relevant slider.
7. NewTab: Frequent grid + Recent; dark-theme favicons visible on tiles.
8. Edge-dock hide/reveal + dim still behave as before; minimize while docked and restore.
