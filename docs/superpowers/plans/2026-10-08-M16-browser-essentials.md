# M16 — Browser essentials — Implementation Plan

> Executed directly by Claude per the 2026-10-08 conventions (memory: plan execution): one
> commit per task on `m16-browser-essentials`, relevant tests after each task, one review of
> the full diff at the end, final report once. Manual smoke + release belong to the user.

**Spec:** `docs/superpowers/specs/2026-10-08-M16-browser-essentials-design.md`.
**Base:** `m17-chrome-polish` (M16 + M17 release together).

Commands (pnpm via corepack re-links node_modules — do not use it):

- typecheck: `node_modules/.bin/tsc.cmd --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json`
- lint: `node_modules/.bin/eslint.cmd .`
- unit: `node_modules/.bin/vitest.cmd run`
- build: `node scripts/run.mjs node_modules\.bin\electron-vite.cmd build`
- e2e: `node scripts/run.mjs node_modules\.bin\playwright.cmd test [specs]` (quiet mode — no visible windows)

---

## Task 0 — Docs
Commit spec + plan.

## Task 1 — Pure helpers (TDD)
New pure modules + unit tests, no wiring yet:
- `src/main/permissions.ts` — `ALLOWED_PERMISSIONS`, `isPermissionAllowed(p)`.
- `src/shared/url.ts` — host detection (IPv4, localhost, `[ipv6]`, `label:port`); extend `tests/unit/url.test.ts`.
- `src/main/window-open.ts` — `decideWindowOpen({ disposition, url })`, `popupSizeFromFeatures(features)`.
- `src/main/downloads-naming.ts` — `uniqueFilename(dir, name, exists)` (injectable `exists`).
- `src/main/mobile-zoom.ts` — `mobileZoomMetrics(W, H, z)` → `{ width, height, scale }`; `nextZoom(z, dir)` / `ZOOM_STEPS`.
- `src/main/tab-discard.ts` — `pickTabsToDiscard(tabs, now, minutes)`.
- `src/main/audio.ts` — `effectiveMuted(userMuted, windowHidden, muteWhenHidden)`.
- `src/main/history-filter.ts` — `isFragmentOnlyChange(prev, next)`, `MAX_DATA_FAVICON = 16384`.

## Task 2 — Settings additions
`browsing.muteWhenHidden` (default true), `lifecycle.discardAfterMin` (0/15/30/60, default 30):
types, DEFAULTS, clamp (snap to nearest), settings-defaults test, clamp tests.
`SettingsStore` optional `{ writeDebounceMs }` + `flush()`; index.ts passes 300 and flushes on
`before-quit`; unit test with fake timers (existing tests keep immediate writes).

## Task 3 — Tab model + view layout
- `Tab` gains `loaded`, `audible`, `muted`, `crashed`; `makeEmptyTab` defaults.
- `computeViewLayout`: background → active bounds + hidden; `windowHidden`; `fullscreen`
  (covers chrome). Update `view-layout.test.ts`.

## Task 4 — ViewManager: lazy views, unload, restore, reopen, neighbour activation
- `ManagedTab.view: WebContentsView | null`, `history: HistorySnapshot | null`, `lastActiveAt`.
- `createTab(url, { id, isMobile, activate, title, favicon, history, load })`.
- `ensureView(id)` builds view + listeners; loads via `navigationHistory.restore` or `loadURL`.
- `unloadTab(id)`, `discardInactive(now, minutes, busyWcIds)`, `reopenClosedTab()` (stack 10).
- `closeTab` → neighbour activation; pushes to closed stack.
- `wcId → tabId` map; `getMobileEmulationState` uses it.
- Every method touching `view` handles `null`.
- Serialization: `serializeForPersistence()` includes title, favicon, history (live from
  `navigationHistory` for loaded tabs; stored snapshot for unloaded), capped per spec §4.4.
- E2E hooks: `unloadTab(id)`, `discardNow(minutes)`, `getTabLoaded(id)`.

## Task 5 — Persistence format + lazy launch restore
`tab-persistence.ts` sanitize new fields (backward compatible) + tests. `seedTabs` creates
non-active tabs unloaded (title/favicon/history from file), active tab restored with history.
Save also on `did-navigate*` (history changes).

## Task 6 — Auto-unload timer + settings UI
index.ts 60 s interval → `discardInactive(Date.now(), discardAfterMin, downloads.busyWcIds())`.
Settings → Session "Unload inactive tabs" select. TabDrawer: unloaded rows dimmed.

## Task 7 — Audio
`audio-state-changed` → `audible`; `tab:set-muted` IPC; `applyAudio()` on state/setting/
window-hidden change; Settings → Browsing toggle; TabDrawer speaker button.

## Task 8 — Edge-hidden page hiding
`broadcastState` → `viewManager.setWindowHidden(s.hidden)` (layout + audio).

## Task 9 — Permissions
`installPermissionPolicy(getPersistentSession())` in bootstrap (before first tab).

## Task 10 — Context menu
Spelling / editable / image / zoom tiers in `buildContextMenuTemplate` (+ deps); tests;
`view-manager` passes `params`, wc actions (`replaceMisspelling`, `cut`…, `copyImageAt`,
`downloadURL`), session `addWordToSpellCheckerDictionary`.

## Task 11 — Crash / unresponsive
Listeners → `crashed`; reload clears; `CrashOverlay` component; App suppression includes
crashed active tab; TabDrawer warning glyph.

## Task 12 — In-window fullscreen
`disableHtmlFullscreenWindowResize`; enter/leave → `fullscreenTabId`; layout + emulation;
exit on deactivate.

## Task 13 — Top overlay stack + Find in page
App `overlayStackRef` container (TabDrawer, FindBar, DownloadsDrawer) reports inset; remove
TabDrawer self-report. `Ctrl+F` accelerator + `open-find` shortcut action; find IPC; FindBar.

## Task 14 — Downloads
`DownloadsManager` (main) + IPC + `uniqueFilename`; TopBar Download button; DownloadsDrawer;
image "Save image…" uses `downloadURL`. E2E override of the downloads dir via
`SIDEBROWSER_E2E_DOWNLOADS_DIR`.

## Task 15 — Window opening
`setWindowOpenHandler` uses `decideWindowOpen`; popups get `overrideBrowserWindowOptions`;
`did-create-window` → always-on-top, popup's own window-open handler → main tabs.

## Task 16 — Zoom
Shared per-tab zoom; mobile via CDP metrics in `attachCdpEmulation`; Ctrl+= / Ctrl+-
accelerators; context-menu items; Ctrl+wheel unchanged for desktop.

## Task 17 — History SPA + favicon cap
`bindHistoryRecorderEvents` also handles `did-navigate-in-page` (main frame, not fragment-only);
`patchFavicon` cap. Tests.

## Task 18 — Efficiency
Header rewriter memo (per-UA cache) + map lookup; CursorWatcher pause/resume
(minimized / restore / settings).

## Task 19 — Storage card
`storage-usage.ts` (async dir walk, categories) + IPC (`storage:usage`, `storage:clear-cache`,
`storage:clear-site-data`) + Settings → Storage section with two-step confirm.

## Task 20 — Cleanup + README
Remove `app:ping`; README features / shortcuts / known limitations.

## Task 21 — E2E
`tests/e2e/m16-*.spec.ts` per spec §21; keep every existing spec green.

## Task 22 — Final verification + review
typecheck, lint, unit, build, full e2e; independent review of `m17-chrome-polish...HEAD`;
fix findings; screenshots of new UI; report.
