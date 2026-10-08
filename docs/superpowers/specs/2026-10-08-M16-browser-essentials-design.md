# M16 — Browser essentials: privacy, robustness, resources, storage

**Status:** draft
**Author:** Claude (with user)
**Date:** 2026-10-08
**Base:** branch `m17-chrome-polish` (M17 ships in the same release; M16 builds on its
`computeViewLayout`, top-inset and suppression machinery).

---

## 1. Motivation

The 2026-10-08 code review of v1.4.1 found gaps in three areas:

- **Privacy / correctness:** Electron grants every permission request by default (notifications
  pop Windows toasts — anti-stealth; geolocation / camera / mic granted silently). IPs,
  `localhost` and `host:port` typed in the address bar go to the search engine. The custom
  context menu has no Cut/Copy/Paste in inputs, no spelling suggestions, no image items. A
  crashed renderer leaves a white tab with no recovery. HTML fullscreen is unhandled.
- **Resources:** background tabs are only zero-sized (pages stay "visible": timers, rAF,
  video decode run on), every restored tab loads at launch, tabs are never unloaded, the
  window hidden at the edge keeps rendering and playing audio, every network request runs
  regex parsing in the main process, settings sliders write the settings file synchronously
  on every step, and the cursor is polled at 20 Hz even when nothing needs it.
- **Missing basics:** find in page, downloads UI, popup windows with `window.opener`
  (OAuth), background-tab opens, mobile-mode zoom (known limitation), SPA navigations in
  history, reopen closed tab, back/forward across restarts, and a way to reclaim disk
  (1.14 GB measured on the owner's profile: Service Worker CacheStorage 376 MB — x.com alone
  334 MB, never auto-evicted — plus self-capped HTTP cache 361 MB and Code Cache 363 MB).

## 2. Decisions (confirmed with user, 2026-10-08)

| # | Question | Decision |
|---|---|---|
| D1 | Permission requests | **Deny by default**; allow only a small harmless allowlist. No prompt UI. |
| D2 | HTML video fullscreen | **Fill the side window** (in-window fullscreen), window itself never goes OS-fullscreen. |
| D3 | Auto-mute | **Mute when hidden at the edge** (not when merely dimmed). Setting toggle, default on. Per-tab audible indicator + manual mute. |
| D4 | Extras | All four: **Ctrl+Shift+T**, **back/forward across restart**, **mobile zoom + Ctrl+= / Ctrl+-**, **auto-unload inactive tabs**. |
| D5 | Storage cleanup | Settings → **Storage** card: usage breakdown, "Clear cache" (keeps logins), "Clear all site data…" (two-step confirm). No auto-trim. |

## 3. Spike results (2026-10-08, Electron 41.3)

| Question | Result |
|---|---|
| In-window fullscreen | `webPreferences.disableHtmlFullscreenWindowResize: true` → `enter/leave-html-full-screen` still fire, window stays non-fullscreen, element fills the view; **Esc exits natively**. |
| `navigationHistory.restore` on a fresh view | Works before any `loadURL`; restores back/forward stack and active index (~0.5–0.7 s). With `pageState` it restores scroll position (form values not). |
| Mobile zoom | `enableDeviceEmulation({scale})` is overridden by our CDP metrics; CDP `deviceScaleFactor` does not magnify; `setPageScaleFactor` is pinch-zoom (horizontal panning). **Works:** CDP `setDeviceMetricsOverride({ width: round(W/z), height: round(H/s), deviceScaleFactor: 0, mobile: true, scale: s, dontSetVisibleSize: true })` with `s = W / round(W/z)` — layout narrows, output scales to fill, `pointer:coarse` intact, input coordinates map correctly. |
| `View.setVisible(false)` (from M17 spike) | Page goes `visibilityState = hidden` (timer/rAF throttling), no resize on show/hide. |

## 4. Tab model

### 4.1 Tab fields (shared `Tab`)

New fields (all broadcast via existing `tab:updated` / `tabs:snapshot`):

| Field | Type | Meaning |
|---|---|---|
| `loaded` | `boolean` | `false` = no WebContentsView yet (lazy-restored) or unloaded by auto-discard. |
| `audible` | `boolean` | From `audio-state-changed`. |
| `muted` | `boolean` | User mute (tab drawer speaker button). |
| `crashed` | `'crashed' \| 'unresponsive' \| null` | Renderer gone / hung. |

### 4.2 Lazy views

`ManagedTab.view` becomes `WebContentsView | null`. A tab without a view keeps `url`, `title`,
`favicon`, `isMobile`, zoom and a **history snapshot** `{ entries: NavigationEntry[]; index }`.
`activateTab` on an unloaded tab creates the view and either
`navigationHistory.restore(snapshot)` or `loadURL(url)`.

- **Launch restore:** only the persisted active tab is loaded; the rest are unloaded
  (titles/favicons come from persistence).
- **Auto-unload:** `lifecycle.discardAfterMin ∈ {0, 15, 30, 60}` (0 = never, default 30). A
  60 s timer unloads tabs that are not active, loaded, not audible, not loading, not crashed,
  have no in-progress download, and were last active more than N minutes ago. Unload =
  snapshot history (with `pageState`) → detach listeners → close the WebContents.
- **Reopen closed tab (Ctrl+Shift+T):** `closeTab` pushes `{ url, isMobile, history }` onto a
  10-deep stack; reopen creates an unloaded tab and activates it (restore path).
- **Close activates the neighbour** (next to the right, else left) instead of the
  last-inserted tab.

### 4.3 View layout (extends M17 `computeViewLayout`)

| Case | Bounds | Visible |
|---|---|---|
| Background tab (has view) | same as active bounds | **false** (was 0×0 visible) |
| Active, normal | below chrome + inset | `!suppressed && !windowHidden` |
| Active, HTML fullscreen | whole content area (covers chrome) | `!windowHidden` |

`windowHidden` = edge-dock reports `hidden: true` (after the hide animation; cleared when
the reveal starts). `webviewSize()` (mobile emulation) uses the full content height while
the active tab is fullscreen.

### 4.4 Persistence (`sidebrowser-tabs.json`)

`PersistedTab` gains `title`, `favicon`, `history?: { entries: {url,title,pageState?}[]; index }`.
Entries capped at the 25 around the active index; a `pageState` over 64 KB is dropped. Older
files (no new fields) still load.

## 5. Audio

- `audio-state-changed` → `audible`.
- New R→M invoke `tab:set-muted { id, muted }`.
- Effective mute per tab = `muted || (settings.browsing.muteWhenHidden && windowHidden)`,
  applied with `wc.setAudioMuted` whenever any input changes (and on view creation).
- TabDrawer row: speaker icon when audible or muted; click toggles mute.
- Setting `browsing.muteWhenHidden: boolean` (default `true`), Settings → Browsing toggle.

## 6. Permissions

`installPermissionPolicy(session)`: `setPermissionRequestHandler` + `setPermissionCheckHandler`
allow only:

`clipboard-sanitized-write`, `fullscreen`, `pointerLock`, `storage-access`,
`top-level-storage-access`.

Everything else (notifications, geolocation, media, midi, openExternal, idle-detection,
display-capture, window-management, …) is denied. Pure allowlist module, unit-tested.

## 7. Address bar

`normalizeUrlInput` treats as hosts (→ `http://` for `localhost`/IPs/single-label+port,
`https://` otherwise): dotted hostnames (existing rule), IPv4 with optional `:port` / path,
`localhost` with optional `:port` / path, `[ipv6]` literals, and any `label:port` /
`label:port/path` (port 1–65535). Plain words still search.

## 8. Context menu

Adds, in this order, when applicable:

1. **Spelling:** up to 5 `dictionarySuggestions` (→ `replaceMisspelling`), "Add to dictionary".
2. **Editable** (`params.isEditable`): Undo, Redo, —, Cut, Copy, Paste, Paste as plain text,
   Select all — enabled per `params.editFlags`.
3. Selection block (existing; skipped when editable — Copy is already there).
4. **Image** (`mediaType === 'image'`): Open image in new tab, Copy image, Copy image address,
   Save image… (→ `downloadURL`, goes through the Downloads flow).
5. Link block (existing).
6. Page block (existing) + **Zoom in / Zoom out / Reset zoom (NN%)**.

## 9. Crash / unresponsive

`render-process-gone` → `crashed: 'crashed'`; `unresponsive` → `'unresponsive'`;
`responsive` → `null`. Renderer: active tab with `crashed` is added to the suppression set
and `CrashOverlay` (page area) shows the message + **Reload** (+ **Wait** for unresponsive).
Reload clears the flag. TabDrawer shows a warning glyph on crashed tabs.

## 10. HTML fullscreen (in-window)

Every tab view: `disableHtmlFullscreenWindowResize: true`. `enter-html-full-screen` on the
active tab → `fullscreenTabId = id`, layout covers the chrome, mobile emulation reapplied at
full size. `leave-html-full-screen` reverses. Switching away from a fullscreen tab exits it
(`document.exitFullscreen()`).

## 11. Find in page

- Accelerator **Ctrl+F** → renderer `open-find`. `FindBar` (input, "3/12", ↑, ↓, ×) sits in a
  new **top overlay stack** in the page area together with TabDrawer and DownloadsDrawer.
- The stack container (not each drawer) reports its height via `view:set-top-inset`
  (generalises M17: TabDrawer no longer reports itself).
- IPC: `find:start { text, forward, findNext }` (invoke), `find:stop` (send),
  `find:result { activeMatchOrdinal, matches }` (M→R from `found-in-page`).
- Enter = next, Shift+Enter = previous, Esc = close (clears selection). Closes on tab switch.

## 12. Downloads

- `session.on('will-download')`: save to `app.getPath('downloads')` with a unique name
  (`name (1).ext`, …), no dialog. Items tracked in a `DownloadsManager` (session lifetime).
- `DownloadItemInfo { id, filename, path, url, state: progressing|completed|cancelled|interrupted,
  receivedBytes, totalBytes, startedAt, webContentsId }`; progress broadcast throttled (250 ms).
- IPC: `downloads:list` (invoke), `downloads:changed` (M→R), `downloads:open`,
  `downloads:show-in-folder`, `downloads:cancel`, `downloads:clear` (send).
- TopBar: a Download button appears (before the pill) once the list is non-empty; accent
  ring while any item is progressing. Click toggles `DownloadsDrawer` in the overlay stack.
- `shell.openPath` / `shell.showItemInFolder` only for paths the manager created.

## 13. Window opening

Pure `decideWindowOpen({ disposition, url })`:

| disposition | Action |
|---|---|
| `new-window` (window.open with features — OAuth popups) | Real popup: `action: 'allow'`, child BrowserWindow (same session, sandboxed, always-on-top `screen-saver`, size from features clamped 320–1000 × 320–1000, centered on the main window). Popups' own window.open → tabs in the main window. |
| `background-tab` (Ctrl/middle-click) | `createTab(url, { activate: false })` |
| anything else | `createTab(url)` (existing) |

Unsafe schemes are still sanitized by `createTab`; popups are only allowed for http(s).

## 14. Zoom

- Per-tab zoom factor (existing map), steps ±10 %, 50–300 %.
- Desktop tabs: `setZoomFactor` (existing). **Mobile tabs:** CDP metrics per §3 with
  `z ≠ 1`; `z = 1` keeps today's exact parameters. Applied in `attachCdpEmulation` (so it
  survives navigations) and on zoom change.
- Shortcuts: **Ctrl+=** (and Ctrl+Plus / numpad +), **Ctrl+-** (numpad −), Ctrl+0 (existing).
- Context menu Zoom items (§8).

## 15. History

- Record `did-navigate-in-page` for the **main frame** when it is not a fragment-only change.
- `patchFavicon` ignores `data:` favicons longer than 16 KB.

## 16. Efficiency

- Header rewriter: `wcId → tab` map maintained by ViewManager; identity (metadata + brand
  strings) memoised per UA string.
- `SettingsStore`: optional write debounce (production 300 ms, flushed on quit); in-memory
  value and broadcasts stay immediate.
- `CursorWatcher` paused while minimized, or when `dim.effect === 'none'` and edge-dock is
  disabled.

## 17. Storage card

- `storage:usage` → `{ httpCache, codeCache, serviceWorker, other, total }` bytes, computed by
  walking `session.getStoragePath()` (async).
- `storage:clear-cache` → `clearCache()`, `clearCodeCaches({})`,
  `clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] })` —
  cookies / localStorage / IndexedDB kept (stay signed in).
- `storage:clear-site-data` → everything (`clearStorageData()`, caches, `clearAuthCache()`).
  UI requires a second click ("Click again to confirm") within 4 s.
- Settings → **Storage** section shows the breakdown (refresh on open + after clearing).

## 18. Cleanup

Remove the M0 `app:ping` channel and preload `ping`.

## 19. Settings additions

| Key | Type | Default | UI |
|---|---|---|---|
| `browsing.muteWhenHidden` | boolean | `true` | Browsing → "Mute when hidden at edge" |
| `lifecycle.discardAfterMin` | 0 \| 15 \| 30 \| 60 | `30` | Session → "Unload inactive tabs" (Never / 15 / 30 / 60 min) |

Clamp: unknown numbers snap to the nearest allowed value; booleans pass through.

## 20. Shortcuts (README)

Adds Ctrl+F (find), Ctrl+Shift+T (reopen closed tab), Ctrl+= / Ctrl+- (zoom, desktop and mobile).

## 21. Testing

Unit: permission allowlist; host detection; context-menu tiers; `decideWindowOpen`;
`uniqueFilename`; mobile zoom metrics; discard policy; effective mute; persisted-tab
sanitize (history, caps, old format); clamp of new settings; history SPA filter + favicon
cap; view layout (background hidden, windowHidden, fullscreen); settings debounce.

E2E (`tests/e2e/m16-*.spec.ts`): notification permission denied; IP host navigates; find bar
counts matches; download lands in a temp downloads dir with progress UI; crash overlay on
`forcefullyCrashRenderer` + reload; in-window fullscreen covers the chrome and Esc restores;
popup window gets `window.opener`; background-tab open keeps the active tab; lazy restore
(non-active tabs unloaded after relaunch, restore on activation with back history); discard
via test hook; reopen closed tab; mobile zoom changes `innerWidth`; storage usage/clear;
mute when hidden.

Manual smoke (user): §22.

## 22. Manual smoke checklist

1. Sites asking for notifications / location get nothing; no Windows toast ever appears.
2. `192.168.x.x`, `localhost:3000` open as sites.
3. Right-click in a text field: Cut/Copy/Paste work; misspelled word shows suggestions; image menu items work.
4. Kill a tab's renderer (Task Manager) → overlay → Reload recovers.
5. Video fullscreen fills the side window; Esc returns; edge-dock still fine.
6. Ctrl+F finds and steps through matches; downloads land in Downloads with progress; open / show in folder.
7. OAuth "Sign in with Google/GitHub" popup completes and closes.
8. Restart: tabs come back unloaded except the active one; switching restores them with back/forward history; Ctrl+Shift+T reopens closed tabs.
9. Leave tabs idle past the unload timeout → they unload (dimmed in the drawer) and restore on click.
10. Audio stops when the window hides at the edge and resumes on reveal; per-tab mute works.
11. Mobile tab: Ctrl+= / Ctrl+- / Ctrl+0 zoom with reflow.
12. Settings → Storage shows usage; Clear cache keeps logins; Clear all site data signs out.

## 23. Implementation notes (post-execution, 2026-10-08)

Deviations from the sections above, made during execution and the final review:

- **§4.4 persistence.** The file stores history **without `pageState`** (URLs + titles only; page state stays in memory for unload / Ctrl+Shift+T). The tab saver takes a *producer* that only runs when the debounced write happens (1 s quiet, **5 s max wait** so a ticking title can't postpone it forever). Favicons go through the same 16 KB `data:` cap as history.
- **§4.2 restore.** The snapshot stays on the tab until `navigationHistory.restore()` settles (close / save / unload during the ~0.5 s restore keep the full stack); on failure with nothing committed the tab falls back to `loadURL`. Restores don't count as new history visits.
- **§4.2 auto-unload.** Also skips tabs that played audio in the last 5 min and tabs whose text fields / focused contenteditable hold typed content (checked in the page right before unloading; unknown counts as dirty). `discardInactive` is async.
- **§13 popups.** `about:blank` / empty-URL `new-window` requests are popups too ("open blank, then set location"). Popups are owned by the main window (`parent`), titled `host — title`, and capped at 3 concurrent per tab (extra http(s) ones open as tabs).
- **§12 downloads.** Shortcut / shell-handler types (`.scf .url .lnk .library-ms .search-ms .searchconnector-ms .settingcontent-ms .appref-ms`) are refused and listed as *Blocked*; executables / scripts are saved but clicking them only shows them in their folder. Interrupted → auto-resumed items return to *progressing*.
- **§6 permissions.** `openExternal` is allowed for `mailto:` / `tel:` only.
- **§7 address bar.** Internationalized hostnames (`bücher.de`, `例子.中国`, punycode) and underscores count as hosts.
- **§8 context menu.** `data:` / `blob:` images offer only Copy / Save.
- **§9 crash overlay.** "Wait" lives in App and un-suppresses the view (the hung page is shown again).
- **§11 find.** Switching tabs clears the previous tab's highlight in main.
- **§17 storage.** "Clear all site data" reloads every open tab afterwards; UI reports failures.
- **Known, pre-existing (not changed):** Chromium zoom is per-origin, so zooming a desktop tab also zooms other open tabs of the same host until they navigate.
