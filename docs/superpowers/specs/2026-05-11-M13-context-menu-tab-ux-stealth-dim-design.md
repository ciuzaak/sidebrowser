# M13 — Web context menu, Tab UX polish, Stealth-grade dim

**Status:** draft
**Author:** Claude (with user)
**Date:** 2026-05-11
**Supersedes / extends:**
- §M5 EdgeDock dim
- §M6 SettingsDrawer + DimController
- §M8 keyboard-shortcuts (hidden Application Menu)

---

## 1. Motivation

After M12 the daily-use surface has three rough edges:

1. **No web context menu** — right-clicking a page does nothing. There is no way to copy a link address, open a link in a new tab, or kick the page out to the system browser.
2. **Tab drawer is permanent + Ctrl+Tab is a toggle** — the drawer never auto-collapses, and Ctrl+Tab opens the drawer rather than cycling tabs the way every mainstream browser does.
3. **Dim is shallow** — `light` brightness can never reach pure white (it's `filter: brightness(N)`, multiplicative), and dim affects only the page WebContentsView, not the chrome (TopBar / TabDrawer / SettingsDrawer) or the OS-rendered window title. The "I'm not browsing right now" disguise is too obviously a browser.

This milestone closes those three gaps.

## 2. Scope

In:
- Web context menu with three context tiers (page / link / text-selection).
- TabDrawer auto-collapses on outside click; SettingsDrawer follows the same pattern for symmetry.
- `Ctrl+Tab` cycles tabs (linear, by `tabOrder`); drawer auto-shows during the cycle and auto-hides on `Ctrl` release.
- Settings drawer auto-closes when the active tab changes (covers drawer-click and Ctrl+Tab cycle).
- `light` dim becomes a white overlay (semantics shift from "brightness multiplier" to "white opacity").
- Dim effect applies to chrome (TopBar / TabDrawer / SettingsDrawer / NewTab).
- Dim activation also clears the OS window title text.

Out:
- Right-click menus on chrome elements (TopBar buttons, TabDrawer items). Default browser empty menu remains.
- Inspect / DevTools entry in the context menu — F12 already exists and is intentionally not surfaced in v1.
- Symmetric "dark = black overlay" rewrite — `brightness(0)` already reaches pure black; no functional gap.
- Frameless window / custom window controls — too large for this milestone.
- Mobile-view multi-touch gestures (pinch / two-finger pan). Was originally bullet 3 of the user request; deferred.

## 3. Web context menu

### 3.1 Wiring point

In `src/main/view-manager.ts`, inside `attachWebContentsEvents`:

```ts
const onContextMenu = (e: Electron.Event, params: Electron.ContextMenuParams): void => {
  e.preventDefault();
  const template = buildContextMenuTemplate(params, deps, getCurrentTabUrl());
  Menu.buildFromTemplate(template).popup({ window: this.window });
};
wc.on('context-menu', onContextMenu);
// Returned detach closure also off()'s this listener.
```

`Menu` is imported via the existing `createRequire` lazy-load idiom (matches `keyboard-shortcuts.ts`), so unit tests of the pure builder don't pull in `electron`.

### 3.2 Pure builder

```ts
export interface ContextMenuDeps {
  openInSystemBrowser: (url: string) => void;          // shell.openExternal
  openInNewTab: (url: string) => void;                  // viewManager.createTab
  copyToClipboard: (text: string) => void;              // clipboard.writeText
  searchSelection: (query: string) => void;             // resolves search engine, createTab
  viewSource: (url: string) => void;                    // createTab(`view-source:${url}`)
  navigateActive: (action: 'back' | 'forward' | 'reload') => void;
  canGoBack: boolean;
  canGoForward: boolean;
  activeSearchEngineName: string;                       // for menu label
}

export function buildContextMenuTemplate(
  params: Electron.ContextMenuParams,
  deps: ContextMenuDeps,
  currentTabUrl: string,
): MenuItemConstructorOptions[];
```

Template assembly (top-to-bottom render order):

1. **Selection block** (only if `params.selectionText.trim() !== ''`):
   - `复制` — `clipboard.writeText(params.selectionText)`
   - `用 {engineName} 搜索 "{trunc30}"` — `deps.searchSelection(selectionText)`
   - separator

2. **Link block** (only if `params.linkURL !== ''`):
   - `在新标签页打开链接` — `openInNewTab(linkURL)`
   - `在系统浏览器打开链接` — `openInSystemBrowser(linkURL)`
   - `复制链接地址` — `copyToClipboard(linkURL)`
   - separator

3. **Page block** (always):
   - `后退` — `navigateActive('back')`, `enabled: canGoBack`
   - `前进` — `navigateActive('forward')`, `enabled: canGoForward`
   - `刷新` — `navigateActive('reload')`
   - separator
   - `在系统浏览器打开此页` — `openInSystemBrowser(currentTabUrl)`
   - `复制此页 URL` — `copyToClipboard(currentTabUrl)`
   - separator
   - `查看源代码` — `viewSource(currentTabUrl)`

Truncation rule: `selectionText.replace(/\s+/g, ' ').trim().slice(0, 30)` + `…` if longer. No HTML in label (Electron does no parsing — but keep ASCII safe regardless).

### 3.3 Action implementations (main side)

Wired as deps from `index.ts`, hand-rolled per-window (matches Application Menu pattern):

- `openInSystemBrowser`: `shell.openExternal(url)` after `sanitizeUrl(url)`. URLs that fail sanitize → `console.warn` + no-op (defensive: someone could craft a `javascript:` link).
- `openInNewTab`: `viewManager.createTab(url)` (already passes through `sanitizeUrl`).
- `searchSelection`: read `settingsStore.get().search` → `engines.find(e => e.id === activeId)?.urlTemplate ?? google` → `template.replace('{query}', encodeURIComponent(text))` → `viewManager.createTab(url)`.
- `viewSource`: `viewManager.createTab(\`view-source:${url}\`)` — Electron's WebContents handles `view-source:` natively.
- `navigateActive`: thin delegations to `viewManager.{goBackActive,goForwardActive,reloadActive}`.

### 3.4 Tests

- Unit: `buildContextMenuTemplate` — six matrix cases (page-only / link / selection / link+selection / page-with-canGoBack=false / engineName interpolation). Snapshot-style assertions on `label` / `enabled` / `click` presence.
- E2E: page right-click → menu visible; link right-click → "在系统浏览器打开链接" present; select text → "用 {engine} 搜索" present + label correctly truncated.

## 4. Tab UX polish

### 4.1 Auto-collapse on outside click

State change: TabDrawer now closes whenever a `mousedown` lands outside it (outside the toggle button).

Three pieces:

1. **App suppresses the WebContentsView while drawer is open** — same source-list union pattern as today (`suppressed = settingsOpen || suggestionsOpen || isNewTab || drawerOpen`). Without this, mousedown on the page area lives entirely inside the native WebContentsView and the renderer never sees it, so the drawer would stay open until the user clicks chrome.

2. **TabDrawer registers a document-level `mousedown` listener while open**:

   ```ts
   useEffect(() => {
     if (!open) return;
     const onDown = (e: MouseEvent): void => {
       const target = e.target as Node;
       if (drawerRef.current?.contains(target)) return;
       if (toggleButtonRef.current?.contains(target)) return;
       onClose();
     };
     document.addEventListener('mousedown', onDown);
     return () => document.removeEventListener('mousedown', onDown);
   }, [open, onClose]);
   ```

3. **Toggle button ref** — lifted into App so TabDrawer knows what counts as "the button" (otherwise clicking the toggle would close-then-reopen). Implementation: App holds `toggleButtonRef`, passes to both TopBar (as the `ref`) and TabDrawer (as `toggleRef` prop).

SettingsDrawer gets the same treatment for symmetry — it currently relies on the explicit X button. Outside-click now also closes it (settings X button kept for discoverability).

### 4.2 Ctrl+Tab cycling

Goal: hold `Ctrl`, press `Tab` to advance to the next tab (by `tabOrder`); `Shift+Ctrl+Tab` reverses; release `Ctrl` to commit. Drawer is shown for visual feedback during the cycle and auto-hides on release.

#### Why not Application Menu accelerators

Electron's `Menu.setApplicationMenu` accelerators fire on key-down only. We need key-up detection to know when the user releases `Ctrl`. So `CmdOrCtrl+Tab` is removed from the Application Menu template; the cycle is driven by `before-input-event` on every WebContents.

#### TabCycler (new module — `src/main/tab-cycler.ts`)

Pure-ish controller. Owns:
- A `cycling: boolean` flag.
- A "broadcast cycle state" callback (renderer fan-out).

API:

```ts
interface TabCyclerDeps {
  activateNext: () => void;
  activatePrev: () => void;
  broadcastCycleState: (active: boolean) => void;
}

class TabCycler {
  constructor(deps: TabCyclerDeps);
  /** Attach before-input-event on a WebContents. Returns detach. */
  attach(wc: Electron.WebContents): () => void;
  /** Force-end the cycle (used when window loses focus mid-cycle — defensive). */
  end(): void;
}
```

Per-WebContents `before-input-event` handler:

```ts
const onInput = (e: Electron.Event, input: Electron.Input): void => {
  if (input.type === 'keyDown' && input.key === 'Tab' && input.control && !input.alt && !input.meta) {
    e.preventDefault();
    if (input.shift) deps.activatePrev(); else deps.activateNext();
    if (!cycling) { cycling = true; deps.broadcastCycleState(true); }
    return;
  }
  if (input.type === 'keyUp' && input.key === 'Control' && cycling) {
    cycling = false;
    deps.broadcastCycleState(false);
  }
};
```

Wiring (in `index.ts`):

```ts
const cycler = new TabCycler({
  activateNext: () => viewManager.activateRelativeTab(+1),
  activatePrev: () => viewManager.activateRelativeTab(-1),
  broadcastCycleState: (active) =>
    !win.isDestroyed() && win.webContents.send(IpcChannels.cycleState, { active }),
});
cycler.attach(win.webContents);
viewManager.onTabAttach((wc) => cycler.attach(wc));
win.on('blur', () => cycler.end());
```

`viewManager.onTabAttach` is a new lifecycle hook — fires whenever a tab is created so the cycler can install its listener on the new tab's wc. Detach happens implicitly via `wc.close()` in `closeTab`.

`viewManager.activateRelativeTab(delta)` is a new method:
- Compute `tabOrder.indexOf(activeId)`, `(idx + delta + N) % N`, activate that id.
- No-op when `tabs.size <= 1`.

#### Defensive end conditions

- Window blur → call `cycler.end()` (otherwise drawer would stay shown if user alt-tabs out mid-cycle).
- The next `keyDown` of any non-Tab key while cycling → if it's `Control` released through some other path (rare on Windows: Ctrl key being held when window loses focus then refocused without keyup event), the next tab activation will re-emit `cycle:active=true` anyway — idempotent broadcast.

#### IPC

```
cycle:state — M→R event, payload { active: boolean }
```

Renderer: new `useTabCycleStore` (or fold into existing `useTabsStore`) holding `cycling: boolean`. App.tsx:

```ts
const cycling = useTabCycleStore((s) => s.cycling);
const drawerOpen = userToggledDrawer || cycling;
```

The drawer renders whenever either the user toggle is true OR the cycle is active. Outside-click closing only fires on the user-toggle source (cycle close is owned by TabCycler).

### 4.3 Settings auto-close on tab switch

In `App.tsx`:

```ts
const activeId = useTabsStore((s) => s.activeId);
useEffect(() => {
  if (settingsOpen) closeSettings();
}, [activeId]);
```

The single `activeId` dependency covers all three triggers: TabDrawer click → ViewManager.activateTab → store updates → effect fires; Ctrl+Tab cycle → same path; main-side auto-reactivation (e.g. closing a tab) → same path.

Note: this is `closeSettings` only when the *id* changes. A noisy re-render with the same activeId won't close.

### 4.4 Tests

- Unit: `TabCycler` — fake WebContents + injected deps, drive `keyDown Tab` / `keyDown Shift+Tab` / `keyUp Control` sequences, assert `activateNext/activatePrev/broadcastCycleState` calls.
- Unit: `viewManager.activateRelativeTab` — wrap mod arithmetic edge cases (single tab, wrap at end, wrap at start).
- E2E: drawer opens on Ctrl+Tab, second Tab advances active tab, releasing Ctrl closes drawer; outside-click closes drawer; clicking a tab in drawer while settings open closes settings; Ctrl+Tab while settings open closes settings.

## 5. Light = white overlay

### 5.1 CSS change

`buildFilterCSS('light', dim)` returns:

```css
html::after {
  content: '';
  position: fixed;
  inset: 0;
  background: white;
  opacity: 0.5;             /* dim.lightBrightness */
  pointer-events: none;
  z-index: 2147483647;
  transition: opacity 150ms ease-out;   /* dim.transitionMs; omitted when 0 */
}
```

`html { filter: ... }` is no longer emitted for `light`. `dark` and `blur` unchanged.

### 5.2 Settings clamp + slider

`clampDim`:

```ts
if (partial.lightBrightness !== undefined) {
  out.lightBrightness = clamp(partial.lightBrightness, 0, 1);   // was [1, 3]
}
```

Old persisted values >1 → clamp to 1 on the next read-then-write cycle. One-time visual diff (overshoots to fully white) the first dim cycle after upgrade; user can re-adjust in seconds.

DEFAULTS:

```ts
dim: { ..., lightBrightness: 0.5, ... }   // was 1.5
```

`SettingsDrawer.tsx` — light slider: `min={0} max={1} step={0.05}`, label changes to "白度" (was "亮度倍数"), reset target = `0.5`.

### 5.3 Field name — kept

We deliberately keep the field name `lightBrightness` despite the semantic shift. Renaming touches:
- `@shared/types`
- `clamp-settings.ts`
- `SettingsDrawer.tsx`
- `build-filter-css.ts`
- All test fixtures
- Migration logic in `SettingsStore` (read old key, write new)

The label in the UI gets the new wording; the JSON key is plumbing. Worth a future refactor (M14 cleanup), not in scope here.

## 6. Chrome dim + title clear

### 6.1 Chrome dim — re-use existing `windowState.dimmed` signal

`EdgeDock.broadcastState({ docked, hidden, dimmed })` already runs on every dim toggle, and renderer's `useWindowStateStore` already exposes `dimmed`. No new IPC needed.

In `App.tsx`, wrap the chrome root:

```tsx
const dimmed = useWindowStateStore((s) => s.dimmed);
const dim = useSettingsStore((s) => s.settings?.dim);

const chromeStyle = computeChromeDimStyle(dimmed, dim);
return (
  <div className="flex h-full w-full flex-col" style={chromeStyle.rootStyle}>
    {/* ... */}
    {chromeStyle.overlay}
  </div>
);
```

`computeChromeDimStyle(dimmed, dim)` — pure helper in a new file `src/renderer/src/lib/chrome-dim.ts`:

| effect  | rootStyle                          | overlay                           |
|---------|------------------------------------|-----------------------------------|
| `none`  | `{}`                               | null                              |
| `blur`  | `{ filter: 'blur(Npx)', transition }` | null                           |
| `dark`  | `{ filter: 'brightness(N)', transition }` | null                       |
| `light` | `{}`                               | white overlay div same as §5.1   |

`transition: 'filter Tms ease-out'` (or `opacity` for light overlay), reads `dim.transitionMs`.

When `dimmed === false`, return `{ rootStyle: {}, overlay: null }` regardless of effect.

#### Z-order note

WebContentsView is rendered above the renderer's DOM in the page area. So the chrome overlay only visibly covers the actual chrome region (TopBar / TabDrawer / NewTab / SettingsDrawer when shown). The page area is covered by the page-side overlay set via `dim.apply(activeWc, dim)` in §5.1. Two overlays in two layers with no overlap give full coverage.

### 6.2 Window title

In `index.ts`, wrap the `applyDim` / `clearDim` deps fed into `EdgeDock`:

```ts
const APP_TITLE = 'sidebrowser';

const edgeDock = new EdgeDock({
  // ...
  applyDim: () => {
    const wc = viewManager.getActiveWebContents();
    if (wc) void dim.apply(wc, settingsStore.get().dim);
    if (!win.isDestroyed()) win.setTitle('');
  },
  clearDim: () => {
    void dim.clear();
    if (!win.isDestroyed()) win.setTitle(APP_TITLE);
  },
  // ...
});
```

Effect: while dimmed, the OS title text is empty — Alt+Tab tooltip / taskbar hover / window title bar all show no string. Window border + close button remain (we did not opt for `frame: false`).

### 6.3 Tests

- Unit: `computeChromeDimStyle` — four effect × dimmed=true/false matrix.
- E2E: trigger dim (mouse-leave + dim delay) → chrome root has expected `filter` style → window title is `''` → trigger un-dim → chrome style cleared → title back to `'sidebrowser'`.

## 7. Architecture summary

| Concern              | New / changed file                                       | Cross-process? |
|----------------------|----------------------------------------------------------|----------------|
| Context menu builder | `src/main/context-menu.ts` (new, pure)                   | no             |
| Context menu wiring  | `src/main/view-manager.ts` (modify)                      | main           |
| Context menu deps    | `src/main/index.ts` (modify, deps construction)          | main           |
| TabCycler            | `src/main/tab-cycler.ts` (new)                           | main           |
| activateRelativeTab  | `src/main/view-manager.ts` (modify)                      | main           |
| Drop Ctrl+Tab accel  | `src/main/keyboard-shortcuts.ts` (modify, remove 1 row)  | main           |
| `cycle:state` IPC    | `src/shared/ipc-contract.ts` (modify)                    | shared         |
| Cycle store          | `src/renderer/src/store/tab-store.ts` (modify, +cycling) | renderer       |
| TabDrawer outside-click | `src/renderer/src/components/TabDrawer.tsx` (modify)  | renderer       |
| SettingsDrawer outside-click | `src/renderer/src/components/SettingsDrawer.tsx` (modify) | renderer |
| Drawer in suppression source | `src/renderer/src/App.tsx` (modify)              | renderer       |
| Auto-close settings on tab switch | `src/renderer/src/App.tsx` (modify)         | renderer       |
| Light overlay CSS    | `src/main/build-filter-css.ts` (modify)                  | main           |
| Light clamp + default| `src/main/clamp-settings.ts`, `src/shared/settings-defaults.ts` (modify) | shared/main |
| Light slider         | `src/renderer/src/components/SettingsDrawer.tsx` (modify) | renderer      |
| Chrome dim helper    | `src/renderer/src/lib/chrome-dim.ts` (new, pure)         | renderer       |
| Chrome dim wiring    | `src/renderer/src/App.tsx` (modify)                      | renderer       |
| Title clear          | `src/main/index.ts` (modify, EdgeDock deps)              | main           |

## 8. Risks + open questions

- **Selection menu translation collision** — `用 Google 搜索 "..."` is fine but if the user has set a Chinese-name custom engine, the label can get long. Acceptable; menu auto-wraps in Electron native menus on Windows.
- **`view-source:` may be deprecated by future Chromium** — Electron currently supports it. If/when it goes away, swap to a simple "save page as text" or DevTools-source toggle.
- **`before-input-event` and IME composition** — `Ctrl+Tab` does not interact with IME (modifier-only path); not a concern.
- **Cycle drawer flicker on single keystroke** — first `Ctrl+Tab` press shows drawer + activates next; user could release `Ctrl` 30ms later. Drawer flashes briefly. Acceptable — matches Edge behavior.
- **`win.setTitle('')` and accessibility** — screen readers may announce the empty title. Not a v1 concern (Windows-only, no a11y hard requirement). Restored on dim clear.
- **Drawer outside-click while NewTab is showing** — NewTab is a renderer-layer page. Clicking on it should close the drawer (it's not the drawer's content). The mousedown will land in the NewTab DOM, the listener will see "not in drawer" → close. Correct behavior.

## 9. Migration

- Persisted `dim.lightBrightness` values >1 → `clampDim` snaps to 1 on next write. No explicit migration step.
- No persisted state shape changes.
- No new settings sections.

## 10. Done definition

- All unit tests added pass.
- All E2E specs in §3.4, §4.4, §6.3 pass.
- Manual smoke (user-owned): right-click menu in three contexts; Ctrl+Tab cycling forward + reverse + release; drawer outside-click; settings → switch tab; light at 1.0 = pure white over a dark page; dim activates → chrome blurs/dims/whitens + title bar text empty; un-dim → restored.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e` green.
- No regressions on existing M1–M12 E2E.
