# M17 — Chrome polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the address pill ~3× the width by replacing the Windows-native caption buttons with self-drawn Minimize/Close and folding Reload + UA toggle into the pill; stop page reflows when chrome overlays open (`setVisible` suppression + TabDrawer top inset); make Spotlight one card over a blurred page snapshot; polish favicons, scrollbars, settings controls and NewTab.

**Architecture:** Main gains a pure `computeViewLayout` helper that `ViewManager.applyBounds` applies per tab (bounds + `View.setVisible`), plus a `topInsetPx` that offsets — but never resizes — the active view. Five new IPC channels (`window:minimize`, `window:close`, `tab:stop`, `view:set-top-inset`, `view:capture-active`) and one more in Task 12 (`history:top-sites`). Renderer changes are component-level; pure string/layout logic lives in `src/renderer/src/lib/*` with Vitest coverage.

**Tech Stack:** Electron 41 (`View.setVisible`, `webContents.capturePage`), React 19, TypeScript strict, Tailwind v4, Vitest, Playwright `_electron`, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-08-M17-chrome-polish-design.md`.

**Conventions (from memory, apply throughout):** per-task report (SHA, spec verdict, quality verdict); stop and ask before changing this plan; all UI strings English; manual smoke + tagging belong to the user. Every Electron command goes through `node scripts/run.mjs …` (strips `ELECTRON_RUN_AS_NODE`).

**File responsibilities (lock in):**

| File | Action | Responsibility |
|---|---|---|
| `src/main/view-layout.ts` | Create | Pure `computeViewLayout()`. No Electron runtime import. |
| `tests/unit/view-layout.test.ts` | Create | Unit suite for the helper. |
| `src/main/view-manager.ts` | Modify | Apply layout + visibility; `setTopInset`; `stop`; `captureActiveForBackdrop`; test getter. |
| `src/shared/ipc-contract.ts` | Modify | 6 new channels + contracts. |
| `src/shared/types.ts` | Modify | `TopSite`. |
| `src/preload/index.ts` | Modify | Expose new APIs. |
| `src/main/ipc-router.ts` | Modify | Register new handlers. |
| `tests/unit/ipc-contract.test.ts` | Modify | Channel-name assertions. |
| `src/main/index.ts` | Modify | Drop `titleBarOverlay`; `maximizable: false`; new test hooks. |
| `src/main/title-bar-overlay.ts` | Delete | — |
| `tests/unit/title-bar-overlay.test.ts` | Delete | — |
| `src/renderer/src/styles/globals.css` | Modify | New tokens, `color-scheme`, scrollbars, `mac-select`, slider fill, load bar, font stack. |
| `src/renderer/src/lib/chrome-labels.ts` | Create | `pillLabelFor`, `schemeIconFor`, `formatTabCount`, `tabLabel`. |
| `src/renderer/src/lib/split-match.ts` | Create | `splitMatch`. |
| `src/renderer/src/lib/spotlight-hint.ts` | Create | `spotlightHint`, `withTimeout`. |
| `tests/unit/chrome-labels.test.ts` | Create | — |
| `tests/unit/split-match.test.ts` | Create | — |
| `tests/unit/spotlight-hint.test.ts` | Create | — |
| `src/renderer/src/components/WindowControls.tsx` | Create | Minimize + Close. |
| `src/renderer/src/components/TopBar.tsx` | Rewrite | New layout, AddressPill, badge, load bar. |
| `src/renderer/src/components/TabDrawer.tsx` | Modify | Page-area overlay, top-inset reporting, labels, Favicon. |
| `src/renderer/src/components/Favicon.tsx` | Modify | Tile. |
| `src/renderer/src/components/AddressSuggestions.tsx` | Modify | In-flow list, match emphasis, `onHighlightChange`. |
| `src/renderer/src/components/SearchSpotlight.tsx` | Modify | Backdrop img, scrim, single card, hint footer. |
| `src/renderer/src/App.tsx` | Modify | Layout move, async `openSearch` + backdrop state. |
| `src/renderer/src/components/SettingsDrawer.tsx` | Modify | `SelectField`, slider fill, Dim conditional sliders. |
| `src/main/suggestion-ranker.ts` | Modify | `topSites()`. |
| `tests/unit/suggestion-ranker.test.ts` | Modify | `topSites` block. |
| `src/renderer/src/components/NewTab.tsx` | Modify | Compact hero, Frequent grid. |
| `scripts/generate-app-icon.mjs` | Modify | Also emit `resources/newtab-icon.png`. |
| `resources/newtab-icon.png` | Create (generated) | 128 px hero icon. |
| `electron.vite.config.ts` | Modify | Renderer `minify: true`. |
| `tests/e2e/m17-chrome.spec.ts` | Create | M17 behavior suite. |
| `tests/e2e/settings-drawer.spec.ts` | Modify | Test 1 asserts visibility. |
| `tests/e2e/navigation.spec.ts` | Modify | Load fence on `data-loading`. |

---

## Task 0: Commit spec + plan

- [ ] **Step 1:** `git checkout -b m17-chrome-polish` (repo is on `main`).
- [ ] **Step 2:** Commit both docs:

```bash
git add docs/superpowers/specs/2026-10-08-M17-chrome-polish-design.md docs/superpowers/plans/2026-10-08-M17-chrome-polish.md
git commit -m "docs(M17): chrome polish — design + implementation plan"
```

---

## Task 1: Spike — gate the risky platform assumptions

No production code. Write a throwaway Electron script **in the scratchpad**, not the repo.

**Files:** scratchpad only (e.g. `<scratchpad>/m17-spike/main.cjs`).

- [ ] **Step 1: Minimal app.** `BrowserWindow` 393×852, `titleBarStyle: 'hidden'`, **no** `titleBarOverlay`, `maximizable: false`. One `WebContentsView` at `{x:0,y:36,width:393,height:816}` loading a `data:` page that:
  - is 3000 px tall with a visible marker every 100 px;
  - counts `resize` events and logs `document.visibilityState` on `visibilitychange` into `window.__log`.

- [ ] **Step 2: Measure / observe** (launch with `node scripts/run.mjs <repo>/node_modules/.bin/electron.cmd <spike>/main.cjs`, drive via a timer sequence inside `main.cjs` and print JSON results to stdout):
  1. **setVisible(false):** take a screen capture of the window region (PowerShell `System.Drawing.Graphics.CopyFromScreen` → PNG; Read the PNG) → the view area must show the host background, not the page. Record `visibilityState`.
  2. **setVisible(true):** page reappears; `scrollY` preserved (scroll to 1200 first); `resize` count unchanged.
  3. **Offset without resize:** `setBounds({x:0,y:236,width:393,height:816})` → screen capture shows the page shifted down 200 px and clipped at the window bottom; `resize` count unchanged; `innerHeight` unchanged.
  4. **capturePage latency:** 20 × `await wc.capturePage()` + `resize({width: half})` + `toJPEG(70)`; report p50/p95 ms and JPEG byte size.
  5. **Frame:** `win.isResizable() === true`, `win.isMaximizable() === false`.

- [ ] **Step 3: Report** the five results to the user.

**Gate:** if (1), (2) or (3) fails, **stop** and surface options (spec §14 fallbacks). If (4) p95 > 150 ms, report it — the 150 ms race in Task 10 will fall back to no-backdrop more often; ask whether to proceed.

---

## Task 2: `computeViewLayout` (TDD) + ViewManager wiring

**Files:**
- Create: `src/main/view-layout.ts`, `tests/unit/view-layout.test.ts`
- Modify: `src/main/view-manager.ts`

- [ ] **Step 1: Failing tests** — `tests/unit/view-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeViewLayout } from '../../src/main/view-layout';

const base = {
  contentWidth: 393,
  contentHeight: 852,
  chromeHeightPx: 36,
  topInsetPx: 0,
  suppressed: false,
  isActive: true,
};

describe('computeViewLayout', () => {
  it('active tab fills the area below the chrome', () => {
    expect(computeViewLayout(base)).toEqual({
      bounds: { x: 0, y: 36, width: 393, height: 816 },
      visible: true,
    });
  });

  it('top inset offsets y but keeps height (view clipped, never resized)', () => {
    expect(computeViewLayout({ ...base, topInsetPx: 120 })).toEqual({
      bounds: { x: 0, y: 156, width: 393, height: 816 },
      visible: true,
    });
  });

  it('suppressed active tab keeps its bounds and is hidden', () => {
    expect(computeViewLayout({ ...base, suppressed: true })).toEqual({
      bounds: { x: 0, y: 36, width: 393, height: 816 },
      visible: false,
    });
  });

  it('background tab is zero-sized and visible regardless of suppression', () => {
    const zero = { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: true };
    expect(computeViewLayout({ ...base, isActive: false })).toEqual(zero);
    expect(computeViewLayout({ ...base, isActive: false, suppressed: true })).toEqual(zero);
  });

  it('clamps negative sizes to zero', () => {
    const r = computeViewLayout({ ...base, contentWidth: -5, contentHeight: 10, chromeHeightPx: 36 });
    expect(r.bounds.width).toBe(0);
    expect(r.bounds.height).toBe(0);
  });
});
```

- [ ] **Step 2:** `node scripts/run.mjs node_modules/.bin/vitest.cmd run tests/unit/view-layout.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/main/view-layout.ts`:

```ts
/**
 * Pure per-tab view layout (M17). ViewManager.applyBounds() applies the
 * result to every tab's WebContentsView.
 *
 * - The active view's height never includes `topInsetPx`: while the TabDrawer
 *   is open the view slides down and its bottom is clipped by the window, so
 *   the page is never resized (no reflow, no mobile-emulation reapply).
 * - Suppression hides the active view via View.setVisible(false) instead of
 *   shrinking it to zero, for the same reason.
 * - Background tabs stay zero-sized (unchanged since M2; revisiting that is M16).
 */
export interface ViewLayoutInput {
  contentWidth: number;
  contentHeight: number;
  chromeHeightPx: number;
  topInsetPx: number;
  suppressed: boolean;
  isActive: boolean;
}

export interface ViewLayout {
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export function computeViewLayout(i: ViewLayoutInput): ViewLayout {
  if (!i.isActive) {
    return { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: true };
  }
  return {
    bounds: {
      x: 0,
      y: i.chromeHeightPx + i.topInsetPx,
      width: Math.max(0, i.contentWidth),
      height: Math.max(0, i.contentHeight - i.chromeHeightPx),
    },
    visible: !i.suppressed,
  };
}
```

- [ ] **Step 4:** Re-run → PASS.

- [ ] **Step 5: Wire into ViewManager** (`src/main/view-manager.ts`):
  1. `import { computeViewLayout } from './view-layout';`
  2. Field next to `chromeHeightPx`: `private topInsetPx = 0;`
  3. Replace the body of `applyBounds()` after the `isDestroyed` guard:

```ts
    const { width, height } = this.window.getContentBounds();
    for (const [id, managed] of this.tabs) {
      const { bounds, visible } = computeViewLayout({
        contentWidth: width,
        contentHeight: height,
        chromeHeightPx: this.chromeHeightPx,
        topInsetPx: this.topInsetPx,
        suppressed: this.suppressed,
        isActive: id === this.activeId,
      });
      managed.view.setBounds(bounds);
      managed.view.setVisible(visible);
    }
```

  (The old `if (this.suppressed) { …zero… return; }` branch is deleted.)

  4. New public methods (place after `setSuppressed`):

```ts
  /**
   * M17: TabDrawer overlay height. Offsets the active view down without
   * changing its size (see computeViewLayout). Unlike setChromeHeight this
   * does NOT reapply mobile emulation — the emulated viewport is unchanged.
   */
  setTopInset(px: number): void {
    const clamped = Math.max(0, Math.round(px));
    if (clamped === this.topInsetPx) return;
    this.topInsetPx = clamped;
    this.applyBounds();
  }

  /** M17: Stop button in the address pill. */
  stop(id: string): void {
    this.tabs.get(id)?.view.webContents.stop();
  }

  /**
   * M17: half-resolution JPEG snapshot of the active page for the Spotlight
   * backdrop. Null when there is nothing visible to capture (no active tab,
   * already suppressed, empty image) or capture fails.
   */
  async captureActiveForBackdrop(): Promise<string | null> {
    const wc = this.getActiveWebContents();
    if (!wc || wc.isDestroyed() || this.suppressed) return null;
    try {
      const img = await wc.capturePage();
      if (img.isEmpty()) return null;
      const width = Math.max(1, Math.round(img.getSize().width / 2));
      const jpeg = img.resize({ width, quality: 'good' }).toJPEG(70);
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err) {
      console.error('[sidebrowser] captureActiveForBackdrop failed:', err);
      return null;
    }
  }

  /** E2E hook: whether the active tab's view is currently drawn. */
  getActiveViewVisibleForTest(): boolean | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId)?.view.getVisible() ?? null;
  }
```

  5. Update the `setSuppressed` JSDoc: "While suppressed, the active tab's view is hidden via `View.setVisible(false)` (bounds unchanged, so the page does not reflow)…". Update the class JSDoc line about background tabs only if wording now contradicts.

- [ ] **Step 6:** `typecheck` + full unit suite green.

- [ ] **Step 7: Commit** — `feat(M17): view layout helper — setVisible suppression + top inset`.

---

## Task 3: IPC — window controls, stop, top inset, capture

**Files:** `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc-router.ts`, `src/main/index.ts` (hooks only), `tests/unit/ipc-contract.test.ts`

- [ ] **Step 1: Failing test** — append to `tests/unit/ipc-contract.test.ts`:

```ts
  it('defines M17 chrome channels', () => {
    expect(IpcChannels.windowMinimize).toBe('window:minimize');
    expect(IpcChannels.windowClose).toBe('window:close');
    expect(IpcChannels.tabStop).toBe('tab:stop');
    expect(IpcChannels.viewSetTopInset).toBe('view:set-top-inset');
    expect(IpcChannels.viewCaptureActive).toBe('view:capture-active');
  });
```

Run → FAIL.

- [ ] **Step 2: Channels** — add to `IpcChannels`:

```ts
  /** R→M send (M17). Self-drawn window controls. */
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  /** R→M invoke (M17). Stop button in the address pill. */
  tabStop: 'tab:stop',
  /** R→M send (M17). TabDrawer overlay height; offsets the active view. */
  viewSetTopInset: 'view:set-top-inset',
  /** R→M invoke (M17). Half-res JPEG data URL of the active page, or null. */
  viewCaptureActive: 'view:capture-active',
```

Contracts (in `IpcContract`):

```ts
  [IpcChannels.windowMinimize]: { request: Record<string, never>; response: void };
  [IpcChannels.windowClose]: { request: Record<string, never>; response: void };
  [IpcChannels.tabStop]: { request: { id: string }; response: void };
  [IpcChannels.viewSetTopInset]: { request: { px: number }; response: void };
  [IpcChannels.viewCaptureActive]: { request: Record<string, never>; response: string | null };
```

Also update the `viewSetSuppressed` contract comment: "hides the active view (View.setVisible(false)); bounds unchanged".

- [ ] **Step 3: Preload** — add to `api`:

```ts
  stop: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabStop, { id }),

  /** R→M send (M17). TabDrawer reports its overlay height; 0 on close. */
  setTopInset: (px: number): void => {
    ipcRenderer.send(IpcChannels.viewSetTopInset, { px });
  },
  /** R→M invoke (M17). Spotlight backdrop snapshot. */
  captureActiveView: (): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.viewCaptureActive, {}),

  minimizeWindow: (): void => {
    ipcRenderer.send(IpcChannels.windowMinimize, {});
  },
  closeWindow: (): void => {
    ipcRenderer.send(IpcChannels.windowClose, {});
  },
```

- [ ] **Step 4: Router** — in `registerIpcRouter`, following the existing patterns (handlers guarded by `removeHandler`; `ipcMain.on` listeners released on `window.once('closed')`):

```ts
  ipcMain.removeHandler(IpcChannels.tabStop);
  ipcMain.handle(
    IpcChannels.tabStop,
    (_event, payload: IpcContract[typeof IpcChannels.tabStop]['request']) => {
      viewManager.stop(payload.id);
    },
  );

  ipcMain.removeHandler(IpcChannels.viewCaptureActive);
  ipcMain.handle(IpcChannels.viewCaptureActive, () => viewManager.captureActiveForBackdrop());

  const onSetTopInset = (
    _event: IpcMainEvent,
    payload: IpcContract[typeof IpcChannels.viewSetTopInset]['request'],
  ): void => {
    viewManager.setTopInset(payload.px);
  };
  const onMinimize = (): void => {
    if (!window.isDestroyed()) window.minimize();
  };
  const onClose = (): void => {
    if (!window.isDestroyed()) window.close();
  };
  ipcMain.on(IpcChannels.viewSetTopInset, onSetTopInset);
  ipcMain.on(IpcChannels.windowMinimize, onMinimize);
  ipcMain.on(IpcChannels.windowClose, onClose);
  window.once('closed', () => {
    ipcMain.removeListener(IpcChannels.viewSetTopInset, onSetTopInset);
    ipcMain.removeListener(IpcChannels.windowMinimize, onMinimize);
    ipcMain.removeListener(IpcChannels.windowClose, onClose);
  });
```

- [ ] **Step 5: Test hooks** — in `src/main/index.ts` `__sidebrowserTestHooks`, add:

```ts
      // M17 hooks.
      getActiveViewVisible: (): boolean | null => viewManager.getActiveViewVisibleForTest(),
      getIsMinimized: (): boolean => !win.isDestroyed() && win.isMinimized(),
      restoreWindow: (): void => { if (!win.isDestroyed()) win.restore(); },
```

- [ ] **Step 6:** typecheck + unit green. **Commit** — `feat(M17): IPC — window controls, tab stop, top inset, view capture`.

---

## Task 4: Window chrome — drop `titleBarOverlay`

**Files:** `src/main/index.ts`; delete `src/main/title-bar-overlay.ts`, `tests/unit/title-bar-overlay.test.ts`

- [ ] **Step 1:** In `createWindow`:
  - Remove the `initialThemeChoice` parameter, the `initialOverlay` computation and the `titleBarOverlay: {…}` option.
  - Add `maximizable: false,` next to `titleBarStyle: 'hidden'`.
  - Replace the M14 frameless comment with: "M17: frameless (`titleBarStyle: 'hidden'`, thick frame keeps edge-resize). Window controls are self-drawn in the renderer (WindowControls.tsx); `maximizable: false` stops a double-click on the drag region from maximizing a side panel."
- [ ] **Step 2:** Delete `resolveActiveTheme` and `recomputeTitleBarOverlay`, the `resolveTitleBarOverlay` import, and both `recomputeTitleBarOverlay(…)` calls (in `onNativeThemeUpdated` and `settingsStore.onChanged`). `onNativeThemeUpdated` keeps its renderer broadcast.
- [ ] **Step 3:** Update both `createWindow(...)` call sites (primary + `activate`) to the new 2-arg signature.
- [ ] **Step 4:** `git rm src/main/title-bar-overlay.ts tests/unit/title-bar-overlay.test.ts`.
- [ ] **Step 5:** `grep -rn "titleBarOverlay\|title-bar-overlay\|TitleBarOverlay" src tests` → only comment hits allowed in `TopBar.tsx` / `SearchSpotlight.tsx` (rewritten later). typecheck + unit + lint green.
- [ ] **Step 6: Commit** — `feat(M17): drop native titleBarOverlay; maximizable false`.

> The window has no caption buttons between this commit and Task 7. Close via Alt+F4 during development.

---

## Task 5: Global CSS — tokens, color-scheme, scrollbars, select, slider fill, load bar, fonts

**Files:** `src/renderer/src/styles/globals.css`

- [ ] **Step 1: Tokens.** Append inside `:root[data-theme='dark']`:

```css
  color-scheme: dark;
  --danger: #c42b1c;
  --danger-fg: #ffffff;
  --scrim: rgba(0, 0, 0, 0.35);
  --favicon-tile: rgba(255, 255, 255, 0.88);
  --scrollbar-thumb: rgba(255, 255, 255, 0.18);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.3);
```

Inside `:root[data-theme='light']`:

```css
  color-scheme: light;
  --danger: #c42b1c;
  --danger-fg: #ffffff;
  --scrim: rgba(0, 0, 0, 0.18);
  --favicon-tile: transparent;
  --scrollbar-thumb: rgba(0, 0, 0, 0.22);
  --scrollbar-thumb-hover: rgba(0, 0, 0, 0.35);
```

- [ ] **Step 2: Font stack** — in the `html, body, #root` rule insert `'Microsoft YaHei UI',` after `'Segoe UI',`.

- [ ] **Step 3: Scrollbars** (append):

```css
/* ──────────────────────────────────────────────────────────────
   M17 — thin themed scrollbars (Chromium). Do NOT also set the
   standard scrollbar-width / scrollbar-color: Chromium ignores
   ::-webkit-scrollbar once those are present.
   ────────────────────────────────────────────────────────────── */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
  background-clip: content-box;
  border: 3px solid transparent;
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover {
  background-color: var(--scrollbar-thumb-hover);
}
::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
```

- [ ] **Step 4: Slider fill** — replace the background of `input[type='range'].mac-slider::-webkit-slider-runnable-track` (keep height/border/radius):

```css
  background: linear-gradient(
    to right,
    var(--accent) 0 var(--fill, 0%),
    var(--surface-sunken) var(--fill, 0%) 100%
  );
```

(`--fill` is set inline by the Slider component in Task 11. Leave the `-moz-` rules untouched.)

- [ ] **Step 5: Select** (append):

```css
/* M17 — styled <select>; chevron is a sibling icon (see SettingsDrawer SelectField). */
select.mac-select {
  appearance: none;
  -webkit-appearance: none;
  height: 28px;
  padding: 0 26px 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color 100ms ease;
}
select.mac-select:hover {
  border-color: var(--accent);
}
select.mac-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
```

- [ ] **Step 6: Load bar** (append):

```css
/* M17 — indeterminate top-bar loading bar, keyed on data-loading.
   Stateless: dropping the animation snaps width to 100% and fades out. */
.load-bar {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 2px;
  width: 100%;
  background: var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 250ms ease 150ms;
}
.load-bar[data-loading='true'] {
  opacity: 1;
  transition: none;
  animation: load-progress 4s cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
}
@keyframes load-progress {
  from { width: 0%; }
  to { width: 85%; }
}
```

- [ ] **Step 7:** `build` succeeds; `tests/e2e/macos-style.spec.ts` still passes (existing tokens untouched). **Commit** — `feat(M17): tokens, color-scheme, scrollbars, select, slider fill, load bar`.

---

## Task 6: WindowControls

**Files:** Create `src/renderer/src/components/WindowControls.tsx`

- [ ] **Step 1:**

```tsx
import type { ReactElement } from 'react';
import { Minus, X } from 'lucide-react';

/**
 * M17: self-drawn caption buttons (replaces the Windows-native
 * titleBarOverlay). Minimize + Close only — a side panel has no use for
 * Maximize (the BrowserWindow is `maximizable: false`).
 */
export function WindowControls(): ReactElement {
  const base =
    'flex h-full w-8 items-center justify-center text-[var(--fg)] transition-colors duration-100 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]';
  return (
    <div className="app-no-drag flex h-9 shrink-0 self-stretch">
      <button
        type="button"
        aria-label="Minimize"
        data-testid="window-minimize"
        onClick={() => window.sidebrowser.minimizeWindow()}
        className={base + ' hover:bg-[var(--accent-tint)]'}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label="Close"
        data-testid="window-close"
        onClick={() => window.sidebrowser.closeWindow()}
        className={base + ' hover:bg-[var(--danger)] hover:text-[var(--danger-fg)]'}
      >
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2:** typecheck. (Mounted in Task 7.) **Commit** — `feat(M17): WindowControls component`.

---

## Task 7: TopBar rewrite

**Files:**
- Create: `src/renderer/src/lib/chrome-labels.ts`, `tests/unit/chrome-labels.test.ts`
- Rewrite: `src/renderer/src/components/TopBar.tsx`
- Modify: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Failing tests** — `tests/unit/chrome-labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PILL_PLACEHOLDER,
  pillLabelFor,
  schemeIconFor,
  formatTabCount,
  tabLabel,
} from '../../src/renderer/src/lib/chrome-labels';

describe('pillLabelFor', () => {
  it('placeholder for blank', () => {
    expect(pillLabelFor('')).toBe(PILL_PLACEHOLDER);
    expect(pillLabelFor('about:blank')).toBe(PILL_PLACEHOLDER);
  });
  it('host only for http(s)', () => {
    expect(pillLabelFor('https://www.bilibili.com/video/x?y=1')).toBe('www.bilibili.com');
    expect(pillLabelFor('http://192.168.1.1:8080/a')).toBe('192.168.1.1:8080');
  });
  it('falls back to the raw string when there is no host or URL is malformed', () => {
    expect(pillLabelFor('file:///C:/x.html')).toBe('file:///C:/x.html');
    expect(pillLabelFor('not a url')).toBe('not a url');
  });
});

describe('schemeIconFor', () => {
  it('search for blank, lock for https, globe otherwise', () => {
    expect(schemeIconFor('about:blank')).toBe('search');
    expect(schemeIconFor('')).toBe('search');
    expect(schemeIconFor('https://a.com')).toBe('lock');
    expect(schemeIconFor('http://a.com')).toBe('globe');
    expect(schemeIconFor('file:///x')).toBe('globe');
  });
});

describe('formatTabCount', () => {
  it('hidden below 2, number up to 99, 99+ above', () => {
    expect(formatTabCount(0)).toBeNull();
    expect(formatTabCount(1)).toBeNull();
    expect(formatTabCount(2)).toBe('2');
    expect(formatTabCount(99)).toBe('99');
    expect(formatTabCount(100)).toBe('99+');
  });
});

describe('tabLabel', () => {
  it('New Tab for blank tabs', () => {
    expect(tabLabel({ url: 'about:blank', title: 'about:blank' })).toBe('New Tab');
    expect(tabLabel({ url: '', title: '' })).toBe('New Tab');
  });
  it('title, then url, then Loading…', () => {
    expect(tabLabel({ url: 'https://a.com', title: ' A ' })).toBe('A');
    expect(tabLabel({ url: 'https://a.com', title: '' })).toBe('https://a.com');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `src/renderer/src/lib/chrome-labels.ts`:

```ts
/** Pure label helpers for the chrome (M17). No React / DOM. */

export const PILL_PLACEHOLDER = 'Search or enter URL';

function isBlank(url: string): boolean {
  return url === '' || url === 'about:blank';
}

/** Address-pill text: host for real URLs, placeholder for blank. */
export function pillLabelFor(url: string): string {
  if (isBlank(url)) return PILL_PLACEHOLDER;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export type SchemeIcon = 'search' | 'lock' | 'globe';

export function schemeIconFor(url: string): SchemeIcon {
  if (isBlank(url)) return 'search';
  return url.toLowerCase().startsWith('https:') ? 'lock' : 'globe';
}

/** Tabs-button badge text; null hides the badge. */
export function formatTabCount(n: number): string | null {
  if (n < 2) return null;
  return n > 99 ? '99+' : String(n);
}

/** TabDrawer row label. */
export function tabLabel(tab: { url: string; title: string }): string {
  if (isBlank(tab.url)) return 'New Tab';
  return tab.title.trim() || tab.url || 'Loading…';
}
```

Run → PASS.

- [ ] **Step 3: Rewrite** `src/renderer/src/components/TopBar.tsx` (props interface unchanged):

```tsx
import { forwardRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft, ArrowRight, Globe, Layers, Lock, Monitor, RotateCw, Search, Settings, Smartphone, X,
} from 'lucide-react';
import { useActiveTab, useTabsStore } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import {
  PILL_PLACEHOLDER, formatTabCount, pillLabelFor, schemeIconFor, type SchemeIcon,
} from '../lib/chrome-labels';
import { WindowControls } from './WindowControls';

interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Spotlight-open state lifted to App so view-suppression can react. */
  searchOpen: boolean;
  onOpenSearch: () => void;
  /** M13: ref attached to the tabs toggle button so TabDrawer can ignore mousedown on it. */
  tabsToggleRef: RefObject<HTMLButtonElement | null>;
  /** M13: ref attached to the settings toggle button so SettingsDrawer can ignore mousedown on it. */
  settingsToggleRef: RefObject<HTMLButtonElement | null>;
  /** Ref to the SearchPill so the SearchSpotlight can ignore mousedown on it (avoid reopen-on-close). */
  searchPillRef: RefObject<HTMLButtonElement | null>;
}

/**
 * M17 layout: [Tabs+badge] [Settings] [Back] [Forward?] [AddressPill] [Min][Close].
 * Forward renders only when the tab can go forward; Reload/Stop and the
 * mobile/desktop toggle live inside the pill. `data-loading` on the root is
 * the E2E load-completion fence and drives the CSS load bar.
 */
export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
  searchOpen,
  onOpenSearch,
  tabsToggleRef,
  settingsToggleRef,
  searchPillRef,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const tabCount = useTabsStore((s) => s.tabOrder.length);
  const hidden = useWindowStateStore((s) => s.hidden);

  const id = tab?.id ?? '';
  const disabled = !tab;
  const url = tab?.url ?? '';
  const label = pillLabelFor(url);
  const isPlaceholder = label === PILL_PLACEHOLDER;
  const loading = tab?.isLoading === true;
  const badge = formatTabCount(tabCount);

  return (
    <div
      data-testid="topbar"
      data-loading={loading ? 'true' : 'false'}
      className={
        'app-drag relative flex h-9 w-full items-center gap-1 pl-2 ' +
        'border-b border-[var(--border)] ' +
        `transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`
      }
      style={{
        background:
          'linear-gradient(180deg, var(--surface-chrome-top) 0%, var(--surface-chrome-bot) 100%)',
      }}
    >
      <IconButton
        ref={tabsToggleRef}
        ariaLabel="Toggle tabs"
        testId="topbar-tabs-toggle"
        active={drawerOpen}
        onClick={onToggleDrawer}
      >
        <Layers size={16} />
        {badge !== null && (
          <span
            data-testid="topbar-tab-count"
            className={
              'absolute -right-0.5 -top-0.5 flex h-[13px] min-w-[13px] items-center justify-center ' +
              'rounded-full bg-[var(--accent)] px-[3px] text-[9px] font-semibold leading-none ' +
              'text-[var(--accent-fg)]'
            }
          >
            {badge}
          </span>
        )}
      </IconButton>
      <IconButton
        ref={settingsToggleRef}
        ariaLabel="Open settings"
        testId="topbar-settings-toggle"
        active={settingsOpen}
        onClick={onToggleSettings}
      >
        <Settings size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Back"
        disabled={disabled || !tab?.canGoBack}
        onClick={() => id && void window.sidebrowser.goBack(id)}
      >
        <ArrowLeft size={16} />
      </IconButton>
      {tab?.canGoForward === true && (
        <IconButton ariaLabel="Forward" onClick={() => id && void window.sidebrowser.goForward(id)}>
          <ArrowRight size={16} />
        </IconButton>
      )}

      <div
        className={
          'app-no-drag ml-0.5 mr-1 flex h-[26px] min-w-0 flex-1 items-center gap-0.5 px-[3px] ' +
          'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] ' +
          'transition-colors duration-100 hover:border-[var(--accent)] focus-within:border-[var(--accent)] ' +
          (disabled ? 'opacity-50' : '')
        }
      >
        <PillButton
          ariaLabel={tab?.isMobile ? 'Switch to desktop' : 'Switch to mobile'}
          testId="topbar-ua-toggle"
          disabled={disabled}
          active={tab?.isMobile}
          onClick={() => id && void window.sidebrowser.setMobile(id, !tab?.isMobile)}
        >
          {tab?.isMobile ? <Smartphone size={13} /> : <Monitor size={13} />}
        </PillButton>
        <button
          ref={searchPillRef}
          type="button"
          data-testid="search-pill"
          aria-label="Search or enter URL"
          aria-expanded={searchOpen}
          disabled={disabled}
          onClick={onOpenSearch}
          className={
            'flex h-full min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-xs outline-none ' +
            (isPlaceholder ? 'text-[var(--fg-muted)]' : 'text-[var(--fg)]')
          }
        >
          <SchemeGlyph kind={schemeIconFor(url)} />
          <span className="truncate">{label}</span>
        </button>
        <PillButton
          ariaLabel={loading ? 'Stop' : 'Reload'}
          disabled={disabled}
          onClick={() => {
            if (!id) return;
            void (loading ? window.sidebrowser.stop(id) : window.sidebrowser.reload(id));
          }}
        >
          {loading ? <X size={13} /> : <RotateCw size={13} />}
        </PillButton>
      </div>

      <WindowControls />
      <span className="load-bar" data-loading={loading ? 'true' : 'false'} aria-hidden />
    </div>
  );
}

function SchemeGlyph({ kind }: { kind: SchemeIcon }): ReactElement {
  const cls = 'shrink-0 text-[var(--fg-muted)]';
  if (kind === 'lock') return <Lock size={11} className={cls} aria-hidden />;
  if (kind === 'globe') return <Globe size={11} className={cls} aria-hidden />;
  return <Search size={12} className={cls} aria-hidden />;
}

interface IconButtonProps {
  children: ReactNode;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, ariaLabel, testId, disabled, active, onClick },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'app-no-drag relative flex h-[26px] w-[26px] shrink-0 items-center justify-center ' +
        'rounded-[var(--radius-sm)] text-[var(--fg)] transition-colors duration-100 ' +
        'hover:bg-[var(--accent-tint)] ' +
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ' +
        (active ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] ' : '') +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
      }
    >
      {children}
    </button>
  );
});

function PillButton({ children, ariaLabel, testId, disabled, active, onClick }: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ' +
        'text-[var(--fg-muted)] transition-colors duration-100 hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] ' +
        'disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
        (active ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] ' : '') +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: E2E fence** — in `tests/e2e/navigation.spec.ts`, replace the body + doc comment of `waitForLoadComplete`:

```ts
/**
 * Wait for the active tab's load to finish. The TopBar exposes
 * `data-loading` (M17) — wait for it to flip true (may be skipped on very
 * fast responses) and then false.
 */
async function waitForLoadComplete(window: Awaited<ReturnType<typeof getChromeWindow>>): Promise<void> {
  const bar = window.getByTestId('topbar');
  await expect(bar).toHaveAttribute('data-loading', 'true', { timeout: 5_000 }).catch(() => {
    // Load may already have finished — fall through.
  });
  await expect(bar).toHaveAttribute('data-loading', 'false', { timeout: 10_000 });
}
```

- [ ] **Step 5:** typecheck + lint + unit; `build`; run `navigation`, `mobile-ua`, `mobile-clienthints`, `mobile-js-signals`, `tab-ux` E2E specs → green. **Commit** — `feat(M17): TopBar — address pill, on-demand Forward, tab badge, load bar, window controls`.

---

## Task 8: TabDrawer as a top-inset overlay

**Files:** `src/renderer/src/components/TabDrawer.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: TabDrawer** changes:
  1. Imports: add `useLayoutEffect`; `import { Favicon } from './Favicon';`; `import { tabLabel } from '../lib/chrome-labels';`.
  2. After the outside-click effect (still before `if (!open) return null`):

```tsx
  // M17: the drawer overlays the top of the page area. Report its height so
  // main offsets (never resizes) the active view underneath; 0 on close.
  useLayoutEffect(() => {
    if (!open) return;
    const el = drawerRef.current;
    if (!el) return;
    const report = (): void => window.sidebrowser.setTopInset(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.sidebrowser.setTopInset(0);
    };
  }, [open]);
```

  3. Root className → `'absolute inset-x-0 top-0 z-30 flex max-h-[60%] flex-col overflow-y-auto border-b border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-elevated)]'`.
  4. Row label → `const label = tabLabel(tab);`.
  5. Replace the favicon `<img>` / placeholder `<span>` ternary with `<Favicon src={tab.favicon} size={14} />`.

- [ ] **Step 2: App.tsx layout** — `chromeRef` wraps only `<TopBar … />`. Move `<TabDrawer … />` into the page-area `<div className="relative flex-1">`, as its **last** child (after `SearchSpotlight`). Update the suppression comment: "TabDrawer is NOT in the suppression set — it reports a top inset instead (M17), so the page stays live and un-resized below it."

- [ ] **Step 3:** `build`; run `multi-tab`, `tab-ux`, `mouse-leave-dim`, `mobile-viewport` E2E → green. **Commit** — `feat(M17): TabDrawer overlays page via top inset; New Tab label; Favicon`.

---

## Task 9: Favicon tile

**Files:** `src/renderer/src/components/Favicon.tsx`

- [ ] **Step 1:** Replace the component body (keep the doc comment, add one line: "M17: drawn on a `--favicon-tile` square so dark favicons stay visible in the dark theme."):

```tsx
export function Favicon({ src, size = 16 }: Props): ReactElement {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const box = { width: size + 4, height: size + 4 };
  if (src === null || src === erroredSrc) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={box}>
        <Globe size={size} className="text-[var(--fg-muted)]" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-[var(--favicon-tile)]"
      style={box}
    >
      <img src={src} alt="" width={size} height={size} onError={() => setErroredSrc(src)} />
    </span>
  );
}
```

- [ ] **Step 2:** `build`; `newtab` + `autocomplete` E2E green. **Commit** — `feat(M17): favicon tile`.

---

## Task 10: Spotlight — backdrop, single card, hint, match emphasis

**Files:**
- Create: `src/renderer/src/lib/split-match.ts`, `src/renderer/src/lib/spotlight-hint.ts`, `tests/unit/split-match.test.ts`, `tests/unit/spotlight-hint.test.ts`
- Modify: `AddressSuggestions.tsx`, `SearchSpotlight.tsx`, `App.tsx`

- [ ] **Step 1: Failing tests.**

`tests/unit/split-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitMatch } from '../../src/renderer/src/lib/split-match';

describe('splitMatch', () => {
  it('splits on the first case-insensitive occurrence', () => {
    expect(splitMatch('Hacker News', 'news')).toEqual(['Hacker ', 'News', '']);
    expect(splitMatch('abcabc', 'B')).toEqual(['a', 'b', 'cabc']);
  });
  it('null for empty/whitespace query or no match', () => {
    expect(splitMatch('abc', '')).toBeNull();
    expect(splitMatch('abc', '   ')).toBeNull();
    expect(splitMatch('abc', 'z')).toBeNull();
  });
  it('trims the query', () => {
    expect(splitMatch('example.com', ' exa ')).toEqual(['', 'exa', 'mple.com']);
  });
});
```

`tests/unit/spotlight-hint.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { spotlightHint, withTimeout } from '../../src/renderer/src/lib/spotlight-hint';

const TPL = 'https://www.google.com/search?q={query}';

describe('spotlightHint', () => {
  it('empty draft', () => {
    expect(spotlightHint('', null, TPL, 'Google')).toBe('Type a URL or search');
  });
  it('highlighted suggestion wins', () => {
    expect(spotlightHint('foo', 'https://news.ycombinator.com/x', TPL, 'Google')).toBe(
      'Open news.ycombinator.com',
    );
  });
  it('search vs open', () => {
    expect(spotlightHint('hello world', null, TPL, 'Google')).toBe('Search Google');
    expect(spotlightHint('example.com', null, TPL, 'Google')).toBe('Open example.com');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when fast', async () => {
    await expect(withTimeout(Promise.resolve('x'), 50, null)).resolves.toBe('x');
  });
  it('falls back on timeout', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<string>(() => {}), 150, null);
    vi.advanceTimersByTime(150);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });
  it('falls back on rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 50, null)).resolves.toBeNull();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement.**

`src/renderer/src/lib/split-match.ts`:

```ts
/** First case-insensitive occurrence of `query` in `text` → [before, match, after]. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim();
  if (q === '') return null;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return null;
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}
```

`src/renderer/src/lib/spotlight-hint.ts`:

```ts
import { normalizeUrlInput } from '@shared/url';

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Footer hint describing what Enter will do in the Spotlight (M17). */
export function spotlightHint(
  draft: string,
  highlightedUrl: string | null,
  searchTemplate: string,
  engineName: string,
): string {
  if (highlightedUrl !== null) return `Open ${hostOf(highlightedUrl)}`;
  if (draft.trim() === '') return 'Type a URL or search';
  const url = normalizeUrlInput(draft, searchTemplate);
  const searchPrefix = searchTemplate.split('{query}')[0] ?? '';
  if (searchPrefix !== '' && url.startsWith(searchPrefix)) return `Search ${engineName}`;
  return `Open ${hostOf(url)}`;
}

/** Resolve with `fallback` if `p` rejects or takes longer than `ms`. */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}
```

Run → PASS.

- [ ] **Step 3: AddressSuggestions.**
  1. Props: add `onHighlightChange?: (url: string | null) => void;`.
  2. Effect (after the existing two effects):

```tsx
    useEffect(() => {
      onHighlightChange?.(highlightIdx >= 0 ? (items[highlightIdx]?.url ?? null) : null);
    }, [highlightIdx, items, onHighlightChange]);
```

  3. `<ul>` className → `'max-h-80 overflow-y-auto border-t border-[var(--border-subtle)] p-1'` (in-flow; no absolute/border/shadow).
  4. Title / URL lines render through a local `Emph` helper:

```tsx
function Emph({ text, query }: { text: string; query: string }): ReactElement {
  const parts = splitMatch(text, query);
  if (parts === null) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark className="bg-transparent font-semibold text-[var(--fg)]">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}
```

  → `<Emph text={s.title || s.url} query={query} />` and `<Emph text={s.url} query={query} />`. Import `splitMatch`. Keep all testids.

- [ ] **Step 4: SearchSpotlight.**
  1. Props: add `backdropUrl: string | null;`.
  2. Track the highlighted suggestion: `const [highlighted, setHighlighted] = useState<string | null>(null);` → pass `onHighlightChange={setHighlighted}` to `AddressSuggestions`.
  3. Compute the hint (use the same engine lookup as `submit`; hoist `tpl` + `engineName` above `submit` and reuse them there):

```tsx
  const engine = settings?.search.engines.find((eng) => eng.id === settings.search.activeId);
  const tpl = engine?.urlTemplate ?? 'https://www.google.com/search?q={query}';
  const hint = spotlightHint(draft, highlighted, tpl, engine?.name ?? 'Google');
```

  4. Render:

```tsx
    <div data-testid="search-spotlight" className="absolute inset-0 z-20">
      {backdropUrl !== null && (
        <img
          data-testid="spotlight-backdrop"
          src={backdropUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      )}
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[6px]" />
      <div className="relative flex justify-center">
        <div
          ref={panelRef}
          className="mt-12 flex w-[88%] max-w-[420px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[var(--shadow-elevated)]"
        >
          <form onSubmit={submit} className="p-1.5">
            {/* input unchanged */}
          </form>
          <AddressSuggestions
            ref={suggestionsRef}
            query={draft}
            open={suggestionsOpen}
            onPick={handlePick}
            onHighlightChange={setHighlighted}
          />
          <div
            data-testid="spotlight-hint"
            className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-[var(--fg-muted)]"
          >
            <span className="truncate">{hint}</span>
            <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1 font-sans">↵</kbd>
          </div>
        </div>
      </div>
    </div>
```

  `AddressSuggestions` moves out of the `<form>`; its `onMouseDown` + `preventDefault` keeps input focus, and Enter still submits via the form. Update the component JSDoc (replace the "titleBarOverlay reservation + 6 IconButtons left ~50 px" history line with one line noting the M17 single-card layout + backdrop).

- [ ] **Step 5: App.tsx** — backdrop state + async open:

```tsx
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const backdropClearTimer = useRef<number | null>(null);

  // M17: snapshot the live page first so the Spotlight scrim blurs a picture
  // of it instead of an empty surface once the view is suppressed. NewTab
  // has no native page to snapshot. 150 ms cap — on timeout open without one.
  const openSearch = useCallback(async (): Promise<void> => {
    if (backdropClearTimer.current !== null) {
      window.clearTimeout(backdropClearTimer.current);
      backdropClearTimer.current = null;
    }
    const snap = isNewTab
      ? null
      : await withTimeout(window.sidebrowser.captureActiveView(), 150, null);
    setBackdropUrl(snap);
    setSearchOpen(true);
  }, [isNewTab]);

  // Keep the backdrop briefly after close: the view re-shows over it, so no
  // blank frame appears between unsuppress and the page repaint.
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    backdropClearTimer.current = window.setTimeout(() => {
      backdropClearTimer.current = null;
      setBackdropUrl(null);
    }, 100);
  }, []);
```

  - Delete the old `openSearch` / `closeSearch` one-liners.
  - `onOpenSearch={() => void openSearch()}` on TopBar; `openSearch()` in the shortcut switch becomes `void openSearch();`.
  - `<SearchSpotlight onClose={closeSearch} pillRef={searchPillRef} backdropUrl={backdropUrl} />`.
  - Import `withTimeout` from `./lib/spotlight-hint`.

- [ ] **Step 6:** unit + typecheck + lint; `build`; `autocomplete`, `search-engine`, `navigation`, `tab-ux` E2E green. **Commit** — `feat(M17): Spotlight — page snapshot backdrop, single card, Enter hint, match emphasis`.

---

## Task 11: Settings polish

**Files:** `src/renderer/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: `SelectField`** — add near `Row`:

```tsx
function SelectField({
  testId,
  value,
  onChange,
  children,
}: {
  testId: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <span className="relative inline-flex">
      <select
        data-testid={testId}
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        className="mac-select"
      >
        {children}
      </select>
      <ChevronsUpDown
        size={12}
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]"
      />
    </span>
  );
}
```

  Import `ChevronsUpDown` from lucide. Migrate all four selects (`settings-theme`, `settings-window-preset`, `settings-dim-effect`, `settings-search-active`), e.g.:

```tsx
            <SelectField
              testId="settings-theme"
              value={settings.appearance.theme}
              onChange={(v) => void update({ appearance: { theme: v as ThemeChoice } })}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </SelectField>
```

  Options, casts and `update` patches stay exactly as today.

- [ ] **Step 2: Slider fill** — in `Slider`, compute and set `--fill` on the `<input>`:

```tsx
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  …
      <input
        …
        className="mac-slider"
        style={{ '--fill': `${pct}%` } as CSSProperties}
      />
```

  (`import type { CSSProperties } from 'react'`.)

- [ ] **Step 3: Dim conditional sliders** — wrap each effect slider: `{settings.dim.effect === 'blur' && <Slider label="Blur" … />}`, `=== 'dark'` for Dark brightness, `=== 'light'` for Light brightness. Remove the `dimmed` prop from those three call sites, from `SliderProps`, and from `Slider` (`className="flex flex-col gap-1"`). Transition slider stays unconditional.

- [ ] **Step 4:** `build`; `settings-drawer`, `chrome-dim`, `search-engine`, `theme` E2E green. **Commit** — `feat(M17): settings — styled selects, filled sliders, effect-specific dim sliders`.

---

## Task 12: NewTab — Frequent grid + compact hero

**Files:** `src/main/suggestion-ranker.ts`, `tests/unit/suggestion-ranker.test.ts`, `src/shared/types.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc-router.ts`, `tests/unit/ipc-contract.test.ts`, `scripts/generate-app-icon.mjs`, `resources/newtab-icon.png`, `src/renderer/src/components/NewTab.tsx`

- [ ] **Step 1: Type** — `src/shared/types.ts`:

```ts
/** NewTab "Frequent" tile (M17): one per origin, ranked by summed frecency. */
export interface TopSite {
  origin: string;
  /** Host with a leading `www.` stripped — tile label. */
  host: string;
  favicon: string | null;
}
```

- [ ] **Step 2: Failing tests** — append to `tests/unit/suggestion-ranker.test.ts` (reuse that file's existing entry-factory helper if present; otherwise define `entry(url, visitCount, lastVisitedAt, favicon = null)` locally):

```ts
describe('topSites', () => {
  const now = 1_000 * 86_400_000;
  const e = (url: string, visitCount: number, favicon: string | null = null): HistoryEntry => ({
    url, title: '', favicon, firstVisitedAt: now, lastVisitedAt: now, visitCount,
  });

  it('groups by origin and sums frecency', () => {
    const r = topSites(
      [e('https://a.com/1', 1), e('https://a.com/2', 1), e('https://b.com/', 1.5)],
      8,
      now,
    );
    expect(r.map((s) => s.origin)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('strips www. from the host label', () => {
    expect(topSites([e('https://www.bilibili.com/x', 1)], 8, now)[0]!.host).toBe('bilibili.com');
  });

  it('ignores non-http(s) and malformed URLs', () => {
    expect(topSites([e('file:///x', 5), e('nope', 5)], 8, now)).toEqual([]);
  });

  it('favicon comes from the highest-frecency entry that has one', () => {
    const r = topSites(
      [e('https://a.com/1', 5, null), e('https://a.com/2', 2, 'f2'), e('https://a.com/3', 1, 'f3')],
      8,
      now,
    );
    expect(r[0]!.favicon).toBe('f2');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`https://s${i}.com/`, 12 - i));
    expect(topSites(many, 8, now)).toHaveLength(8);
  });
});
```

Run → FAIL.

- [ ] **Step 3: Implement** in `src/main/suggestion-ranker.ts` (uses the module's existing `frecency`):

```ts
/**
 * NewTab "Frequent" tiles (M17): http(s) history grouped by origin, ranked
 * by summed frecency. Favicon = the highest-frecency entry in the group that
 * has one.
 */
export function topSites(entries: HistoryEntry[], limit: number, now: number): TopSite[] {
  interface Group { host: string; score: number; favicon: string | null; faviconScore: number }
  const groups = new Map<string, Group>();
  for (const e of entries) {
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    const s = frecency(e, now);
    let g = groups.get(u.origin);
    if (!g) {
      g = { host: u.host.replace(/^www\./i, ''), score: 0, favicon: null, faviconScore: -1 };
      groups.set(u.origin, g);
    }
    g.score += s;
    if (e.favicon !== null && s > g.faviconScore) {
      g.favicon = e.favicon;
      g.faviconScore = s;
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].host.localeCompare(b[1].host))
    .slice(0, limit)
    .map(([origin, g]) => ({ origin, host: g.host, favicon: g.favicon }));
}
```

  Import `TopSite`. Run → PASS.

- [ ] **Step 4: IPC `history:top-sites`.**
  - Test: `expect(IpcChannels.historyTopSites).toBe('history:top-sites');` (add to the M17 block) → FAIL.
  - Channel: `historyTopSites: 'history:top-sites'` (R→M invoke); contract `{ request: { limit: number }; response: TopSite[] }`.
  - Preload: `historyTopSites: (limit: number): Promise<TopSite[]> => ipcRenderer.invoke(IpcChannels.historyTopSites, { limit }),`
  - Router: `ipcMain.removeHandler(...)` + `ipcMain.handle(IpcChannels.historyTopSites, (_e, p) => topSites(historyStore.all(), p.limit, Date.now()));`
  - Test → PASS.

- [ ] **Step 5: Hero PNG.** In `scripts/generate-app-icon.mjs`, after the ICO write:

```js
  const NEWTAB_PNG_PATH = resolve(ROOT, 'resources', 'newtab-icon.png');
  await sharp(SRC_PATH)
    .ensureAlpha()
    .resize(128, 128, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(NEWTAB_PNG_PATH);
  console.log(`[icon] wrote ${NEWTAB_PNG_PATH}`);
```

  Update the header comment ("→ resources/icon.ico + resources/newtab-icon.png"). Run `node scripts/generate-app-icon.mjs`. If `git diff --stat resources/icon.ico` shows a change, `git checkout resources/icon.ico` (keep this commit free of icon churn).

- [ ] **Step 6: NewTab.**
  1. `import appIconUrl from '@resources/newtab-icon.png';` (replaces the `.ico` import); `import type { HistoryEntry, TopSite } from '@shared/types';`.
  2. State `const [sites, setSites] = useState<TopSite[]>([]);`; inside the existing `load()` also call `window.sidebrowser.historyTopSites(8).then((s) => { if (!cancelled) setSites(s); })` with the same `.catch` logging pattern.
  3. `clearAll` also does `setSites([])`.
  4. Hero: container `pt-8 pb-4`; `<img … className="mb-3 size-10 rounded-[var(--radius-md)] shadow-[var(--shadow-card)]" />`; `<h1 className="text-base font-semibold tracking-tight">`.
  5. Between hero and the "Recent" header, when `sites.length > 0`:

```tsx
      {sites.length > 0 && (
        <section className="px-4 pb-2">
          <div className="py-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
            Frequent
          </div>
          <ul className="grid grid-cols-4 gap-x-2 gap-y-3">
            {sites.map((s) => (
              <li key={s.origin}>
                <button
                  type="button"
                  data-testid="newtab-topsite"
                  title={s.origin}
                  onMouseDown={(ev) => { ev.preventDefault(); navigate(`${s.origin}/`); }}
                  className="group flex w-full flex-col items-center gap-1 rounded-[var(--radius-md)] p-1 hover:bg-[var(--accent-tint)]"
                >
                  <span className="flex size-10 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] shadow-[var(--shadow-card)]">
                    <Favicon src={s.favicon} size={20} />
                  </span>
                  <span className="w-full truncate text-center text-[11px] text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
                    {s.host}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
```

  Recent list markup and testids unchanged.

- [ ] **Step 7:** unit + typecheck + lint; `build`; `newtab` E2E green. **Commit** — `feat(M17): NewTab — Frequent grid, compact hero, PNG icon`.

---

## Task 13: Minify renderer

**Files:** `electron.vite.config.ts`

- [ ] **Step 1:** In `renderer.build`, add `minify: true,` above `rollupOptions`.
- [ ] **Step 2:** `build` → record `out/renderer/assets/index-*.js` size before (559 KB at v1.4.1) and after in the task report. Run `macos-style` E2E (CSS hex normalization still holds).
- [ ] **Step 3: Commit** — `build(M17): minify renderer bundle`.

---

## Task 14: E2E — M17 suite + updates

**Files:** Create `tests/e2e/m17-chrome.spec.ts`; modify `tests/e2e/settings-drawer.spec.ts`

- [ ] **Step 1: Update** `settings-drawer.spec.ts` test 1 → rename to `'drawer open hides the active view; close shows it again (bounds unchanged)'`. Add a local helper:

```ts
async function getActiveViewVisible(app: ElectronApplication): Promise<boolean | null> {
  return app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as { getActiveViewVisible: () => boolean | null };
    return h.getActiveViewVisible();
  });
}
```

  Assertions: after open → poll `getActiveViewVisible` toBe `false` **and** `getActiveViewBounds` equals `initial`; after close → poll toBe `true`.

- [ ] **Step 2: New spec** `tests/e2e/m17-chrome.spec.ts`. Structure (one app per test, isolated `--user-data-dir`, `SIDEBROWSER_E2E=1`, same `launch` + `startServer` pattern as `settings-drawer.spec.ts`). The local server serves:
  - `/a`, `/b` — plain pages with `<title>A</title>` / `<title>B</title>`;
  - `/slow` — responds after 800 ms.

  Tests:

  1. **window controls** — `window-minimize` and `window-close` visible; click minimize → poll `getIsMinimized()` true → `restoreWindow()`.
  2. **forward on demand** — fresh tab: `getByRole('button', { name: 'Forward' })` count 0; navigate `/a` then `/b`; click Back; poll Forward visible; click Forward → poll it is gone.
  3. **tab badge** — `topbar-tab-count` count 0; `window.sidebrowser.createTab('about:blank')` → badge text `2`.
  4. **drawer inset** — navigate `/a`; read `initial = getActiveViewBounds()`; click `topbar-tabs-toggle`; `drawerH = (await getByTestId('tab-drawer').boundingBox())!.height`; poll bounds: `|y − (initial.y + drawerH)| ≤ 1`, `height === initial.height`, `getActiveViewVisible() === true`; toggle closed → poll `y === initial.y`.
  5. **spotlight backdrop** — navigate `/a`; click `search-pill`; `spotlight-backdrop` `src` starts with `data:image/jpeg;base64,`; poll `getActiveViewVisible()` false; press Escape → poll true.
  6. **dim sliders** — `updateSettings({ dim: { effect: 'dark' } })`; open settings; `settings-dim-dark-brightness` count 1, `settings-dim-blur` 0, `settings-dim-light-brightness` 0.
  7. **loading attr** — navigate to `/slow` without awaiting commit; expect `topbar` `data-loading="true"` then (≤10 s) `"false"`.

- [ ] **Step 3:** `build`; run the full E2E suite → green. **Commit** — `test(M17): e2e — window controls, forward, badge, drawer inset, spotlight backdrop, dim sliders, loading`.

---

## Task 15: Final verification

- [ ] **Step 1:** `typecheck`, `lint`, `test` (unit), `build`, `test:e2e` — all green; record counts in the report.
- [ ] **Step 2: Leftover grep:**

```bash
grep -rn "titleBarOverlay\|TITLEBAR_OVERLAY\|resolveTitleBarOverlay\|animate-spin\|dimmed=\|icon.ico" src tests
```

  Expected: no hits except `icon.ico` references outside the renderer (none in `src/renderer`).
- [ ] **Step 3:** README — no shortcut changes. Under "已知限制" nothing changes. Do **not** bump the version or edit CHANGELOG (release step, user-gated).
- [ ] **Step 4: Stop.** Ask the user to run the manual smoke (spec §15) with `pnpm dev`. Do not tag.

---

## Self-review notes

- **Spec coverage:** §4 → Tasks 3/4/6; §5 → Tasks 5/7; §6 → Tasks 2/3/8; §7 → Task 10; §8 → Tasks 5/8/9; §9 → Task 11; §10 → Task 8; §11 → Task 12; §12 → Tasks 5/13; §13 → Tasks 2/7/10/12/14.
- **Testid compatibility:** `search-pill`, `topbar-ua-toggle`, `topbar-tabs-toggle`, `topbar-settings-toggle`, `tab-drawer*`, `address-bar`, `address-suggestions*`, `newtab-*`, `settings-*` all preserved. Back keeps role name "Back".
- **Behavioral contract changes:** suppression no longer zeroes bounds (settings-drawer test 1 updated); the `.animate-spin` load fence is replaced by `data-loading` (navigation spec updated); TabDrawer no longer changes the reported chrome height (mobile-viewport spec unaffected — webview size excludes the inset by design).
- **Gate:** Task 1 must pass before Task 2 starts.
