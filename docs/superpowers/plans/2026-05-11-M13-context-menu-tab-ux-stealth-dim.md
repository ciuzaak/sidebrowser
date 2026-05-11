# M13 Implementation Plan — Web context menu, Tab UX polish, Stealth-grade dim

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web context menu (page / link / selection contexts), make `Ctrl+Tab` cycle tabs like a real browser with auto-collapsing TabDrawer, and deepen dim so it covers chrome + window title and `light` reaches pure white.

**Architecture:**
- Main: new pure `buildContextMenuTemplate` + new `TabCycler` (driven by `before-input-event`); `ViewManager` gains `activateRelativeTab` and an `onTabAttach` lifecycle hook.
- IPC: one new channel `cycle:state` (M→R) carrying `{ active }`.
- Renderer: `App.tsx` wires drawer-open from `(userToggle || cycling)`, drives chrome dim style from `windowState.dimmed` + `settings.dim` (no new IPC), and auto-closes settings on `activeId` change.
- CSS: `light` switches from `filter: brightness(N)` to `html::after { background:white; opacity:N }` overlay.

**Tech Stack:** Electron 41, React 19, Zustand 5, Tailwind 4, Vitest 4, Playwright 1.59, TypeScript 5, pnpm.

**Spec:** [docs/superpowers/specs/2026-05-11-M13-context-menu-tab-ux-stealth-dim-design.md](../specs/2026-05-11-M13-context-menu-tab-ux-stealth-dim-design.md)

**Per-task report convention** (per user memory):
After each task, post a single short bullet block:
- What you changed (1-line file list)
- Tests added / run + result
- Anything notable (skipped, deferred, surprises)
Wait for the user to drive plan changes; don't unilaterally re-scope.

---

## File Map

**New files:**
- `src/main/context-menu.ts` — pure builder for the web context menu template
- `src/main/tab-cycler.ts` — Ctrl+Tab cycle controller, attaches `before-input-event`
- `src/renderer/src/lib/chrome-dim.ts` — pure helper computing root style + overlay JSX for chrome-side dim
- `tests/unit/context-menu.test.ts`
- `tests/unit/tab-cycler.test.ts`
- `tests/unit/view-manager-relative.test.ts`
- `tests/unit/chrome-dim.test.ts`
- `tests/e2e/context-menu.spec.ts`
- `tests/e2e/tab-ux.spec.ts`

**Modified files:**
- `src/main/view-manager.ts` — `activateRelativeTab`, `onTabAttach` lifecycle, wire `wc.on('context-menu')`
- `src/main/keyboard-shortcuts.ts` — drop `CmdOrCtrl+Tab` row + matching test
- `src/main/index.ts` — construct context-menu deps, wire `TabCycler`, wrap `applyDim`/`clearDim` to clear OS title
- `src/main/build-filter-css.ts` — `light` returns `html::after` overlay; `dark`/`blur` unchanged
- `src/main/clamp-settings.ts` — `lightBrightness` clamp `[0,1]` (was `[1,3]`)
- `src/shared/settings-defaults.ts` — `lightBrightness: 0.5` (was `1.5`)
- `src/shared/ipc-contract.ts` — add `cycleState` channel + `IpcContract` entry
- `src/preload/index.ts` — add `onCycleState` subscriber
- `src/renderer/src/store/tab-store.ts` — add `cycling: boolean` + setter
- `src/renderer/src/hooks/useTabBridge.ts` — subscribe to `onCycleState`
- `src/renderer/src/App.tsx` — drawer-open derives from `(userToggle || cycling)`, drawer ∈ suppression source, settings auto-close on `activeId`, chrome dim wiring
- `src/renderer/src/components/TabDrawer.tsx` — outside-click listener via `ref` + `toggleRef`
- `src/renderer/src/components/SettingsDrawer.tsx` — outside-click listener; `light` slider 0–1; label "白度"; reset to 0.5
- `src/renderer/src/components/TopBar.tsx` — accept `tabsToggleRef` + `settingsToggleRef` from App
- `tests/unit/build-filter-css.test.ts` — update light expectations + add overlay assertions
- `tests/unit/clamp-settings.test.ts` — light range tests updated
- `tests/unit/keyboard-shortcuts.test.ts` — submenu length + accelerator table updated (10 entries instead of 11)
- `tests/e2e/mouse-leave-dim.spec.ts` — extend with chrome-dim + title-clear assertions

---

## Conventions for every task

- TDD: write a failing test first when feasible, run it to confirm failure, implement, run to confirm pass.
- After every commit, run `pnpm lint` only on changed files? No — repo's existing scripts run repo-wide and are fast. Run `pnpm typecheck` + `pnpm test` if you touched a file likely to ripple (shared types, IPC, store).
- Each task ends with a focused commit. Commit message format: `feat(M13): <short>`, `fix(M13): <short>`, `test(M13): <short>`, `refactor(M13): <short>`, or `docs(M13): <short>`.
- **Do NOT bypass hooks.** No `--no-verify`. If a hook fails, fix the underlying issue.
- **Do NOT run `pnpm dev` or build inside the agent.** User memory: `ELECTRON_RUN_AS_NODE` is set globally in their Git Bash; any Electron dev/build must `unset ELECTRON_RUN_AS_NODE` first. Just leave dev/E2E to the user when called for; this plan never asks the agent to run `pnpm dev`.
- Tests: `pnpm test` for vitest, `pnpm test:e2e` for Playwright. E2E may take 60–120s per spec; only run the spec you authored if iterating.
- For E2E targeting a specific spec: `pnpm test:e2e tests/e2e/<file>.spec.ts`.

---

## Task 1: Context menu pure builder

**Files:**
- Create: `src/main/context-menu.ts`
- Create: `tests/unit/context-menu.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/context-menu.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  buildContextMenuTemplate,
  type ContextMenuDeps,
} from '../../src/main/context-menu';

function makeDeps(overrides: Partial<ContextMenuDeps> = {}): ContextMenuDeps {
  return {
    openInSystemBrowser: vi.fn(),
    openInNewTab: vi.fn(),
    copyToClipboard: vi.fn(),
    searchSelection: vi.fn(),
    viewSource: vi.fn(),
    navigateActive: vi.fn(),
    canGoBack: true,
    canGoForward: true,
    activeSearchEngineName: 'Google',
    ...overrides,
  };
}

// Minimal ContextMenuParams stub — only the fields buildContextMenuTemplate reads.
function makeParams(overrides: Partial<{ linkURL: string; selectionText: string }> = {}): Electron.ContextMenuParams {
  return {
    linkURL: '',
    selectionText: '',
    ...overrides,
  } as unknown as Electron.ContextMenuParams;
}

describe('buildContextMenuTemplate', () => {
  const URL = 'https://example.com/page';

  it('page-only: emits 7 items (3 nav + sep + 2 page actions + sep + view source)', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    // 后退/前进/刷新 sep 系统打开/复制 sep 查看源代码 = 8 entries with separators
    const labels = tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));
    expect(labels).toEqual([
      '后退',
      '前进',
      '刷新',
      '---',
      '在系统浏览器打开此页',
      '复制此页 URL',
      '---',
      '查看源代码',
    ]);
  });

  it('page-only with !canGoBack disables 后退', () => {
    const deps = makeDeps({ canGoBack: false });
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const back = tpl.find((i) => i.label === '后退');
    expect(back?.enabled).toBe(false);
    const forward = tpl.find((i) => i.label === '前进');
    expect(forward?.enabled).toBe(true);
  });

  it('link present: prepends 3 link items + separator', () => {
    const deps = makeDeps();
    const linkURL = 'https://target.example/x';
    const tpl = buildContextMenuTemplate(makeParams({ linkURL }), deps, URL);
    const labels = tpl.slice(0, 4).map((i) => i.label ?? '---');
    expect(labels).toEqual([
      '在新标签页打开链接',
      '在系统浏览器打开链接',
      '复制链接地址',
      '---',
    ]);
    tpl[0].click!();
    expect(deps.openInNewTab).toHaveBeenCalledWith(linkURL);
    tpl[1].click!();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(linkURL);
    tpl[2].click!();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(linkURL);
  });

  it('selection present: prepends 复制 + 用 {engine} 搜索 ... with truncation', () => {
    const deps = makeDeps({ activeSearchEngineName: 'Google' });
    const long = 'x'.repeat(45);
    const tpl = buildContextMenuTemplate(makeParams({ selectionText: long }), deps, URL);
    expect(tpl[0].label).toBe('复制');
    expect(tpl[1].label).toMatch(/^用 Google 搜索 "x{30}…"$/);
    expect(tpl[2].type).toBe('separator');
    tpl[0].click!();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(long);
    tpl[1].click!();
    expect(deps.searchSelection).toHaveBeenCalledWith(long);
  });

  it('selection collapses internal whitespace before truncating', () => {
    const deps = makeDeps();
    const noisy = '  foo\n\t  bar  baz  ';
    const tpl = buildContextMenuTemplate(makeParams({ selectionText: noisy }), deps, URL);
    expect(tpl[1].label).toBe('用 Google 搜索 "foo bar baz"');
  });

  it('link + selection: 5 items before separator, in order [复制, 搜索, sep, 链接3, sep, 页面...]', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(
      makeParams({ linkURL: 'https://l/', selectionText: 'q' }),
      deps,
      URL,
    );
    expect(tpl[0].label).toBe('复制');
    expect(tpl[1].label).toBe('用 Google 搜索 "q"');
    expect(tpl[2].type).toBe('separator');
    expect(tpl[3].label).toBe('在新标签页打开链接');
  });

  it('page-section navigation/view-source/copy/open clicks route to the right deps', () => {
    const deps = makeDeps();
    const tpl = buildContextMenuTemplate(makeParams(), deps, URL);
    const byLabel = (l: string) => tpl.find((i) => i.label === l);
    byLabel('后退')!.click!();
    expect(deps.navigateActive).toHaveBeenCalledWith('back');
    byLabel('前进')!.click!();
    expect(deps.navigateActive).toHaveBeenCalledWith('forward');
    byLabel('刷新')!.click!();
    expect(deps.navigateActive).toHaveBeenCalledWith('reload');
    byLabel('在系统浏览器打开此页')!.click!();
    expect(deps.openInSystemBrowser).toHaveBeenCalledWith(URL);
    byLabel('复制此页 URL')!.click!();
    expect(deps.copyToClipboard).toHaveBeenCalledWith(URL);
    byLabel('查看源代码')!.click!();
    expect(deps.viewSource).toHaveBeenCalledWith(URL);
  });

  it('is pure: building does not invoke any deps callbacks', () => {
    const deps = makeDeps();
    buildContextMenuTemplate(makeParams({ linkURL: 'x', selectionText: 'y' }), deps, URL);
    expect(deps.openInSystemBrowser).not.toHaveBeenCalled();
    expect(deps.openInNewTab).not.toHaveBeenCalled();
    expect(deps.copyToClipboard).not.toHaveBeenCalled();
    expect(deps.searchSelection).not.toHaveBeenCalled();
    expect(deps.viewSource).not.toHaveBeenCalled();
    expect(deps.navigateActive).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test tests/unit/context-menu.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/context-menu'`.

- [ ] **Step 3: Implement the pure builder**

Create `src/main/context-menu.ts`:

```ts
/**
 * context-menu.ts — Pure builder for the web context-menu template (M13).
 *
 * Three context tiers stack top-to-bottom: selection block (if any selection
 * text) → link block (if right-clicked element has a link URL) → page block
 * (always). Each block ends with its own separator before the next block.
 *
 * Like keyboard-shortcuts.ts this is type-only on `electron` — no runtime
 * import — so vitest can build the template without spinning up an Electron
 * runtime. The actual `Menu.buildFromTemplate` + `popup` happens in
 * view-manager's context-menu handler.
 */

import type { MenuItemConstructorOptions, ContextMenuParams } from 'electron';

export interface ContextMenuDeps {
  /** shell.openExternal(url) (sanitized at the call site). */
  openInSystemBrowser: (url: string) => void;
  /** viewManager.createTab(url). */
  openInNewTab: (url: string) => void;
  /** clipboard.writeText(text). */
  copyToClipboard: (text: string) => void;
  /** Resolve active search engine + open as a new tab. */
  searchSelection: (text: string) => void;
  /** viewManager.createTab(`view-source:${url}`). */
  viewSource: (url: string) => void;
  /** Delegates to ViewManager.{goBackActive,goForwardActive,reloadActive}. */
  navigateActive: (action: 'back' | 'forward' | 'reload') => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Display name of the currently-active search engine — feeds the selection-search label. */
  activeSearchEngineName: string;
}

const SEP: MenuItemConstructorOptions = { type: 'separator' };

/** Collapse whitespace then truncate to 30 chars + ellipsis. */
function truncateForLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 30) return collapsed;
  return collapsed.slice(0, 30) + '…';
}

export function buildContextMenuTemplate(
  params: ContextMenuParams,
  deps: ContextMenuDeps,
  currentTabUrl: string,
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];

  const selection = params.selectionText ?? '';
  if (selection.trim() !== '') {
    out.push(
      { label: '复制', click: () => deps.copyToClipboard(selection) },
      {
        label: `用 ${deps.activeSearchEngineName} 搜索 "${truncateForLabel(selection)}"`,
        click: () => deps.searchSelection(selection),
      },
      SEP,
    );
  }

  const linkURL = params.linkURL ?? '';
  if (linkURL !== '') {
    out.push(
      { label: '在新标签页打开链接', click: () => deps.openInNewTab(linkURL) },
      { label: '在系统浏览器打开链接', click: () => deps.openInSystemBrowser(linkURL) },
      { label: '复制链接地址', click: () => deps.copyToClipboard(linkURL) },
      SEP,
    );
  }

  out.push(
    { label: '后退', enabled: deps.canGoBack, click: () => deps.navigateActive('back') },
    { label: '前进', enabled: deps.canGoForward, click: () => deps.navigateActive('forward') },
    { label: '刷新', click: () => deps.navigateActive('reload') },
    SEP,
    { label: '在系统浏览器打开此页', click: () => deps.openInSystemBrowser(currentTabUrl) },
    { label: '复制此页 URL', click: () => deps.copyToClipboard(currentTabUrl) },
    SEP,
    { label: '查看源代码', click: () => deps.viewSource(currentTabUrl) },
  );

  return out;
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `pnpm test tests/unit/context-menu.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/context-menu.ts tests/unit/context-menu.test.ts
git commit -m "feat(M13): pure context-menu template builder + tests"
```

---

## Task 2: Wire context menu in ViewManager

**Files:**
- Modify: `src/main/view-manager.ts` — add `wc.on('context-menu', ...)` inside `attachWebContentsEvents`; expose deps via constructor or a new attach hook.
- Modify: `src/main/index.ts` — construct `ContextMenuDeps` and pass them to `ViewManager`.

- [ ] **Step 1: Extend ViewManager constructor signature**

Modify the `ViewManager` constructor at `src/main/view-manager.ts` to accept context-menu deps. Add a 4th constructor parameter; default `null` so existing tests don't break:

```ts
import type { ContextMenuDeps } from './context-menu';
import { buildContextMenuTemplate } from './context-menu';
import { createRequire } from 'node:module';

// At top of file (next to other imports), keep require lazy like keyboard-shortcuts:
const requireCjs = createRequire(import.meta.url);

constructor(
  window: BrowserWindow,
  getBrowsingDefaults: BrowsingDefaultsGetter,
  recorder: HistoryRecorder | null = null,
  contextMenuDeps: ContextMenuDeps | null = null,    // <— new
) {
  // ... existing body
  this.window = window;
  this.getBrowsingDefaults = getBrowsingDefaults;
  this.recorder = recorder;
  this.contextMenuDeps = contextMenuDeps;
  // ... rest unchanged
}

private readonly contextMenuDeps: ContextMenuDeps | null;
```

- [ ] **Step 2: Wire `context-menu` listener inside `attachWebContentsEvents`**

In `attachWebContentsEvents(id, view)`, near the other `wc.on(...)` registrations, add:

```ts
const onContextMenu = (e: Electron.Event, params: Electron.ContextMenuParams): void => {
  if (!this.contextMenuDeps) return;
  e.preventDefault();
  const tab = this.tabs.get(id)?.tab;
  const currentUrl = tab?.url ?? '';
  // Per-event deps refresh: canGoBack/canGoForward come from this tab's nav history,
  // overriding what was passed at constructor time.
  const deps: ContextMenuDeps = {
    ...this.contextMenuDeps,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
  const template = buildContextMenuTemplate(params, deps, currentUrl);
  const { Menu } = requireCjs('electron') as {
    Menu: { buildFromTemplate(t: Electron.MenuItemConstructorOptions[]): Electron.Menu };
  };
  Menu.buildFromTemplate(template).popup({ window: this.window });
};
wc.on('context-menu', onContextMenu);
```

Add `wc.off('context-menu', onContextMenu);` to the returned detach closure alongside the other `off`s.

- [ ] **Step 3: Construct ContextMenuDeps in `index.ts` and pass to ViewManager**

In `src/main/index.ts`, before the `new ViewManager(...)` call, build the deps. Add `shell` and `clipboard` to the existing electron import:

```ts
import { app, BrowserWindow, screen, nativeTheme, ipcMain, shell, clipboard } from 'electron';
```

Add a helper near the bottom of `app.whenReady().then(() => {`:

```ts
const APP_TITLE = 'sidebrowser';

// Resolve the current search engine's URL template from settings.
const buildSearchUrlForSelection = (text: string): string => {
  const s = settingsStore.get().search;
  const tpl =
    s.engines.find((e) => e.id === s.activeId)?.urlTemplate ??
    'https://www.google.com/search?q={query}';
  return tpl.replace('{query}', encodeURIComponent(text));
};
const activeSearchEngineName = (): string => {
  const s = settingsStore.get().search;
  return s.engines.find((e) => e.id === s.activeId)?.name ?? 'Google';
};

const contextMenuDeps = {
  openInSystemBrowser: (url: string) => { void shell.openExternal(url); },
  openInNewTab: (url: string) => { viewManager.createTab(url); },
  copyToClipboard: (text: string) => { clipboard.writeText(text); },
  searchSelection: (text: string) => { viewManager.createTab(buildSearchUrlForSelection(text)); },
  viewSource: (url: string) => { viewManager.createTab(`view-source:${url}`); },
  navigateActive: (a: 'back' | 'forward' | 'reload') => {
    if (a === 'back') viewManager.goBackActive();
    else if (a === 'forward') viewManager.goForwardActive();
    else viewManager.reloadActive();
  },
  canGoBack: false,             // overwritten per-event in ViewManager
  canGoForward: false,          // overwritten per-event
  get activeSearchEngineName() { return activeSearchEngineName(); },
};
```

`viewManager` is initialized further up; the deps reference it via closure. The `get activeSearchEngineName()` getter is a plain object property — JavaScript getters work in object literals, so the deps stay live with current settings. Move the `new ViewManager(...)` line BELOW these helpers if needed to satisfy use-before-init lint, OR construct deps after the ViewManager is created (deps pass via a setter).

Simpler ordering: construct deps **after** ViewManager (they only reference it via closures, deferred), then call a new `viewManager.setContextMenuDeps(deps)` setter:

In ViewManager add:

```ts
setContextMenuDeps(deps: ContextMenuDeps): void {
  // mutable cast — field declared readonly via ! pattern is overkill; use a non-readonly field.
  (this as { contextMenuDeps: ContextMenuDeps | null }).contextMenuDeps = deps;
}
```

Or just declare `contextMenuDeps` as a non-readonly field. Pick whichever lints cleaner — favor the non-readonly route:

```ts
private contextMenuDeps: ContextMenuDeps | null = null;
```

(remove from constructor params; remove default in constructor body; add `setContextMenuDeps`).

In `index.ts` after both ViewManager + deps exist:

```ts
viewManager.setContextMenuDeps(contextMenuDeps);
```

- [ ] **Step 4: Run repo-wide typecheck and unit tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. ViewManager constructor existing tests should not break (the parameter was removed, not added). If test fixtures pass extra args, they're ignored.

- [ ] **Step 5: Commit**

```bash
git add src/main/view-manager.ts src/main/index.ts
git commit -m "feat(M13): wire web context menu via wc.on('context-menu')"
```

---

## Task 3: ViewManager.activateRelativeTab + onTabAttach lifecycle

**Files:**
- Modify: `src/main/view-manager.ts`
- Create: `tests/unit/view-manager-relative.test.ts`

- [ ] **Step 1: Write the failing test for `activateRelativeTab`**

Note: ViewManager is hard to unit-test because it constructs `WebContentsView` directly. Existing tests like `view-manager-history.test.ts` only exercise the pure `bindHistoryRecorderEvents` free function, not the class. So we test `activateRelativeTab` via a small refactor: extract the math into a free function `nextRelativeIndex(order, activeId, delta)`.

Create `tests/unit/view-manager-relative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextRelativeIndex } from '../../src/main/view-manager';

describe('nextRelativeIndex', () => {
  it('forward by 1 wraps from last to first', () => {
    expect(nextRelativeIndex(['a', 'b', 'c'], 'c', +1)).toBe(0);
  });
  it('backward by 1 wraps from first to last', () => {
    expect(nextRelativeIndex(['a', 'b', 'c'], 'a', -1)).toBe(2);
  });
  it('forward by 1 in middle', () => {
    expect(nextRelativeIndex(['a', 'b', 'c'], 'b', +1)).toBe(2);
  });
  it('returns -1 when active id is unknown', () => {
    expect(nextRelativeIndex(['a', 'b'], 'gone', +1)).toBe(-1);
  });
  it('returns -1 when order is empty', () => {
    expect(nextRelativeIndex([], 'a', +1)).toBe(-1);
  });
  it('returns 0 (no movement) when single tab', () => {
    expect(nextRelativeIndex(['only'], 'only', +1)).toBe(0);
    expect(nextRelativeIndex(['only'], 'only', -1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test tests/unit/view-manager-relative.test.ts`
Expected: FAIL — `nextRelativeIndex is not a function`.

- [ ] **Step 3: Implement `nextRelativeIndex` and `activateRelativeTab`**

In `src/main/view-manager.ts`, add a free function near the existing `nextZoomFactor`:

```ts
/**
 * Pure index math for tab cycling. Returns -1 if `order` is empty or `activeId`
 * is not found. With a single tab, returns 0 so callers can no-op via id equality.
 */
export function nextRelativeIndex(
  order: readonly string[],
  activeId: string,
  delta: 1 | -1,
): number {
  if (order.length === 0) return -1;
  const idx = order.indexOf(activeId);
  if (idx === -1) return -1;
  const N = order.length;
  return ((idx + delta) % N + N) % N;
}
```

Add the public method on `ViewManager`:

```ts
/** Cycle to the next/prev tab by tabOrder. No-op when ≤1 tab or activeId missing. */
activateRelativeTab(delta: 1 | -1): void {
  if (!this.activeId) return;
  const order = Array.from(this.tabs.keys());
  const next = nextRelativeIndex(order, this.activeId, delta);
  if (next === -1) return;
  const nextId = order[next];
  if (nextId === this.activeId) return;
  this.activateTab(nextId);
}
```

- [ ] **Step 4: Add the `onTabAttach` lifecycle hook**

In `ViewManager`, near `onTabUpdated` / `onSnapshot`:

```ts
private readonly tabAttachListeners = new Set<(wc: Electron.WebContents) => void>();

/**
 * Subscribe to per-tab WebContents attachment. Fires once at createTab time
 * for each new tab. Used by TabCycler to install before-input-event on every
 * tab as it appears. Returns an unsubscribe function.
 *
 * Does NOT fire retroactively for already-existing tabs — register before
 * the first createTab call (matches usage in index.ts bootstrap).
 */
onTabAttach(listener: (wc: Electron.WebContents) => void): () => void {
  this.tabAttachListeners.add(listener);
  return () => this.tabAttachListeners.delete(listener);
}

private emitTabAttach(wc: Electron.WebContents): void {
  for (const l of this.tabAttachListeners) {
    try { l(wc); } catch (err) {
      console.error('[sidebrowser] onTabAttach listener threw:', err);
    }
  }
}
```

Inside `createTab`, after `this.tabs.set(id, managed);`, call `this.emitTabAttach(view.webContents);`. Order matters: emit AFTER the tab is registered so any listener that calls back into ViewManager (e.g., to read snapshot) sees the new tab.

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm test tests/unit/view-manager-relative.test.ts && pnpm test tests/unit/view-manager-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/view-manager.ts tests/unit/view-manager-relative.test.ts
git commit -m "feat(M13): activateRelativeTab + onTabAttach lifecycle hook"
```

---

## Task 4: TabCycler module

**Files:**
- Create: `src/main/tab-cycler.ts`
- Create: `tests/unit/tab-cycler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tab-cycler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TabCycler } from '../../src/main/tab-cycler';

interface FakeInput {
  type: 'keyDown' | 'keyUp';
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

interface FakeWc {
  handlers: ((e: { defaultPrevented?: boolean }, input: FakeInput) => void)[];
  on(event: 'before-input-event', cb: (e: { defaultPrevented?: boolean }, input: FakeInput) => void): void;
  off(event: 'before-input-event', cb: (e: { defaultPrevented?: boolean }, input: FakeInput) => void): void;
  emit(input: FakeInput): { preventDefault: () => void; defaultPrevented: boolean };
}

function makeWc(): FakeWc {
  const wc: FakeWc = {
    handlers: [],
    on(_e, cb) { this.handlers.push(cb); },
    off(_e, cb) { this.handlers = this.handlers.filter((h) => h !== cb); },
    emit(input) {
      const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const h of this.handlers) h(ev, input);
      return ev;
    },
  };
  return wc;
}

const input = (overrides: Partial<FakeInput>): FakeInput => ({
  type: 'keyDown', key: '', control: false, shift: false, alt: false, meta: false, ...overrides,
});

describe('TabCycler', () => {
  it('Ctrl+Tab keyDown advances and broadcasts active=true on first press', () => {
    const activateNext = vi.fn();
    const activatePrev = vi.fn();
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev, broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);

    const ev = wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).toHaveBeenCalledTimes(1);
    expect(broadcastCycleState).toHaveBeenCalledWith(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('subsequent Ctrl+Tab does not re-broadcast active=true (idempotent)', () => {
    const activateNext = vi.fn();
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev: vi.fn(), broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);

    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).toHaveBeenCalledTimes(2);
    expect(broadcastCycleState).toHaveBeenCalledTimes(1);
    expect(broadcastCycleState).toHaveBeenCalledWith(true);
  });

  it('Ctrl+Shift+Tab calls activatePrev', () => {
    const activateNext = vi.fn();
    const activatePrev = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev, broadcastCycleState: vi.fn() });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true, shift: true }));
    expect(activatePrev).toHaveBeenCalledTimes(1);
    expect(activateNext).not.toHaveBeenCalled();
  });

  it('Control keyUp ends cycle and broadcasts active=false', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext: vi.fn(), activatePrev: vi.fn(), broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    wc.emit(input({ type: 'keyUp', key: 'Control' }));
    expect(broadcastCycleState).toHaveBeenNthCalledWith(1, true);
    expect(broadcastCycleState).toHaveBeenNthCalledWith(2, false);
  });

  it('keyUp Control with no active cycle is a no-op', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext: vi.fn(), activatePrev: vi.fn(), broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyUp', key: 'Control' }));
    expect(broadcastCycleState).not.toHaveBeenCalled();
  });

  it('Tab without Ctrl is ignored', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev: vi.fn(), broadcastCycleState: vi.fn() });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    const ev = wc.emit(input({ type: 'keyDown', key: 'Tab' }));
    expect(activateNext).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Ctrl+Alt+Tab is ignored (alt modifier blocks the cycle)', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev: vi.fn(), broadcastCycleState: vi.fn() });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true, alt: true }));
    expect(activateNext).not.toHaveBeenCalled();
  });

  it('end() force-stops the cycle and broadcasts false (only if active)', () => {
    const broadcastCycleState = vi.fn();
    const cycler = new TabCycler({ activateNext: vi.fn(), activatePrev: vi.fn(), broadcastCycleState });
    const wc = makeWc();
    cycler.attach(wc as unknown as Electron.WebContents);
    cycler.end(); // not active — no broadcast
    expect(broadcastCycleState).not.toHaveBeenCalled();
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    cycler.end();
    expect(broadcastCycleState).toHaveBeenNthCalledWith(2, false);
  });

  it('attach returns a detach that removes the listener', () => {
    const activateNext = vi.fn();
    const cycler = new TabCycler({ activateNext, activatePrev: vi.fn(), broadcastCycleState: vi.fn() });
    const wc = makeWc();
    const detach = cycler.attach(wc as unknown as Electron.WebContents);
    detach();
    wc.emit(input({ type: 'keyDown', key: 'Tab', control: true }));
    expect(activateNext).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test tests/unit/tab-cycler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TabCycler`**

Create `src/main/tab-cycler.ts`:

```ts
/**
 * tab-cycler.ts — Ctrl+Tab cycle controller (M13).
 *
 * Replaces the M8 Application-Menu accelerator-driven "toggle drawer" behavior
 * with hold-Ctrl-cycle-tabs semantics matching Firefox/Edge:
 *   - Ctrl+Tab keyDown → advance to next tab + broadcast cycle:active=true
 *   - Ctrl+Shift+Tab keyDown → previous tab
 *   - Control keyUp → broadcast cycle:active=false (drawer auto-closes)
 *
 * Why before-input-event instead of Application Menu accelerators: Electron
 * menu accelerators fire on key-down only. We need key-up to know when the
 * user releases Ctrl. The host BrowserWindow's webContents AND every tab's
 * webContents must each have the listener attached; whichever has focus
 * fires the event. Cycler centralizes the cross-WC state (`cycling: bool`).
 *
 * The `cycling` flag is broadcast once per transition — repeated keyDowns
 * while cycling do not re-emit `active=true`. Both transitions are
 * idempotent at the source.
 */

import type { WebContents, Input, Event as ElectronEvent } from 'electron';

export interface TabCyclerDeps {
  activateNext: () => void;
  activatePrev: () => void;
  broadcastCycleState: (active: boolean) => void;
}

export class TabCycler {
  private cycling = false;

  constructor(private readonly deps: TabCyclerDeps) {}

  /**
   * Install the before-input-event listener on `wc`. Returns a detach closure
   * that removes the listener (no-op if `wc` was destroyed).
   */
  attach(wc: WebContents): () => void {
    const handler = (e: ElectronEvent, input: Input): void => {
      // Tab + Ctrl, no other modifiers → cycle.
      if (
        input.type === 'keyDown' &&
        input.key === 'Tab' &&
        input.control &&
        !input.alt &&
        !input.meta
      ) {
        e.preventDefault();
        if (input.shift) this.deps.activatePrev();
        else this.deps.activateNext();
        if (!this.cycling) {
          this.cycling = true;
          this.deps.broadcastCycleState(true);
        }
        return;
      }
      // Ctrl release → end cycle (one-shot broadcast).
      if (input.type === 'keyUp' && input.key === 'Control' && this.cycling) {
        this.cycling = false;
        this.deps.broadcastCycleState(false);
      }
    };
    wc.on('before-input-event', handler);
    return () => {
      try { wc.off('before-input-event', handler); } catch { /* destroyed */ }
    };
  }

  /**
   * Force-end the cycle (e.g. window blur). No-op when not currently cycling
   * to keep the broadcast stream clean.
   */
  end(): void {
    if (!this.cycling) return;
    this.cycling = false;
    this.deps.broadcastCycleState(false);
  }
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `pnpm test tests/unit/tab-cycler.test.ts`
Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/tab-cycler.ts tests/unit/tab-cycler.test.ts
git commit -m "feat(M13): TabCycler — before-input-event driven Ctrl+Tab cycle"
```

---

## Task 5: cycle:state IPC + preload + tab-store cycling field

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/store/tab-store.ts`
- Modify: `src/renderer/src/hooks/useTabBridge.ts`
- Modify: `tests/unit/ipc-contract.test.ts` (if it exists; otherwise skip — typecheck covers contract shape)

- [ ] **Step 1: Add the channel to IpcChannels + IpcContract**

In `src/shared/ipc-contract.ts`, add after `chromeShortcut`:

```ts
  /** Main → renderer event. Fires on cycle start (active=true) + cycle end (active=false). */
  cycleState: 'cycle:state',
```

And in `IpcContract`:

```ts
  [IpcChannels.cycleState]: {
    request: { active: boolean };
    response: void;
  };
```

- [ ] **Step 2: Expose `onCycleState` in the preload API**

In `src/preload/index.ts`, add inside the `api` object (next to `onShortcut`):

```ts
  /** Subscribe to TabCycler broadcasts. payload.active=true when cycling started, false on end. */
  onCycleState: (cb: (active: boolean) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { active: boolean }): void => cb(p.active);
    ipcRenderer.on(IpcChannels.cycleState, handler);
    return () => ipcRenderer.off(IpcChannels.cycleState, handler);
  },
```

- [ ] **Step 3: Add `cycling` to the tab store**

In `src/renderer/src/store/tab-store.ts`, extend `TabsState`:

```ts
interface TabsState {
  tabs: Record<string, Tab>;
  tabOrder: string[];
  activeId: string | null;
  /** True while the user is mid-Ctrl+Tab-cycle (broadcast by main). Drives drawer visibility in App.tsx. */
  cycling: boolean;
  setSnapshot: (snapshot: TabsSnapshot) => void;
  upsertTab: (tab: Tab) => void;
  setCycling: (active: boolean) => void;
}
```

In the `create` body:

```ts
  cycling: false,
  setCycling: (active) => set({ cycling: active }),
```

- [ ] **Step 4: Subscribe in useTabBridge**

In `src/renderer/src/hooks/useTabBridge.ts`:

```ts
export function useTabBridge(): void {
  const setSnapshot = useTabsStore((s) => s.setSnapshot);
  const upsertTab = useTabsStore((s) => s.upsertTab);
  const setCycling = useTabsStore((s) => s.setCycling);

  useEffect(() => {
    const unsubSnapshot = window.sidebrowser.onTabsSnapshot((snapshot) => {
      setSnapshot(snapshot);
    });
    const unsubUpdated = window.sidebrowser.onTabUpdated((tab) => {
      upsertTab(tab);
    });
    const unsubCycle = window.sidebrowser.onCycleState((active) => {
      setCycling(active);
    });
    void window.sidebrowser.requestTabsSnapshot().then(setSnapshot);
    return () => {
      unsubSnapshot();
      unsubUpdated();
      unsubCycle();
    };
  }, [setSnapshot, upsertTab, setCycling]);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/renderer/src/store/tab-store.ts src/renderer/src/hooks/useTabBridge.ts
git commit -m "feat(M13): cycle:state IPC + tab-store cycling field"
```

---

## Task 6: Wire TabCycler in main; drop Ctrl+Tab from Application Menu

**Files:**
- Modify: `src/main/keyboard-shortcuts.ts`
- Modify: `tests/unit/keyboard-shortcuts.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Update the keyboard-shortcuts test for the new submenu count**

In `tests/unit/keyboard-shortcuts.test.ts`:
1. Change "11 submenu entries" → "10 submenu entries". Update the rationale comment (mention M13 dropped Ctrl+Tab).
2. Remove the `['Toggle Tab Drawer', 'CmdOrCtrl+Tab']` row from the `expected` table.
3. In the "Direct handler routing" test, the `directCases` indices need to shift if the removed item was in the middle. Looking at the existing template ORDER: New Tab(0), Close Tab(1), Focus Address Bar(2), Reload(3), Reload F5(4), Back(5), Forward(6), Toggle Tab Drawer(7), Toggle Settings(8), Reset Zoom(9), Toggle DevTools(10).

After removal: indices 0..6 unchanged; previously-8 Toggle Settings → 7; previously-9 Reset Zoom → 8; previously-10 Toggle DevTools → 9. Update both `directCases` and `emitCases` index numbers in the test:

```ts
    const directCases: Array<[number, keyof typeof deps.spies]> = [
      [0, 'onNewTab'],
      [1, 'onCloseActiveTab'],
      [3, 'onReloadActive'],
      [4, 'onReloadActive'],
      [5, 'onGoBack'],
      [6, 'onGoForward'],
      [8, 'onResetZoom'],
      [9, 'onToggleDevTools'],
    ];
```

```ts
    const emitCases: Array<[number, 'focus-address-bar' | 'toggle-settings-drawer']> = [
      [2, 'focus-address-bar'],
      [7, 'toggle-settings-drawer'],
    ];
```

Also: remove `'toggle-tab-drawer'` from the `ShortcutAction` union (next step).

- [ ] **Step 2: Drop the Ctrl+Tab row from the submenu template**

In `src/main/keyboard-shortcuts.ts`, remove the line:

```ts
{ label: 'Toggle Tab Drawer', accelerator: 'CmdOrCtrl+Tab', click: () => deps.emitToRenderer('toggle-tab-drawer') },
```

In `src/shared/ipc-contract.ts`, narrow the `ShortcutAction` union — remove `'toggle-tab-drawer'`. Update the comment block above:

```ts
export type ShortcutAction =
  | 'focus-address-bar'
  | 'toggle-settings-drawer';
```

In `src/renderer/src/App.tsx`, the `onShortcut` switch already handles `toggle-tab-drawer`. Remove that case (cycle handles drawer visibility instead). Keep the `focus-address-bar` and `toggle-settings-drawer` branches.

```ts
useEffect(() => {
  return window.sidebrowser.onShortcut((action) => {
    switch (action) {
      case 'focus-address-bar': {
        const input = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
        input?.focus();
        input?.select();
        return;
      }
      case 'toggle-settings-drawer':
        toggleSettings();
        return;
    }
  });
}, [toggleSettings]);
```

(Remove `toggleDrawer` from the dep array; it's still used elsewhere.)

- [ ] **Step 3: Wire TabCycler in `index.ts`**

In `src/main/index.ts`, after the `viewManager` is created and `setContextMenuDeps` runs, instantiate the cycler:

```ts
import { TabCycler } from './tab-cycler';
import { IpcChannels } from '@shared/ipc-contract';
// ...

const cycler = new TabCycler({
  activateNext: () => viewManager.activateRelativeTab(+1),
  activatePrev: () => viewManager.activateRelativeTab(-1),
  broadcastCycleState: (active) => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.cycleState, { active });
  },
});
cycler.attach(win.webContents);
viewManager.onTabAttach((wc) => { cycler.attach(wc); });
win.on('blur', () => cycler.end());
```

Order: this block lives AFTER `installApplicationMenu(...)` (no dep on it) and AFTER `viewManager.setContextMenuDeps(contextMenuDeps);` (no dep, just keeps related wiring grouped). The `cycler.attach(win.webContents)` line catches keystrokes when chrome (renderer) has focus; the `onTabAttach` line catches keystrokes when a tab has focus.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Updated keyboard-shortcuts tests + TabCycler tests + everything else green.

- [ ] **Step 5: Commit**

```bash
git add src/main/keyboard-shortcuts.ts src/shared/ipc-contract.ts src/main/index.ts src/renderer/src/App.tsx tests/unit/keyboard-shortcuts.test.ts
git commit -m "feat(M13): wire TabCycler; drop CmdOrCtrl+Tab toggle accelerator"
```

---

## Task 7: App.tsx — drawer-open derives from (userToggle || cycling); drawer ∈ suppression source

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Pull cycling from store; derive drawer-open**

In `src/renderer/src/App.tsx`, replace the existing `drawerOpen` `useState` block:

```ts
import { useTabsStore, useActiveTab } from './store/tab-store';
// ...
const cycling = useTabsStore((s) => s.cycling);
const [userDrawerOpen, setUserDrawerOpen] = useState(false);
const drawerOpen = userDrawerOpen || cycling;

const toggleDrawer = useCallback(() => setUserDrawerOpen((v) => !v), []);
const closeDrawer = useCallback(() => setUserDrawerOpen(false), []);
```

Drawer rendering already keys off `drawerOpen` — no change needed there. The `closeDrawer` callback continues to clear only the user toggle; cycle-driven open is owned by the broadcast.

- [ ] **Step 2: Add drawer to the suppression source set**

```ts
const suppressed = settingsOpen || suggestionsOpen || isNewTab || drawerOpen;
```

This is needed so outside-click on the page area (Task 8) is captured by the renderer DOM rather than swallowed by the WebContentsView.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(M13): drawer-open = userToggle || cycling; drawer suppresses view"
```

---

## Task 8: TabDrawer outside-click

**Files:**
- Modify: `src/renderer/src/components/TabDrawer.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Lift the toggle button ref into App**

In `App.tsx`:

```ts
import { useRef } from 'react';
// ...
const tabsToggleRef = useRef<HTMLButtonElement | null>(null);
```

Pass `tabsToggleRef` to BOTH `TopBar` (so it can attach the ref to the Layers icon button) and `TabDrawer` (so it can ignore mousedown on the toggle):

```tsx
<TopBar
  drawerOpen={drawerOpen}
  onToggleDrawer={toggleDrawer}
  tabsToggleRef={tabsToggleRef}
  // ...
/>
<TabDrawer
  open={drawerOpen}
  onSelect={closeDrawer}
  onOutsideClose={closeDrawer}
  toggleRef={tabsToggleRef}
/>
```

`onOutsideClose` is intentionally separate from `onSelect` so the contract is explicit: select = "user picked a tab, close me"; outside-close = "user clicked nothing in particular, close me". Today they're both `closeDrawer`; later they can diverge.

- [ ] **Step 2: Wire the ref in TopBar**

In `src/renderer/src/components/TopBar.tsx`, add to props:

```ts
interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  tabsToggleRef: React.RefObject<HTMLButtonElement | null>;
  // ...
}
```

And in the JSX, attach to the Layers IconButton. The existing `IconButton` component does not accept a `ref` — so either pass it through or attach inline. Simplest: change the Layers icon to a plain `<button>` with the same classes, OR forward the ref through `IconButton`.

Recommended: forward ref via `forwardRef`. Update `IconButton`:

```tsx
import { forwardRef } from 'react';

const IconButton = forwardRef<HTMLButtonElement, {
  children: ReactElement;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}>(function IconButton({ children, ariaLabel, testId, disabled, active, onClick }, ref): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded p-1 text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)] disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active ? 'bg-[var(--chrome-hover)] text-sky-400' : '')
      }
    >
      {children}
    </button>
  );
});
```

Then attach the ref:

```tsx
<IconButton
  ref={tabsToggleRef}
  ariaLabel="Toggle tabs"
  testId="topbar-tabs-toggle"
  active={drawerOpen}
  onClick={onToggleDrawer}
>
  <Layers size={16} />
</IconButton>
```

- [ ] **Step 3: Outside-click effect in TabDrawer**

In `src/renderer/src/components/TabDrawer.tsx`:

```tsx
import { useEffect, useRef, type RefObject } from 'react';

interface TabDrawerProps {
  open: boolean;
  onSelect: () => void;
  onOutsideClose: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

export function TabDrawer({ open, onSelect, onOutsideClose, toggleRef }: TabDrawerProps): ReactElement | null {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  // ... existing state hooks

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (drawerRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      onOutsideClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOutsideClose, toggleRef]);

  if (!open) return null;
  // ... existing render, attach ref to the root <div>:
  return (
    <div ref={drawerRef} data-testid="tab-drawer" className="...">
      {/* existing content */}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck + unit tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/components/TabDrawer.tsx
git commit -m "feat(M13): TabDrawer auto-closes on outside click"
```

---

## Task 9: SettingsDrawer outside-click

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Lift settings toggle ref + wire prop chain**

In `App.tsx`:

```ts
const settingsToggleRef = useRef<HTMLButtonElement | null>(null);
```

Pass to `TopBar` (settingsToggleRef) and `SettingsDrawer` (toggleRef). In `TopBar`, attach to the Settings IconButton:

```tsx
<IconButton
  ref={settingsToggleRef}
  ariaLabel="Open settings"
  testId="topbar-settings-toggle"
  active={settingsOpen}
  onClick={onToggleSettings}
>
  <Settings size={16} />
</IconButton>
```

Add `settingsToggleRef` to `TopBarProps`.

- [ ] **Step 2: Outside-click in SettingsDrawer**

In `src/renderer/src/components/SettingsDrawer.tsx`:

```tsx
import { useEffect, useRef, type RefObject } from 'react';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

// inside the component, before the early returns:
const drawerRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  if (!open) return;
  const onDown = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (target === null) return;
    if (drawerRef.current?.contains(target)) return;
    if (toggleRef.current?.contains(target)) return;
    onClose();
  };
  document.addEventListener('mousedown', onDown);
  return () => document.removeEventListener('mousedown', onDown);
}, [open, onClose, toggleRef]);

// attach ref to the root drawer div
return (
  <div ref={drawerRef} data-testid="settings-drawer" className="...">
    {/* existing content */}
  </div>
);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat(M13): SettingsDrawer auto-closes on outside click"
```

---

## Task 10: Settings auto-close on activeId change

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the effect**

In `App.tsx` after the existing hooks:

```ts
const activeId = useTabsStore((s) => s.activeId);
const prevActiveIdRef = useRef<string | null>(activeId);
useEffect(() => {
  // Skip the very first effect run after mount (activeId hydrating from snapshot
  // shouldn't trigger an auto-close on a freshly opened drawer that was set
  // before tabs hydrated — defensive against future timing changes).
  if (prevActiveIdRef.current === activeId) return;
  prevActiveIdRef.current = activeId;
  if (settingsOpen) closeSettings();
}, [activeId, settingsOpen, closeSettings]);
```

The ref guard avoids closing settings on first hydration when activeId transitions `null` → `<id>`. Subsequent transitions (user picks a tab, or Ctrl+Tab cycle) still close.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(M13): auto-close SettingsDrawer when active tab changes"
```

---

## Task 11: Light = white overlay (build-filter-css)

**Files:**
- Modify: `src/main/build-filter-css.ts`
- Modify: `tests/unit/build-filter-css.test.ts`

- [ ] **Step 1: Update the failing tests to assert overlay**

In `tests/unit/build-filter-css.test.ts`, replace the `light effect` test and add:

```ts
  it('light effect emits white overlay via html::after at given opacity', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 0.5,
      transitionMs: 150,
    });
    expect(result).toContain('html::after');
    expect(result).toContain('background: white');
    expect(result).toContain('opacity: 0.5');
    expect(result).toContain('position: fixed');
    expect(result).toContain('pointer-events: none');
    expect(result).toContain('z-index: 2147483647');
    expect(result).toContain('transition: opacity 150ms ease-out');
    // The old filter form is gone for light:
    expect(result).not.toContain('filter: brightness');
  });

  it('light at opacity 1 reaches full white (asserted by overlay opacity literal)', () => {
    const result = buildFilterCSS('light', {
      effect: 'light',
      blurPx: 8,
      darkBrightness: 0.3,
      lightBrightness: 1,
      transitionMs: 0,
    });
    expect(result).toContain('opacity: 1');
    // transitionMs:0 → transition segment omitted entirely
    expect(result).not.toContain('transition');
  });
```

Keep the `blur` and `dark` tests unchanged.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test tests/unit/build-filter-css.test.ts`
Expected: FAIL — light test expects overlay, current impl emits brightness.

- [ ] **Step 3: Implement the white overlay branch**

In `src/main/build-filter-css.ts`:

```ts
export function buildFilterCSS(
  effect: DimSettings['effect'],
  dim: DimSettings
): string | null {
  if (effect === 'none') return null;

  if (effect === 'light') {
    // M13: light is a white overlay (filter: brightness can't reach pure white).
    // Field name `lightBrightness` retained for back-compat; semantically it is
    // the overlay opacity in [0,1] post-clamp (clampDim updated separately).
    let css =
      'html::after { content: \'\'; position: fixed; inset: 0;' +
      ' background: white; opacity: ' + dim.lightBrightness + ';' +
      ' pointer-events: none; z-index: 2147483647;';
    if (dim.transitionMs > 0) {
      css += ' transition: opacity ' + dim.transitionMs + 'ms ease-out;';
    }
    css += ' }';
    return css;
  }

  // blur and dark continue to use html { filter: ... } — pre-existing behavior.
  let filterValue: string;
  if (effect === 'blur') {
    filterValue = `blur(${dim.blurPx}px)`;
  } else if (effect === 'dark') {
    filterValue = `brightness(${dim.darkBrightness})`;
  } else {
    return null;
  }

  let css = `html { filter: ${filterValue};`;
  if (dim.transitionMs > 0) {
    css += ` transition: filter ${dim.transitionMs}ms ease-out;`;
  }
  css += ' }';
  return css;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test tests/unit/build-filter-css.test.ts`
Expected: PASS — all variants green including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/build-filter-css.ts tests/unit/build-filter-css.test.ts
git commit -m "feat(M13): light dim → white overlay (reaches pure white at opacity 1)"
```

---

## Task 12: lightBrightness clamp + DEFAULTS + slider

**Files:**
- Modify: `src/main/clamp-settings.ts`
- Modify: `tests/unit/clamp-settings.test.ts`
- Modify: `src/shared/settings-defaults.ts`
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: Update clamp test for new range [0,1]**

In `tests/unit/clamp-settings.test.ts`, find the lightBrightness test(s). Likely there's a test asserting clamp at 1 and 3. Update:

```ts
  it('clamps lightBrightness to [0, 1]', () => {
    const current = makeCurrent();
    expect(clampSettings({ dim: { lightBrightness: -0.5 } }, current).dim?.lightBrightness).toBe(0);
    expect(clampSettings({ dim: { lightBrightness: 0.5 } }, current).dim?.lightBrightness).toBe(0.5);
    expect(clampSettings({ dim: { lightBrightness: 1.5 } }, current).dim?.lightBrightness).toBe(1);
    expect(clampSettings({ dim: { lightBrightness: 99 } }, current).dim?.lightBrightness).toBe(1);
  });
```

(Use the existing `makeCurrent()` / equivalent fixture in that test file. If it doesn't exist, instantiate `DEFAULTS` directly.)

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test tests/unit/clamp-settings.test.ts`
Expected: FAIL — current clamp uses [1, 3].

- [ ] **Step 3: Update the clamp range**

In `src/main/clamp-settings.ts`:

```ts
  if (partial.lightBrightness !== undefined) {
    out.lightBrightness = clamp(partial.lightBrightness, 0, 1);
  }
```

- [ ] **Step 4: Update DEFAULTS**

In `src/shared/settings-defaults.ts`:

```ts
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 0.5,    // was 1.5 — new opacity semantics
    transitionMs: 150,
  },
```

- [ ] **Step 5: Update SettingsDrawer light slider**

In `src/renderer/src/components/SettingsDrawer.tsx`, locate the lightBrightness slider. Change `min` / `max` / `step` and the label, and reset target.

For locating the spot, search for `lightBrightness`. Update to:

```tsx
{settings.dim.effect === 'light' && (
  <Row
    label="白度"
    rightSlot={
      <ResetIcon
        show={settings.dim.lightBrightness !== DEFAULTS.dim.lightBrightness}
        onClick={() => void update({ dim: { lightBrightness: DEFAULTS.dim.lightBrightness } })}
        testId="reset-light-brightness"
      />
    }
  >
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={settings.dim.lightBrightness}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        void update({ dim: { lightBrightness: Number(e.target.value) } })
      }
      data-testid="dim-light-brightness"
      className="..."   /* keep existing slider class */
    />
  </Row>
)}
```

If the existing markup is structured differently, preserve the existing className/wrapper and only change the row label + min/max/step.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/clamp-settings.ts tests/unit/clamp-settings.test.ts src/shared/settings-defaults.ts src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat(M13): lightBrightness clamp [0,1] + default 0.5; slider relabeled 白度"
```

---

## Task 13: chrome-dim helper + tests

**Files:**
- Create: `src/renderer/src/lib/chrome-dim.ts`
- Create: `tests/unit/chrome-dim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chrome-dim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeChromeDimStyle } from '../../src/renderer/src/lib/chrome-dim';
import type { DimSettings } from '../../src/shared/types';

const dim = (overrides: Partial<DimSettings> = {}): DimSettings => ({
  effect: 'blur',
  blurPx: 8,
  darkBrightness: 0.3,
  lightBrightness: 0.5,
  transitionMs: 150,
  ...overrides,
});

describe('computeChromeDimStyle', () => {
  it('dimmed=false returns empty style + no overlay regardless of effect', () => {
    const r = computeChromeDimStyle(false, dim({ effect: 'blur' }));
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=none returns empty style + no overlay even when dimmed', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'none' }));
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=blur sets filter: blur(Npx) with transition', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'blur', blurPx: 12, transitionMs: 200 }));
    expect(r.rootStyle.filter).toBe('blur(12px)');
    expect(r.rootStyle.transition).toBe('filter 200ms ease-out');
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=dark sets filter: brightness(N)', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'dark', darkBrightness: 0.2 }));
    expect(r.rootStyle.filter).toBe('brightness(0.2)');
    expect(r.overlayStyle).toBeNull();
  });

  it('effect=light returns overlay with opacity + null filter', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'light', lightBrightness: 0.7, transitionMs: 100 }));
    expect(r.rootStyle).toEqual({});
    expect(r.overlayStyle).not.toBeNull();
    expect(r.overlayStyle?.opacity).toBe(0.7);
    expect(r.overlayStyle?.background).toBe('white');
    expect(r.overlayStyle?.position).toBe('fixed');
    expect(r.overlayStyle?.pointerEvents).toBe('none');
    expect(r.overlayStyle?.transition).toBe('opacity 100ms ease-out');
  });

  it('transitionMs=0 omits transition string', () => {
    const r = computeChromeDimStyle(true, dim({ effect: 'blur', transitionMs: 0 }));
    expect(r.rootStyle.filter).toBe('blur(8px)');
    expect('transition' in r.rootStyle).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test tests/unit/chrome-dim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeChromeDimStyle`**

Create `src/renderer/src/lib/chrome-dim.ts`:

```ts
/**
 * chrome-dim.ts — Pure helper deriving renderer-side style for chrome dim
 * (M13). The chrome (TopBar / TabDrawer / SettingsDrawer / NewTab) lives in
 * the host BrowserWindow's webContents — not the active tab's WebContents —
 * so it cannot be reached by the existing DimController which runs against
 * the per-tab webContents. Instead, App.tsx subscribes to the existing
 * windowState.dimmed signal and runs this helper to get an inline style for
 * the chrome root + (for the light effect) an absolutely-positioned white
 * overlay style.
 *
 * Z-order: WebContentsView is rendered ABOVE the renderer DOM in the page
 * area, so this overlay is only visibly active over actual chrome regions
 * (top bar, drawers when open). The page area is dimmed via the existing
 * page-side `dim.apply(activeWc, dim)` path. Two layers, no overlap.
 *
 * Pure: no React imports, no DOM access, no side effects. Returned objects
 * are CSSProperties-shaped plain records — App.tsx uses them inline.
 */

import type { CSSProperties } from 'react';
import type { DimSettings } from '../../../shared/types';

export interface ChromeDimResult {
  /** Inline style to spread on the chrome root container. */
  rootStyle: CSSProperties;
  /** When non-null, render a fixed-position div with this style as a sibling/child of root. */
  overlayStyle: CSSProperties | null;
}

export function computeChromeDimStyle(
  dimmed: boolean,
  dim: DimSettings,
): ChromeDimResult {
  if (!dimmed || dim.effect === 'none') {
    return { rootStyle: {}, overlayStyle: null };
  }

  if (dim.effect === 'light') {
    const overlay: CSSProperties = {
      position: 'fixed',
      inset: 0,
      background: 'white',
      opacity: dim.lightBrightness,
      pointerEvents: 'none',
      zIndex: 2147483647,
    };
    if (dim.transitionMs > 0) {
      overlay.transition = `opacity ${dim.transitionMs}ms ease-out`;
    }
    return { rootStyle: {}, overlayStyle: overlay };
  }

  const filter =
    dim.effect === 'blur'
      ? `blur(${dim.blurPx}px)`
      : `brightness(${dim.darkBrightness})`;
  const root: CSSProperties = { filter };
  if (dim.transitionMs > 0) {
    root.transition = `filter ${dim.transitionMs}ms ease-out`;
  }
  return { rootStyle: root, overlayStyle: null };
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `pnpm test tests/unit/chrome-dim.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/chrome-dim.ts tests/unit/chrome-dim.test.ts
git commit -m "feat(M13): pure chrome-dim style helper + tests"
```

---

## Task 14: App.tsx — chrome dim wiring

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Wire computeChromeDimStyle to root + overlay**

```tsx
import { useWindowStateStore } from './store/window-state-store';
import { computeChromeDimStyle } from './lib/chrome-dim';
// ...

const dimmed = useWindowStateStore((s) => s.dimmed);
const dimSettings = settings?.dim;

// When settings are pre-hydration null, treat as no-dim. Settings always
// hydrate within a frame; this avoids a flash of "uncontrolled" filter.
const { rootStyle, overlayStyle } = dimSettings
  ? computeChromeDimStyle(dimmed, dimSettings)
  : { rootStyle: {}, overlayStyle: null };

return (
  <div className="flex h-full w-full flex-col" style={rootStyle}>
    {/* existing children unchanged */}
    {overlayStyle && <div data-testid="chrome-dim-overlay" style={overlayStyle} />}
  </div>
);
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(M13): chrome dim — root style + overlay react to windowState.dimmed"
```

---

## Task 15: Window title clear on dim

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Wrap applyDim/clearDim deps to also setTitle**

Find the existing `EdgeDock` construction in `index.ts`. Modify the `applyDim` and `clearDim` deps:

```ts
const APP_TITLE = 'sidebrowser';

const edgeDock = new EdgeDock({
  setWindowX: (x) => { const b = win.getBounds(); win.setBounds({ ...b, x: Math.round(x) }); },
  getWindowBounds: () => win.getBounds(),
  applyDim: () => {
    const wc = viewManager.getActiveWebContents();
    if (wc) void dim.apply(wc, settingsStore.get().dim);
    if (!win.isDestroyed()) win.setTitle('');
  },
  clearDim: () => {
    void dim.clear();
    if (!win.isDestroyed()) win.setTitle(APP_TITLE);
  },
  // ... rest unchanged
});
```

The existing `applyDim` only had the `dim.apply(wc, ...)` call (compare with the current source). Append the `setTitle` calls — don't replace the dim handling.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(M13): clear OS window title text while dim is active"
```

---

## Task 16: E2E — context menu

**Files:**
- Create: `tests/e2e/context-menu.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/context-menu.spec.ts`. Note Electron's native popup menu cannot be queried via Playwright's DOM selectors (it's an OS-rendered menu). So the E2E targets the wiring: trigger `context-menu` event with a stub `params`, then assert the deps callbacks were invoked.

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  getChromeWindow,
  navigateActive,
  waitForAddressBarReady,
} from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/page') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body><a id="lnk" href="https://target.example/x">target</a><p id="t">hello world example</p></body></html>');
        return;
      }
      if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
      res.statusCode = 404; res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test.describe('context menu (M13)', () => {
  let app: ElectronApplication;
  let userDataDir: string;
  let server: Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
  });
  test.afterAll(async () => { server.close(); });

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'sb-ctx-'));
    app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
  });
  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('right-click on a link emits a menu including the link items (template assert via test hook)', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/page`);

    // Wait for the page to be loaded inside its WebContents.
    await app.evaluate(async ({ url }) => {
      const h = (globalThis as { __sidebrowserTestHooks?: { getWebContentsByUrlSubstring: (s: string) => Electron.WebContents | null } }).__sidebrowserTestHooks!;
      // Poll until the right wc shows up.
      for (let i = 0; i < 50; i++) {
        if (h.getWebContentsByUrlSubstring(url)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    }, { url: '/page' });

    // Capture the menu template that would be built for a link right-click.
    // We rely on a new hook `simulateContextMenu(wc, params) → labels[]`
    // (added to the SIDEBROWSER_E2E hook block in index.ts in this same task).
    const labels = await app.evaluate(async ({ url }) => {
      const h = (globalThis as { __sidebrowserTestHooks?: {
        getWebContentsByUrlSubstring: (s: string) => Electron.WebContents | null;
        simulateContextMenu: (wc: Electron.WebContents, params: { linkURL?: string; selectionText?: string }) => string[];
      } }).__sidebrowserTestHooks!;
      const wc = h.getWebContentsByUrlSubstring(url);
      if (!wc) throw new Error('tab wc not found');
      return h.simulateContextMenu(wc, { linkURL: 'https://target.example/x' });
    }, { url: '/page' });

    expect(labels.slice(0, 4)).toEqual([
      '在新标签页打开链接',
      '在系统浏览器打开链接',
      '复制链接地址',
      '---',
    ]);
    expect(labels).toContain('后退');
    expect(labels).toContain('在系统浏览器打开此页');
    expect(labels).toContain('查看源代码');
  });

  test('text selection right-click prepends 复制 + 用 Google 搜索', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);
    await navigateActive(chrome, `${baseUrl}/page`);

    const labels = await app.evaluate(async ({ url }) => {
      const h = (globalThis as { __sidebrowserTestHooks?: {
        getWebContentsByUrlSubstring: (s: string) => Electron.WebContents | null;
        simulateContextMenu: (wc: Electron.WebContents, params: { linkURL?: string; selectionText?: string }) => string[];
      } }).__sidebrowserTestHooks!;
      // Wait briefly for tab wc to be navigated.
      let wc: Electron.WebContents | null = null;
      for (let i = 0; i < 50; i++) {
        wc = h.getWebContentsByUrlSubstring(url);
        if (wc) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!wc) throw new Error('tab wc not found');
      return h.simulateContextMenu(wc, { selectionText: 'hello world example' });
    }, { url: '/page' });

    expect(labels[0]).toBe('复制');
    expect(labels[1]).toBe('用 Google 搜索 "hello world example"');
    expect(labels[2]).toBe('---');
  });
});
```

- [ ] **Step 2: Add the `simulateContextMenu` test hook**

In `src/main/index.ts`, inside the `if (process.env['SIDEBROWSER_E2E'] === '1')` block, add:

```ts
        // M13 context-menu hook. Build the template the same way ViewManager
        // would for a real context-menu event but return only the labels (so
        // the spec can assert order without dealing with click closures).
        // This mirrors view-manager's per-event deps refresh.
        simulateContextMenu: (wc: Electron.WebContents, params: { linkURL?: string; selectionText?: string }): string[] => {
          // Lazy import to avoid pulling context-menu module into prod bundle
          // unrelated paths (it's tree-shaken anyway, but keeps intent local).
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { buildContextMenuTemplate } = require('./context-menu') as typeof import('./context-menu');
          // We need the same deps shape as production. Build a minimal one
          // (clicks won't be invoked here — we only read labels).
          const tab = (() => {
            // Reverse-lookup tab via wc id → url
            // (ViewManager has the data; we use its public getMobileEmulationState
            // path indirectly by URL? Simpler: pass canGoBack/Forward true).
            return { url: wc.getURL() };
          })();
          const tpl = buildContextMenuTemplate(
            { linkURL: params.linkURL ?? '', selectionText: params.selectionText ?? '' } as Electron.ContextMenuParams,
            {
              openInSystemBrowser: () => {},
              openInNewTab: () => {},
              copyToClipboard: () => {},
              searchSelection: () => {},
              viewSource: () => {},
              navigateActive: () => {},
              canGoBack: true,
              canGoForward: true,
              activeSearchEngineName: 'Google',
            },
            tab.url,
          );
          return tpl.map((i) => i.label ?? (i.type === 'separator' ? '---' : ''));
        },
```

`require('./context-menu')` works inside the bundled main since the file is part of the main bundle.

- [ ] **Step 3: Build + run the spec**

Build is required since E2E launches `out/main/index.cjs`. The user owns the build; ask them or run `pnpm build` here if you have a clean shell. Note their saved memory: `ELECTRON_RUN_AS_NODE` is set globally in their Git Bash; if running `pnpm build` from this agent fails with that issue, prefer the PowerShell tool which has its own env.

Run: `pnpm build && pnpm test:e2e tests/e2e/context-menu.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/context-menu.spec.ts src/main/index.ts
git commit -m "test(M13): e2e — context menu template per param tier"
```

---

## Task 17: E2E — tab UX (cycle + outside-click + settings auto-close)

**Files:**
- Create: `tests/e2e/tab-ux.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/tab-ux.spec.ts`:

```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getChromeWindow, waitForAddressBarReady } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

test.describe('tab UX (M13)', () => {
  let app: ElectronApplication;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'sb-tabux-'));
    app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, SIDEBROWSER_E2E: '1' },
    });
  });
  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('Ctrl+Tab cycles to next tab and shows drawer; release closes drawer', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    // Seed a second tab via API so we have two tabs to cycle between.
    await chrome.evaluate(() => window.sidebrowser.createTab('about:blank'));
    await expect.poll(async () => (await chrome.locator('[data-testid="tab-drawer-item"]').count())).toBe(2);

    // Press Ctrl+Tab on the chrome window. Hold ctrl down, press tab, then release.
    await chrome.keyboard.down('Control');
    await chrome.keyboard.press('Tab');
    // Drawer becomes visible while Ctrl is held.
    await expect(chrome.getByTestId('tab-drawer')).toBeVisible();

    await chrome.keyboard.up('Control');
    // After Ctrl release, drawer should hide.
    await expect(chrome.getByTestId('tab-drawer')).toBeHidden();
  });

  test('outside-click closes the TabDrawer', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    await chrome.getByTestId('topbar-tabs-toggle').click();
    await expect(chrome.getByTestId('tab-drawer')).toBeVisible();

    // Click on the address bar — outside the drawer + outside the toggle.
    await chrome.getByTestId('address-bar').click();
    await expect(chrome.getByTestId('tab-drawer')).toBeHidden();
  });

  test('opening a tab from the drawer while settings is open auto-closes settings', async () => {
    const chrome = await getChromeWindow(app);
    await waitForAddressBarReady(chrome);

    await chrome.evaluate(() => window.sidebrowser.createTab('about:blank'));
    await expect.poll(async () => (await chrome.locator('[data-testid="tab-drawer-item"]').count())).toBe(2);

    // Open settings.
    await chrome.getByTestId('topbar-settings-toggle').click();
    await expect(chrome.getByTestId('settings-drawer')).toBeVisible();

    // Open tab drawer + click the OTHER tab (the inactive one).
    await chrome.getByTestId('topbar-tabs-toggle').click();
    const inactive = chrome.locator('[data-testid="tab-drawer-item"][data-active="false"]').first();
    await inactive.click();

    // Settings should now be closed (active tab changed).
    await expect(chrome.getByTestId('settings-drawer')).toBeHidden();
  });
});
```

- [ ] **Step 2: Build + run the spec**

Run: `pnpm build && pnpm test:e2e tests/e2e/tab-ux.spec.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/tab-ux.spec.ts
git commit -m "test(M13): e2e — Ctrl+Tab cycle, outside-click, settings auto-close"
```

---

## Task 18: E2E — chrome dim + window title

**Files:**
- Modify: `tests/e2e/mouse-leave-dim.spec.ts`

- [ ] **Step 1: Add a chrome-dim + title spec at the bottom of the file**

Append to `tests/e2e/mouse-leave-dim.spec.ts` (inside the existing top-level `test.describe`, or as a new describe block — match the file's pattern):

```ts
test('chrome dim — root acquires filter style and window title clears', async () => {
  // Use the same setup as the existing spec — see beforeEach in this file.
  const chrome = await getChromeWindow(app);
  await waitForAddressBarReady(chrome);
  await navigateActive(chrome, `${baseUrl}/plain`);

  // Settings: keep effect=blur (default). Trigger leave to activate dim.
  await app.evaluate(async () => {
    const h = (globalThis as { __sidebrowserTestHooks?: { fireLeaveNow: () => void } }).__sidebrowserTestHooks!;
    h.fireLeaveNow();
  });

  // Poll: chrome root style filter contains blur(...).
  await expect.poll(async () => {
    return chrome.evaluate(() => {
      const root = document.querySelector('div.flex.h-full.w-full.flex-col') as HTMLDivElement | null;
      return root?.style.filter ?? '';
    });
  }, { timeout: 5_000 }).toMatch(/blur\(\d+px\)/);

  // Window title is empty while dimmed.
  await expect.poll(async () => {
    return app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BrowserWindow } = require('electron') as typeof import('electron');
      return BrowserWindow.getAllWindows()[0]?.getTitle() ?? null;
    });
  }, { timeout: 5_000 }).toBe('');

  // Re-enter clears dim.
  await app.evaluate(async () => {
    const h = (globalThis as { __sidebrowserTestHooks?: { fireEnterNow: () => void } }).__sidebrowserTestHooks!;
    h.fireEnterNow();
  });
  await expect.poll(async () => {
    return chrome.evaluate(() => {
      const root = document.querySelector('div.flex.h-full.w-full.flex-col') as HTMLDivElement | null;
      return root?.style.filter ?? '';
    });
  }, { timeout: 5_000 }).toBe('');
  await expect.poll(async () => {
    return app.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BrowserWindow } = require('electron') as typeof import('electron');
      return BrowserWindow.getAllWindows()[0]?.getTitle() ?? null;
    });
  }, { timeout: 5_000 }).toBe('sidebrowser');
});

test('light effect — chrome overlay div appears with white background', async () => {
  const chrome = await getChromeWindow(app);
  await waitForAddressBarReady(chrome);
  await navigateActive(chrome, `${baseUrl}/plain`);

  // Switch dim.effect to 'light' via test hook.
  await app.evaluate(async () => {
    const h = (globalThis as { __sidebrowserTestHooks?: { updateSettings: (p: unknown) => unknown } }).__sidebrowserTestHooks!;
    h.updateSettings({ dim: { effect: 'light', lightBrightness: 1 } });
  });

  await app.evaluate(async () => {
    const h = (globalThis as { __sidebrowserTestHooks?: { fireLeaveNow: () => void } }).__sidebrowserTestHooks!;
    h.fireLeaveNow();
  });

  // Overlay div present with rgb(255,255,255) background.
  await expect.poll(async () => {
    return chrome.evaluate(() => {
      const ov = document.querySelector('[data-testid="chrome-dim-overlay"]') as HTMLDivElement | null;
      if (!ov) return 'missing';
      const cs = getComputedStyle(ov);
      return `${cs.backgroundColor}|${cs.opacity}`;
    });
  }, { timeout: 5_000 }).toBe('rgb(255, 255, 255)|1');
});
```

The selectors here assume the App.tsx root has classes `flex h-full w-full flex-col`. If you changed the className earlier, update the spec to match. A more robust selector would be a `data-testid="chrome-root"` on the root div — feel free to add one in App.tsx and switch the spec to `chrome.locator('[data-testid="chrome-root"]')`.

- [ ] **Step 2: Add data-testid on chrome root for stable selection**

In `src/renderer/src/App.tsx`, add `data-testid="chrome-root"` to the outer `<div>`:

```tsx
<div data-testid="chrome-root" className="flex h-full w-full flex-col" style={rootStyle}>
```

Then in the spec, replace the brittle selector:

```ts
const root = document.querySelector('[data-testid="chrome-root"]') as HTMLDivElement | null;
```

- [ ] **Step 3: Build + run the spec**

Run: `pnpm build && pnpm test:e2e tests/e2e/mouse-leave-dim.spec.ts`
Expected: PASS — existing tests still pass + 2 new tests green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mouse-leave-dim.spec.ts src/renderer/src/App.tsx
git commit -m "test(M13): e2e — chrome dim style + title clear + light overlay"
```

---

## Task 19: Final verification — full suite

**Files:** none modified.

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: PASS (no errors). Warnings are acceptable; document them in the smoke handoff.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Unit tests (all)**

Run: `pnpm test`
Expected: PASS — every existing + new test green.

- [ ] **Step 4: E2E suite (all)**

Run: `pnpm build && pnpm test:e2e`
Expected: PASS — every existing + new E2E spec green.

If a pre-existing E2E spec regresses, investigate the root cause; do not skip or relax assertions without first checking whether an M13 change broke an unrelated assumption.

- [ ] **Step 5: Stop here for the user smoke test**

Per user memory ("user owns manual smoke"), do NOT tag a release or update the version field. Hand off to the user with this status report:

```
M13 implementation complete. All unit + E2E green.

Smoke checklist (user-driven):
1. Right-click on a page (no link, no selection) → menu shows page actions + "在系统浏览器打开此页" + "查看源代码".
2. Right-click on a link → menu prepends "在新标签页打开链接" / "在系统浏览器打开链接" / "复制链接地址".
3. Select text and right-click → menu prepends "复制" + "用 Google 搜索 ...".
4. Hold Ctrl + press Tab → drawer pops open + active tab advances. Press Tab again → advances again. Release Ctrl → drawer auto-closes.
5. Open the tab drawer → click on the address bar (or anywhere outside the drawer) → drawer closes.
6. Open Settings → click on a different tab in the tab drawer → settings auto-close.
7. In Settings, set dim effect = light, opacity = 1.0 → leave the window with the mouse → the entire window (page + chrome) becomes pure white. Title bar text is empty (Alt+Tab, taskbar hover both show no string). Re-enter window → restored.
8. Set dim effect = blur → leave window → the chrome (top bar / drawers if open) blurs alongside the page.

Any regressions or surprises? Roll back individual commits as needed; the plan is per-feature.
```

---

## Self-Review

**Spec coverage:**
- §3 Web context menu → Tasks 1, 2, 16. ✅
- §4.1 Auto-collapse → Tasks 7, 8, 9. ✅
- §4.2 Ctrl+Tab cycling → Tasks 3, 4, 5, 6, 7. ✅
- §4.3 Settings auto-close → Task 10. ✅
- §5 Light = white overlay → Tasks 11, 12. ✅
- §6.1 Chrome dim → Tasks 13, 14. ✅
- §6.2 Window title → Task 15. ✅
- §3.4, §4.4, §6.3 tests → Tasks 1, 4, 11, 13 (unit) + Tasks 16, 17, 18 (E2E). ✅

**Placeholder scan:** None found. Every step shows the code or command.

**Type consistency:**
- `ContextMenuDeps` shape used in Task 1, referenced in Tasks 2 and 16. Identical signature. ✅
- `TabCyclerDeps` defined in Task 4, used in Task 6. Identical. ✅
- `cycle:state` channel name and payload shape consistent across Tasks 5 and 6 (`{ active: boolean }`). ✅
- `lightBrightness` field name preserved (deliberately) in Tasks 11, 12, 13. ✅
- `nextRelativeIndex` signature: `(order, activeId, delta)` — used identically in Task 3 test + impl. ✅
- `data-testid="chrome-root"` introduced in Task 18 — not referenced earlier (no inconsistency). ✅
- `data-testid="chrome-dim-overlay"` introduced in Task 14 + asserted in Task 18. Identical name. ✅

**Plan complete.** Ready to execute.
