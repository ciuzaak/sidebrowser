# M14 — macOS-style UI overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc `--chrome-*` CSS variables with a semantic token system (dark + light), move to a frameless window with Windows-native `titleBarOverlay`, redesign NewTab around a small hero + greeting + recent list, and restyle TopBar / TabDrawer / SettingsDrawer / AddressSuggestions to a refined "Tahoe Crisp" macOS aesthetic. No new product features; one new IPC (`history:clear`). All UI strings English.

**Architecture:** Renderer carries the visual changes through a new CSS token layer in `globals.css`. Components reference tokens, never raw hex. The Electron main process switches to `titleBarStyle: 'hidden'` + `titleBarOverlay` so Windows draws min/max/close natively in the top-right while we own everything else; a small pure helper computes the overlay colors per resolved theme. One new IPC (`history:clear`) wires the NewTab "Clear" button to a new `HistoryStore.clearAll()` method.

**Tech Stack:** Electron 28+ (`titleBarOverlay`), React 19, TypeScript strict, Tailwind v4, Vitest, Playwright `_electron`. Lucide icons.

**Spec:** `docs/superpowers/specs/2026-05-11-M14-macos-style-ui-design.md`.

**File responsibilities (lock in):**

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/src/styles/globals.css` | Rewrite | All theme tokens (dark + light), reset rules, slider/toggle base CSS. |
| `src/main/title-bar-overlay.ts` | Create | Pure helper `resolveTitleBarOverlay(theme): { color, symbolColor }`. No Electron import. |
| `tests/unit/title-bar-overlay.test.ts` | Create | Vitest unit suite for the helper. |
| `src/main/index.ts` | Modify | BrowserWindow opts + nativeTheme/settings → `setTitleBarOverlay`. |
| `src/main/history-store.ts` | Modify | Add `clearAll()` method. |
| `tests/unit/history-store.test.ts` | Modify | Add `clearAll` test block. |
| `src/shared/ipc-contract.ts` | Modify | New `historyClear` channel + contract. |
| `src/preload/index.ts` | Modify | Expose `historyClear`. |
| `src/main/ipc-router.ts` | Modify | Register `history:clear` listener. |
| `src/renderer/src/components/TopBar.tsx` | Modify | New tokens, drag region, button hover/active styling. |
| `src/renderer/src/components/TabDrawer.tsx` | Modify | New tokens, accent-tinted active row. |
| `src/renderer/src/components/SettingsDrawer.tsx` | Modify | Section cards, Mac-style toggles, refined sliders. |
| `src/renderer/src/components/NewTab.tsx` | Rewrite | Hero icon + greeting + Recent list with Clear. |
| `src/renderer/src/components/AddressSuggestions.tsx` | Modify | Rounded dropdown, accent highlight. |
| `src/renderer/src/components/Favicon.tsx` | Modify | Fallback color to `--fg-muted`. |
| `tests/e2e/macos-style.spec.ts` | Create | Theme-token parity check. |

---

## Task 1: Design tokens — rewrite `globals.css`

**Files:**
- Modify: `src/renderer/src/styles/globals.css`

- [ ] **Step 1: Read the existing file** to confirm scope. Existing content is roughly: `@import 'tailwindcss'`, two `:root[data-theme=…]` blocks with `--chrome-*` variables, and a font-family fallback. The rewrite replaces those blocks wholesale.

- [ ] **Step 2: Overwrite the file** with the new content:

```css
@import 'tailwindcss';

/* ──────────────────────────────────────────────────────────────
   M14 — Semantic token system (Tahoe Crisp)
   Components reference these tokens via var(--…). Never reference
   raw hex in JSX.
   ────────────────────────────────────────────────────────────── */

:root[data-theme='dark'] {
  --surface: #1c1e24;
  --surface-elevated: #23262e;
  --surface-sunken: #14161b;
  --surface-chrome-top: #25272d;
  --surface-chrome-bot: #1f2127;

  --border: #2a2d36;
  --border-subtle: #23262e;

  --fg: #e6e7ea;
  --fg-muted: #8a8f9b;
  --fg-faint: #6b7280;

  --accent: #5b8dff;
  --accent-fg: #ffffff;
  --accent-tint: rgba(91, 141, 255, 0.18);
  --accent-text: #7fa8ff;

  --active-row-bg: #2a3146;
  --active-row-fg: #cfe4ff;

  --shadow-elevated: 0 10px 30px -10px rgba(0, 0, 0, 0.45);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--border);
}

:root[data-theme='light'] {
  --surface: #f6f6f7;
  --surface-elevated: #ffffff;
  --surface-sunken: #ffffff;
  --surface-chrome-top: #fbfbfc;
  --surface-chrome-bot: #ececee;

  --border: #d8d8db;
  --border-subtle: #ececee;

  --fg: #1d1d1f;
  --fg-muted: #6b6b70;
  --fg-faint: #9aa1ad;

  --accent: #0066cc;
  --accent-fg: #ffffff;
  --accent-tint: rgba(0, 102, 204, 0.14);
  --accent-text: #0066cc;

  --active-row-bg: #e6efff;
  --active-row-fg: #003d99;

  --shadow-elevated: 0 10px 30px -10px rgba(0, 0, 0, 0.12);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--border);
}

:root {
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 14px;
}

html,
body,
#root {
  background: var(--surface, #1c1e24);
  color: var(--fg, #e6e7ea);
  height: 100%;
  font-family:
    -apple-system,
    'SF Pro Text',
    'Segoe UI Variable',
    'Segoe UI',
    system-ui,
    'Inter',
    sans-serif;
  font-variant-numeric: tabular-nums;
}

/* ──────────────────────────────────────────────────────────────
   Range slider — Mac-style. Used by SettingsDrawer sliders.
   ────────────────────────────────────────────────────────────── */
input[type='range'].mac-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 16px;
  background: transparent;
  cursor: pointer;
}
input[type='range'].mac-slider::-webkit-slider-runnable-track {
  height: 3px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 999px;
}
input[type='range'].mac-slider::-moz-range-track {
  height: 3px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 999px;
}
input[type='range'].mac-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  margin-top: -6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
input[type='range'].mac-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
input[type='range'].mac-slider:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
input[type='range'].mac-slider:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ──────────────────────────────────────────────────────────────
   Mac-style toggle. Used by SettingsDrawer boolean rows.
   Markup contract: <label class="mac-toggle"><input type="checkbox" …/><span class="track" /></label>
   ────────────────────────────────────────────────────────────── */
.mac-toggle {
  display: inline-block;
  position: relative;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
}
.mac-toggle input {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.mac-toggle input::before {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 120ms ease;
}
.mac-toggle input:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.mac-toggle input:checked::before {
  transform: translateX(14px);
}
.mac-toggle input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Sweep for old token references** (will all be fixed in subsequent tasks; this step just measures scope):

```
Run: pnpm exec grep -rE "--chrome-(bg|fg|border|hover|muted|input-bg|drawer-bg|accent)" src/
```
Expected: matches in `TopBar.tsx`, `TabDrawer.tsx`, `SettingsDrawer.tsx`, `NewTab.tsx`, `AddressSuggestions.tsx`, `Favicon.tsx`, `theme/useTheme.ts` (comment only). These are addressed in Tasks 6–11.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/globals.css
git commit -m "feat(M14): design tokens — semantic CSS variable system (dark+light)"
```

---

## Task 2: `title-bar-overlay.ts` helper (TDD)

**Files:**
- Create: `src/main/title-bar-overlay.ts`
- Create: `tests/unit/title-bar-overlay.test.ts`

- [ ] **Step 1: Write the failing test** at `tests/unit/title-bar-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTitleBarOverlay } from '../../src/main/title-bar-overlay';

describe('resolveTitleBarOverlay', () => {
  it('returns dark token pair for dark theme', () => {
    expect(resolveTitleBarOverlay('dark')).toEqual({
      color: '#25272d',
      symbolColor: '#c8ccd4',
    });
  });

  it('returns light token pair for light theme', () => {
    expect(resolveTitleBarOverlay('light')).toEqual({
      color: '#fbfbfc',
      symbolColor: '#3a3a3c',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
Run: pnpm test --run title-bar-overlay
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the implementation** at `src/main/title-bar-overlay.ts`:

```ts
/**
 * Resolves the `titleBarOverlay` color pair for the active theme.
 * Values mirror `--surface-chrome-top` (dark) and `--fg-muted` /
 * `--fg-strong` for symbol contrast. Single source of truth — same
 * literals appear in globals.css, but the overlay is an OS-side
 * pixel layer (not in the DOM), so we can't read them from CSS.
 *
 * Pure helper — no Electron import — so it's freely unit-testable.
 */
export function resolveTitleBarOverlay(
  theme: 'dark' | 'light',
): { color: string; symbolColor: string } {
  if (theme === 'dark') {
    return { color: '#25272d', symbolColor: '#c8ccd4' };
  }
  return { color: '#fbfbfc', symbolColor: '#3a3a3c' };
}
```

- [ ] **Step 4: Re-run the test**

```
Run: pnpm test --run title-bar-overlay
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/title-bar-overlay.ts tests/unit/title-bar-overlay.test.ts
git commit -m "feat(M14): titleBarOverlay color helper + unit tests"
```

---

## Task 3: BrowserWindow → frameless + titleBarOverlay + theme sync

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Locate the imports block at the top of `src/main/index.ts`** and add the helper import alongside the other `./` imports (e.g., right after the `view-manager` import):

```ts
import { resolveTitleBarOverlay } from './title-bar-overlay';
```

- [ ] **Step 2: Modify `createWindow`** — replace the `new BrowserWindow({…})` block with:

```ts
function createWindow(initialBounds: Rectangle): BrowserWindow {
  const initialOverlay = resolveTitleBarOverlay(
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  );
  const win = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    title: 'sidebrowser',
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: initialOverlay.color,
      symbolColor: initialOverlay.symbolColor,
      height: 36,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Hidden Application Menu (M8) still applies; setAutoHideMenuBar is harmless
  // with titleBarStyle: 'hidden' but keep it for parity with prior behavior.
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
```

- [ ] **Step 3: Find the existing `nativeTheme.on('updated', …)` listener** (it currently broadcasts to renderer). Inspect by:

```
Run: pnpm exec grep -n "nativeTheme" src/main/index.ts
```
Expected: shows where `nativeTheme.on('updated', …)` is registered and a settings-related read. If no listener exists, search for the appReady wiring instead — that area is where the broadcast lives.

- [ ] **Step 4: Add a `recomputeTitleBarOverlay` helper** inside `index.ts` (placed near the `createWindow` function, top-level):

```ts
function recomputeTitleBarOverlay(
  win: BrowserWindow,
  themeChoice: 'system' | 'dark' | 'light',
): void {
  const resolved =
    themeChoice === 'system'
      ? nativeTheme.shouldUseDarkColors
        ? 'dark'
        : 'light'
      : themeChoice;
  const overlay = resolveTitleBarOverlay(resolved);
  if (!win.isDestroyed()) {
    win.setTitleBarOverlay({
      color: overlay.color,
      symbolColor: overlay.symbolColor,
      height: 36,
    });
  }
}
```

- [ ] **Step 5: Wire `recomputeTitleBarOverlay` into the two events that move it.** Find the `nativeTheme.on('updated', …)` handler (or add one alongside `app.whenReady`) — at the end of its body call:

```ts
recomputeTitleBarOverlay(win, settingsStore.get().appearance.theme);
```

And find the `settingsStore.onChange` / `settings:changed` broadcast handler (the one in `index.ts` referenced by `ipc-router.ts` comment: "settings:changed broadcast is NOT wired here — that lives in src/main/index.ts"). At the end of its body call the same helper:

```ts
recomputeTitleBarOverlay(win, next.appearance.theme);
```

(`next` is the updated Settings object the broadcast receives; adapt the variable name if the local in that function differs.)

- [ ] **Step 6: Typecheck**

```
Run: pnpm typecheck
```
Expected: PASS.

- [ ] **Step 7: Lint**

```
Run: pnpm lint
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(M14): frameless window + native titleBarOverlay, theme-synced"
```

---

## Task 4: `HistoryStore.clearAll()` (TDD)

**Files:**
- Modify: `src/main/history-store.ts`
- Modify: `tests/unit/history-store.test.ts`

- [ ] **Step 1: Write the failing test** — add a new `describe` block at the bottom of `tests/unit/history-store.test.ts`:

```ts
describe('HistoryStore.clearAll', () => {
  it('empties the store, commits to backend, and notifies listeners', async () => {
    const backend = createFakeBackend({
      entries: [
        entry('https://a.example/', { lastVisitedAt: 1 }),
        entry('https://b.example/', { lastVisitedAt: 2 }),
      ],
    });
    const store = new HistoryStore(backend);
    expect(store.all()).toHaveLength(2);

    const seen: number[] = [];
    store.onChanged(() => seen.push(store.all().length));

    store.clearAll();

    // Backend write is synchronous (clearAll bypasses the debounce).
    expect(store.all()).toEqual([]);
    expect(backend.lastSet).toEqual({ entries: [] });

    // Notify is throttled to next tick (16 ms). Flush.
    await new Promise((r) => setTimeout(r, 32));
    expect(seen).toEqual([0]);
  });

  it('is a no-op on an empty store but still notifies once', async () => {
    const backend = createFakeBackend({ entries: [] });
    const store = new HistoryStore(backend);
    let calls = 0;
    store.onChanged(() => { calls += 1; });

    store.clearAll();

    await new Promise((r) => setTimeout(r, 32));
    expect(calls).toBe(1);
    expect(store.all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

```
Run: pnpm test --run history-store
```
Expected: FAIL — `clearAll is not a function`.

- [ ] **Step 3: Add the `clearAll` method** to `src/main/history-store.ts` — insert between `remove(url)` and `recent(limit)`:

```ts
/** Wipe all entries. Bypasses debounce — backend write is synchronous so
 *  the "Clear" UI button shows immediate effect on next read. */
clearAll(): void {
  if (this.saveTimer !== null) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  this.entries.clear();
  this.commitToBackend();
  this.scheduleNotify();
}
```

- [ ] **Step 4: Re-run the test**

```
Run: pnpm test --run history-store
```
Expected: PASS — both new tests + all prior history-store tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/main/history-store.ts tests/unit/history-store.test.ts
git commit -m "feat(M14): HistoryStore.clearAll + tests"
```

---

## Task 5: `history:clear` IPC end-to-end

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc-router.ts`

- [ ] **Step 1: Add the channel constant + contract.** In `src/shared/ipc-contract.ts`, inside the `IpcChannels` const-object, add the new channel near the other history channels:

```ts
/** R→M send. Wipe all history entries; broadcasts history:changed. */
historyClear: 'history:clear',
```

Then in the `IpcContract` interface block, near the other `historyRemove` entry, add:

```ts
[IpcChannels.historyClear]: {
  request: Record<string, never>;
  response: void;
};
```

- [ ] **Step 2: Expose in preload.** In `src/preload/index.ts`, after the `historyRemove` entry inside the `api` object:

```ts
historyClear: (): void => {
  ipcRenderer.send(IpcChannels.historyClear, {});
},
```

- [ ] **Step 3: Register the listener.** In `src/main/ipc-router.ts`, after the `history:remove` block (the one that registers `onHistoryRemove` and removes it on `window.once('closed', …)`):

```ts
// history:clear — fire-and-forget. Wipes the entire history store.
const onHistoryClear = (): void => {
  historyStore.clearAll();
};
ipcMain.on(IpcChannels.historyClear, onHistoryClear);
window.once('closed', () => {
  ipcMain.removeListener(IpcChannels.historyClear, onHistoryClear);
});
```

- [ ] **Step 4: Typecheck**

```
Run: pnpm typecheck
```
Expected: PASS.

- [ ] **Step 5: Run unit tests** to verify the existing ipc-contract test (if any) still parses:

```
Run: pnpm test --run ipc-contract
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc-router.ts
git commit -m "feat(M14): history:clear IPC wired end-to-end"
```

---

## Task 6: TopBar restyle

**Files:**
- Modify: `src/renderer/src/components/TopBar.tsx`

- [ ] **Step 1: Read the current file** to confirm exact structure (already read in spec authoring; key markers: the outer `<div className="flex w-full items-center …">`, the `IconButton` forwardRef component at the bottom, the `<input type="text" data-testid="address-bar" …>`).

- [ ] **Step 2: Add the titleBarOverlay reserve constant at the top of the file** (under the imports):

```ts
/** Reserve width on the right of the chrome row so the address bar doesn't
 *  slide under the Windows-native titleBarOverlay (min/max/close buttons).
 *  The overlay is ~135 px wide on Win10/11; 138 px gives a small margin. */
const TITLEBAR_OVERLAY_PX = 138;
```

- [ ] **Step 3: Replace the outer wrapper `<div>`** (the one with `className="flex w-full items-center gap-1 border-b …"`) with:

```tsx
<div
  className={
    'flex w-full items-center gap-1 px-2 py-1.5 h-9 ' +
    'bg-[var(--surface-chrome-bot)] border-b border-[var(--border)] ' +
    `transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`
  }
  style={{
    background:
      'linear-gradient(180deg, var(--surface-chrome-top) 0%, var(--surface-chrome-bot) 100%)',
    paddingRight: TITLEBAR_OVERLAY_PX,
    WebkitAppRegion: 'drag',
  } as React.CSSProperties}
>
```

(The `React.CSSProperties` cast is needed because `WebkitAppRegion` is an Electron-specific CSS property that's not in the React DOM types. Add `import type * as React from 'react';` to the top of the file if it isn't already there — the existing imports use `type` imports already, so add `import type React from 'react';` or use the inline `React.CSSProperties` already imported via the existing `from 'react'` line. Verify by checking the top of the file; if needed, change the existing `import { ... } from 'react'` line to also bring in the `CSSProperties` type.)

- [ ] **Step 4: Replace the address bar `<input>` className** with:

```tsx
className={
  'w-full h-[26px] rounded-[var(--radius-md)] px-2 text-sm ' +
  'bg-[var(--surface-sunken)] text-[var(--fg)] placeholder-[var(--fg-muted)] ' +
  'border border-[var(--border)] outline-none ' +
  'focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent ' +
  'disabled:opacity-50'
}
style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
```

(Add `style` if the input doesn't already have one; if it does, merge.)

- [ ] **Step 5: Replace the `IconButton` component body** at the bottom of the file with:

```tsx
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
        'flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius-sm)] ' +
        'text-[var(--fg)] transition-colors duration-100 ' +
        'hover:bg-[var(--accent-tint)] ' +
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ' +
        (active ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] ' : '') +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
      }
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {children}
    </button>
  );
});
```

- [ ] **Step 6: Run typecheck**

```
Run: pnpm typecheck
```
Expected: PASS.

- [ ] **Step 7: Run lint**

```
Run: pnpm lint
```
Expected: PASS.

- [ ] **Step 8: Run TopBar-related E2E to verify selectors still work**

```
Run: pnpm test:e2e tab-ux navigation
```
Expected: PASS. If any test fails because of layout (e.g., a chrome-height assertion), the fix is to leave the selectors in place — only visual properties changed.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/TopBar.tsx
git commit -m "feat(M14): TopBar restyle — Tahoe Crisp + drag region + titleBarOverlay reserve"
```

---

## Task 7: TabDrawer restyle

**Files:**
- Modify: `src/renderer/src/components/TabDrawer.tsx`

- [ ] **Step 1: Replace the outer container `<div>` className** (the one with `flex max-h-[60vh] w-full flex-col …`) with:

```tsx
className="flex max-h-[60vh] w-full flex-col overflow-y-auto border-b border-[var(--border)] bg-[var(--surface)]"
```

- [ ] **Step 2: Replace the tab-row `<button>` className** (the one inside `{order.map(…)}`). Replace the existing className string with:

```tsx
className={
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm ' +
  'border-b border-[var(--border-subtle)] transition-colors duration-100 ' +
  'hover:bg-[var(--accent-tint)] ' +
  (isActive
    ? 'bg-[var(--active-row-bg)] text-[var(--active-row-fg)] shadow-[inset_2px_0_0_var(--accent)] '
    : 'text-[var(--fg)] ')
}
```

- [ ] **Step 3: Replace the close-`X` `<span role="button">` className** with:

```tsx
className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
```

- [ ] **Step 4: Replace the favicon placeholder background** — the existing `<span className="inline-block h-[14px] w-[14px] shrink-0" aria-hidden />` needs the placeholder to render with a token, not stay invisible. Change it to:

```tsx
<span className="inline-block h-[14px] w-[14px] shrink-0 rounded-[var(--radius-sm)] bg-[var(--border)] opacity-60" aria-hidden />
```

- [ ] **Step 5: Replace the `DrawerButton` className** (the "New tab" row) with:

```tsx
className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--accent-text)] border-b border-[var(--border-subtle)] hover:bg-[var(--accent-tint)]"
```

- [ ] **Step 6: Typecheck + lint + run tab-related E2E**

```
Run: pnpm typecheck && pnpm lint && pnpm test:e2e tab-ux multi-tab
```
Expected: PASS — selectors unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/TabDrawer.tsx
git commit -m "feat(M14): TabDrawer restyle — accent-tinted active row + token sweep"
```

---

## Task 8: SettingsDrawer restyle (cards + Mac toggle + Mac slider)

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: Outer drawer `<div>`** — replace its className with:

```tsx
className="absolute inset-0 z-10 flex flex-col overflow-y-auto bg-[var(--surface)] text-[var(--fg)]"
```

(Drops the redundant `border-l` and renames `--chrome-drawer-bg` → `--surface`.)

- [ ] **Step 2: Header `<header>`** — replace its className with:

```tsx
className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3"
```

And change `<h2 className="text-sm font-semibold">Settings</h2>` to:

```tsx
<h2 className="text-base font-semibold">Settings</h2>
```

And the close button className to:

```tsx
className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
```

- [ ] **Step 3: Outer settings list `<div>`** — replace its className (the one with `flex flex-col gap-5 p-3`) with:

```tsx
className="flex flex-col gap-3 p-4"
```

- [ ] **Step 4: Update the internal `Section` helper** (defined near the bottom of the file). Replace its body with:

```tsx
function Section({
  title,
  children,
  rightHeader,
}: {
  title: string;
  children: ReactNode;
  rightHeader?: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] p-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h3>
        {rightHeader}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 5: Update the `Row` helper** — replace its body with:

```tsx
function Row({
  label,
  children,
  rightSlot,
}: {
  label: string;
  children: ReactNode;
  rightSlot?: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-[var(--fg)]">{label}</label>
      <div className="flex items-center gap-2">
        {children}
        {rightSlot}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update the `Slider` helper** — replace the slider `<input>`'s className with `mac-slider` (defined in globals.css):

```tsx
<input
  type="range"
  data-testid={testId}
  value={value}
  min={min}
  max={max}
  step={step}
  onChange={(e) => onChange(Number(e.target.value))}
  className="mac-slider"
/>
```

Also update the slider's label/value row:

```tsx
<div className="flex items-center justify-between gap-2">
  <label className="text-sm text-[var(--fg)]">{label}</label>
  <div className="flex items-center gap-1">
    <span className="text-xs text-[var(--fg-muted)] tabular-nums">
      {display}
      {unit ?? ''}
    </span>
    {rightSlot}
  </div>
</div>
```

- [ ] **Step 7: Update every checkbox to Mac toggle.** Find each `<input type="checkbox" data-testid="settings-…" checked={…} onChange={…} className="accent-sky-500" />` (there are 3: edgeDock enabled, lifecycle restoreTabsOnLaunch, browsing defaultIsMobile) and replace each with the Mac toggle markup:

```tsx
<label className="mac-toggle">
  <input
    type="checkbox"
    data-testid="settings-edgedock-enabled"
    checked={settings.edgeDock.enabled}
    onChange={(e) => void update({ edgeDock: { enabled: e.target.checked } })}
  />
</label>
```

(Replace `settings-edgedock-enabled` with the respective testId; preserve every other prop verbatim.)

- [ ] **Step 8: Update every `<select>` className** in SettingsDrawer (there are 4: theme, window preset, dim effect, search active engine) to:

```tsx
className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1 text-sm text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
```

- [ ] **Step 9: Update the text `<input>` className for the mobile UA field** to:

```tsx
className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1 font-mono text-xs text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
```

- [ ] **Step 10: Update the `ResetIcon` className** to:

```tsx
className={`shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] ${show ? '' : 'invisible'}`}
```

- [ ] **Step 11: Update the SearchEngineEditor**:

The `<ul data-testid="settings-search-engines">` list rows: each `<li>` className becomes:

```tsx
className="flex items-center justify-between rounded-[var(--radius-md)] px-2 py-1 text-sm hover:bg-[var(--accent-tint)]"
```

The "built-in" label className:

```tsx
className="text-xs text-[var(--fg-muted)]"
```

The delete-engine `<button>` className:

```tsx
className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
```

The "Add custom engine" toggle button:

```tsx
className="flex items-center gap-1 self-start rounded-[var(--radius-md)] p-1.5 text-xs text-[var(--accent-text)] hover:bg-[var(--accent-tint)]"
```

The expanded panel `<div>` className:

```tsx
className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3"
```

The inner `<input>` className (×2 — name + template):

```tsx
className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
```

(Use `font-mono text-xs` instead of `text-sm` for the URL template input.)

The Cancel button:

```tsx
className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg)] hover:bg-[var(--accent-tint)]"
```

The Add (confirm) button:

```tsx
className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
```

The "Engines" label:

```tsx
className="text-xs font-medium text-[var(--fg-muted)]"
```

The "Name" / "URL template" sub-labels:

```tsx
className="text-xs font-medium text-[var(--fg-muted)]"
```

The "Must contain {query}" helper text:

```tsx
className="text-xs text-[var(--fg-muted)]"
```

- [ ] **Step 12: Typecheck + lint**

```
Run: pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 13: Run settings-related E2E**

```
Run: pnpm test:e2e settings-drawer theme search-engine
```
Expected: PASS — every selector is preserved.

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat(M14): SettingsDrawer restyle — cards, Mac toggles, refined sliders"
```

---

## Task 9: NewTab redesign (hero + greeting + Recent with Clear)

**Files:**
- Modify: `src/renderer/src/components/NewTab.tsx`

- [ ] **Step 1: Rewrite the entire file** with:

```tsx
import { useEffect, useMemo, useState, type ReactElement, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import type { HistoryEntry } from '@shared/types';
import appIconUrl from '@resources/icon.ico';
import { useActiveTab } from '../store/tab-store';
import { Favicon } from './Favicon';

const NEWTAB_RECENT_LIMIT = 12;

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 && hour < 23) return 'Good evening';
  return 'Hello';
}

export function NewTab(): ReactElement {
  const tab = useActiveTab();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  // Computed once at mount — page is short-lived; we don't redraw on tick.
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.sidebrowser
        .historyRecent(NEWTAB_RECENT_LIMIT)
        .then((es) => { if (!cancelled) setEntries(es); })
        .catch((err: unknown) => { console.error('[sidebrowser] NewTab historyRecent failed', err); });
    };
    load();
    const off = window.sidebrowser.onHistoryChanged(load);
    return () => { cancelled = true; off(); };
  }, []);

  const navigate = (url: string): void => {
    if (!tab) return;
    void window.sidebrowser.navigate(tab.id, url);
  };

  const remove = (e: MouseEvent, url: string): void => {
    e.stopPropagation();
    e.preventDefault();
    window.sidebrowser.historyRemove(url);
    setEntries((prev) => prev.filter((entry) => entry.url !== url));
  };

  const clearAll = (): void => {
    window.sidebrowser.historyClear();
    // Optimistic — main will broadcast history:changed which re-loads anyway.
    setEntries([]);
  };

  return (
    <div
      className="absolute inset-0 flex flex-col items-stretch overflow-y-auto bg-[var(--surface)] text-[var(--fg)]"
      data-testid="newtab"
    >
      <div className="flex flex-col items-center px-4 pt-12 pb-6">
        <img
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          className="mb-4 size-14 rounded-[var(--radius-lg)] shadow-[var(--shadow-card)]"
        />
        <h1 className="text-lg font-semibold tracking-tight">{greeting}</h1>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Pick up where you left off, or search above.
        </p>
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
          Recent
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            data-testid="newtab-clear"
            onClick={clearAll}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
          >
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div
          className="px-4 py-6 text-center text-sm text-[var(--fg-muted)]"
          data-testid="newtab-empty"
        >
          No recent pages yet.
        </div>
      ) : (
        <ul className="flex flex-col px-2 pb-6" data-testid="newtab-list">
          {entries.map((e) => (
            <li
              key={e.url}
              className="group flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] p-2 hover:bg-[var(--accent-tint)]"
              onMouseDown={(ev) => { ev.preventDefault(); navigate(e.url); }}
              data-testid="newtab-item"
            >
              <Favicon src={e.favicon} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{e.title || e.url}</div>
                <div className="truncate text-xs text-[var(--fg-muted)]">{e.url}</div>
              </div>
              <button
                type="button"
                aria-label="Remove from history"
                onMouseDown={(ev) => remove(ev, e.url)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] opacity-0 hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] focus-visible:opacity-100 group-hover:opacity-100"
                data-testid="newtab-remove"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```
Run: pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 3: Run NewTab E2E**

```
Run: pnpm test:e2e newtab
```
Expected: PASS. Existing selectors `newtab`, `newtab-empty`, `newtab-list`, `newtab-item`, `newtab-remove` are preserved.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/NewTab.tsx
git commit -m "feat(M14): NewTab redesign — hero + greeting + recent list + clear"
```

---

## Task 10: AddressSuggestions restyle

**Files:**
- Modify: `src/renderer/src/components/AddressSuggestions.tsx`

- [ ] **Step 1: Replace the outer `<ul>` className** with:

```tsx
className="absolute left-0 right-0 top-full mt-1.5 z-10 max-h-96 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-[var(--shadow-elevated)]"
```

- [ ] **Step 2: Replace each row `<li>` className** — the existing template uses `(i === highlightIdx ? 'bg-[var(--chrome-hover)]' : 'hover:bg-[var(--chrome-hover)]')`. Replace with:

```tsx
className={
  'flex items-center gap-2 cursor-pointer rounded-[var(--radius-md)] px-2 py-1.5 ' +
  (i === highlightIdx
    ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] '
    : 'hover:bg-[var(--accent-tint)] ')
}
```

- [ ] **Step 3: Replace the title `<div>` className** with `className="truncate text-sm"` (drop the explicit `text-[var(--chrome-fg)]` — token cascade from the parent handles it; preserve `text-sm`).

- [ ] **Step 4: Replace the URL `<div>` className** with:

```tsx
className="truncate text-xs text-[var(--fg-muted)]"
```

- [ ] **Step 5: Typecheck + lint + autocomplete E2E**

```
Run: pnpm typecheck && pnpm lint && pnpm test:e2e autocomplete
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/AddressSuggestions.tsx
git commit -m "feat(M14): AddressSuggestions restyle — rounded card, accent highlight"
```

---

## Task 11: Favicon — token color sweep

**Files:**
- Modify: `src/renderer/src/components/Favicon.tsx`

- [ ] **Step 1: Update the Globe fallback className** from `text-[var(--chrome-muted)]` to:

```tsx
className="shrink-0 text-[var(--fg-muted)]"
```

- [ ] **Step 2: Typecheck**

```
Run: pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Favicon.tsx
git commit -m "feat(M14): Favicon — token sweep"
```

---

## Task 12: E2E — theme parity smoke

**Files:**
- Create: `tests/e2e/macos-style.spec.ts`

- [ ] **Step 1: Write the test file** at `tests/e2e/macos-style.spec.ts`:

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ElectronApplication } from '@playwright/test';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, SIDEBROWSER_E2E: '1' },
  });
}

async function updateSettings(
  app: ElectronApplication,
  patch: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(async (_e, p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (globalThis as any).__sidebrowserTestHooks as {
      updateSettings: (patch: unknown) => unknown;
    };
    h.updateSettings(p);
  }, patch);
}

function hex(rgb: string): string {
  // "rgb(91, 141, 255)" -> "#5b8dff"
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return rgb;
  const to2 = (n: string): string => parseInt(n, 10).toString(16).padStart(2, '0');
  return ('#' + to2(m[1]!) + to2(m[2]!) + to2(m[3]!)).toLowerCase();
}

test.describe('M14 macOS-style tokens', () => {
  test('dark theme exposes --accent #5b8dff and --surface #1c1e24', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'dark' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );

        const accent = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--accent')
            .trim(),
        );
        const surface = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--surface')
            .trim(),
        );
        expect(accent.toLowerCase()).toBe('#5b8dff');
        expect(surface.toLowerCase()).toBe('#1c1e24');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('light theme exposes --accent #0066cc and --surface #f6f6f7', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'light' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'light',
        );

        const accent = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--accent')
            .trim(),
        );
        const surface = await win.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--surface')
            .trim(),
        );
        expect(accent.toLowerCase()).toBe('#0066cc');
        expect(surface.toLowerCase()).toBe('#f6f6f7');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('address bar uses --surface-sunken background after restyle', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-m14-'));
    try {
      const app = await launch(userDataDir);
      try {
        const win = await getChromeWindow(app);
        await waitForAddressBarReady(win);
        await updateSettings(app, { appearance: { theme: 'dark' } });
        await win.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );

        const addressBg = await win.evaluate(() => {
          const el = document.querySelector('[data-testid="address-bar"]');
          return el ? getComputedStyle(el).backgroundColor : '';
        });
        // --surface-sunken (dark) = #14161b = rgb(20, 22, 27)
        expect(hex(addressBg)).toBe('#14161b');
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build the app** (required because Playwright `_electron` launches the compiled main):

```
Run: pnpm build
```
Expected: success, `out/main/index.cjs` exists.

- [ ] **Step 3: Run the new test**

```
Run: pnpm test:e2e macos-style
```
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/macos-style.spec.ts
git commit -m "test(M14): e2e — theme-token parity (dark/light)"
```

---

## Task 13: Final verification + clean-up grep

**Files:** none (verification only)

- [ ] **Step 1: Verify no stale `--chrome-*` token references remain**

```
Run: pnpm exec grep -rE "--chrome-(bg|fg|border|hover|muted|input-bg|drawer-bg|accent)" src/
```
Expected: ZERO matches. If any remain, fix them in place and re-commit under the relevant task.

- [ ] **Step 2: Verify no new Chinese strings introduced in renderer**

```
Run: pnpm exec grep -rP "[\x{4e00}-\x{9fff}]" src/renderer/src --include="*.tsx"
```
Expected: ZERO matches. If any are found, replace with English equivalent and recommit under the relevant task.

- [ ] **Step 3: Full typecheck**

```
Run: pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Full lint**

```
Run: pnpm lint
```
Expected: PASS (clean — no new disable directives).

- [ ] **Step 5: Full unit test suite**

```
Run: pnpm test
```
Expected: PASS (every existing test + the new `title-bar-overlay`, `history-store.clearAll` tests).

- [ ] **Step 6: Full E2E suite**

```
Run: pnpm test:e2e
```
Expected: PASS — every existing E2E + the new `macos-style.spec.ts`. If any previously-green E2E fails because of a selector change, treat it as a bug in the earlier task; fix in place and recommit.

- [ ] **Step 7: Hand off to user for manual smoke** — at this point everything is green programmatically. The remaining items in §13 of the spec require eyeballs and live interaction (drag the chrome, see traffic light alternative — i.e. native Windows controls — refresh on theme change, EdgeDock hide/show with the new frameless mode). Report status and request smoke.

---

## Self-review notes

**Spec coverage:**

- §3 Tokens → Task 1. ✓
- §4 Window chrome (frameless + titleBarOverlay + theme sync) → Tasks 2, 3. ✓
- §5 TopBar restyle (+ drag region + titleBarOverlay reserve) → Task 6. ✓
- §6 TabDrawer restyle → Task 7. ✓
- §7 SettingsDrawer (cards + Mac toggle + Mac slider) → Task 8. ✓
- §8 NewTab redesign (+ clear button) → Task 9. ✓
- §9 AddressSuggestions restyle → Task 10. ✓
- §10 Favicon (token sweep) → Task 11. ✓
- §11 New IPC `history:clear` → Tasks 4 (store) + 5 (wire). ✓
- §12 Theme parity → Task 12. ✓
- §13 Test strategy → Task 13 + per-task E2E runs. ✓
- §15 Acceptance criteria (grep, no Chinese, all tests green) → Task 13 steps 1–6. ✓

**Cross-references checked:**

- `resolveTitleBarOverlay(theme)` signature consistent in Task 2 (creation) and Task 3 (consumption). ✓
- `HistoryStore.clearAll()` signature consistent in Task 4 (creation) and Task 5 (IPC wiring). ✓
- `historyClear` exposed by preload in Task 5 and consumed in Task 9 NewTab. ✓
- `data-testid="newtab-clear"` is a NEW selector in Task 9; not referenced by any prior task or existing test. (Documented in this plan as a new selector.) ✓
- `mac-slider` and `mac-toggle` CSS classes defined in Task 1 (globals.css) and consumed in Task 8. ✓
