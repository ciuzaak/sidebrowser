import { RotateCcw, X, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import type { Settings, ThemeChoice, SearchEngine } from '@shared/types';
import { DEFAULTS, BUILTIN_SEARCH_ENGINES } from '@shared/settings-defaults';
import { nanoid } from 'nanoid';
import { useSettingsStore } from '../store/settings-store';

/**
 * Right-side overlay drawer exposing all 6 Settings sections (spec §7).
 *
 * **View-suppression coordination.** React DOM cannot cover the native
 * `WebContentsView` that hosts the active tab. The drawer relies on App.tsx
 * firing `view:set-suppressed` IPC on `open` state transitions — main then
 * shrinks the active view to `{0,0,0,0}`, leaving the browser surface empty
 * so this absolutely-positioned panel renders unobstructed. Closing the
 * drawer restores the view bounds via the inverse IPC. See spec §4.2 for the
 * "covered-over-web-content" contract and plan §Task 10 for the v1 implementation note.
 *
 * **Null gate.** `useSettingsStore` exposes `settings: Settings | null`; until
 * the first main-side payload (via `app:ready` / `settings:get`), the store
 * is uninitialised. Rendering the control tree with `settings === null` would
 * either crash on `settings.dim.blurPx` deref or inject NaN slider values,
 * so we short-circuit and return `null`. The bridge hook guarantees a
 * hydration broadcast arrives within a frame; the drawer re-renders as soon
 * as settings land — no spinner needed.
 *
 * Updates are **non-optimistic**: `update(patch)` invokes main, which clamps,
 * persists, and broadcasts the authoritative `Settings` back. Every slider
 * value prop is bound directly to `settings.X.Y` so the UI always reflects
 * what `electron-store` actually holds — not a transient local draft.
 * Dragging a slider issues many IPC updates and main echoes each back;
 * single-digit-ms latency makes this invisible.
 */
interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

type DimEffect = Settings['dim']['effect'];
type WindowPreset = Settings['window']['preset'];

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps): ReactElement | null {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  // Null-gate (pre-hydration) AND closed-gate (don't paint anything when hidden).
  if (!open) return null;
  if (settings === null) return null;

  return (
    <div
      data-testid="settings-drawer"
      className="absolute inset-0 z-10 flex flex-col overflow-y-auto border-l border-[var(--chrome-border)] bg-[var(--chrome-drawer-bg)] text-[var(--chrome-fg)]"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--chrome-border)] bg-[var(--chrome-drawer-bg)] px-3 py-2">
        <h2 className="text-sm font-semibold">Settings</h2>
        <button
          type="button"
          aria-label="Close settings"
          data-testid="settings-close"
          onClick={onClose}
          className="rounded p-1 text-[var(--chrome-fg)] opacity-80 hover:bg-[var(--chrome-hover)] hover:opacity-100"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex flex-col gap-5 p-3">
        {/* ── 0. Appearance ───────────────────────────────────── */}
        <Section title="Appearance">
          <Row
            label="Theme"
            rightSlot={
              <ResetIcon
                show={settings.appearance.theme !== DEFAULTS.appearance.theme}
                onClick={() => void update({ appearance: { theme: DEFAULTS.appearance.theme } })}
                testId="reset-theme"
              />
            }
          >
            <select
              data-testid="settings-theme"
              value={settings.appearance.theme}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                void update({ appearance: { theme: e.target.value as ThemeChoice } })
              }
              className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Row>
        </Section>

        {/* ── 1. Window ───────────────────────────────────────── */}
        <Section title="Window">
          <Row
            label="Preset"
            rightSlot={
              <ResetIcon
                show={settings.window.preset !== DEFAULTS.window.preset}
                onClick={() => void update({ window: { preset: DEFAULTS.window.preset } })}
                testId="reset-window-preset"
              />
            }
          >
            <select
              data-testid="settings-window-preset"
              value={settings.window.preset}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                void update({ window: { preset: e.target.value as WindowPreset } })
              }
              className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="iphone14pro">iPhone 14 Pro (393x852)</option>
              <option value="iphonese">iPhone SE (375x667)</option>
              <option value="pixel7">Pixel 7 (412x915)</option>
            </select>
          </Row>
          <Slider
            label="Edge threshold"
            unit="px"
            testId="settings-window-edge-threshold"
            value={settings.window.edgeThresholdPx}
            min={0}
            max={50}
            step={1}
            onChange={(n) => void update({ window: { edgeThresholdPx: n } })}
            rightSlot={
              <ResetIcon
                show={settings.window.edgeThresholdPx !== DEFAULTS.window.edgeThresholdPx}
                onClick={() => void update({ window: { edgeThresholdPx: DEFAULTS.window.edgeThresholdPx } })}
                testId="reset-window-edge-threshold"
              />
            }
          />
        </Section>

        {/* ── 2. Mouse leave ──────────────────────────────────── */}
        <Section title="Mouse leave">
          <Slider
            label="Delay"
            unit="ms"
            testId="settings-mouseleave-delay"
            value={settings.mouseLeave.delayMs}
            min={0}
            max={2000}
            step={50}
            onChange={(n) => void update({ mouseLeave: { delayMs: n } })}
            rightSlot={
              <ResetIcon
                show={settings.mouseLeave.delayMs !== DEFAULTS.mouseLeave.delayMs}
                onClick={() => void update({ mouseLeave: { delayMs: DEFAULTS.mouseLeave.delayMs } })}
                testId="reset-mouseleave-delay"
              />
            }
          />
        </Section>

        {/* ── 3. Dim ──────────────────────────────────────────── */}
        <Section title="Dim">
          <Row
            label="Effect"
            rightSlot={
              <ResetIcon
                show={settings.dim.effect !== DEFAULTS.dim.effect}
                onClick={() => void update({ dim: { effect: DEFAULTS.dim.effect } })}
                testId="reset-dim-effect"
              />
            }
          >
            <select
              data-testid="settings-dim-effect"
              value={settings.dim.effect}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                void update({ dim: { effect: e.target.value as DimEffect } })
              }
              className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="blur">Blur</option>
              <option value="none">None</option>
            </select>
          </Row>
          <Slider
            label="Blur"
            unit="px"
            testId="settings-dim-blur"
            value={settings.dim.blurPx}
            min={0}
            max={40}
            step={1}
            dimmed={settings.dim.effect !== 'blur'}
            onChange={(n) => void update({ dim: { blurPx: n } })}
            rightSlot={
              <ResetIcon
                show={settings.dim.blurPx !== DEFAULTS.dim.blurPx}
                onClick={() => void update({ dim: { blurPx: DEFAULTS.dim.blurPx } })}
                testId="reset-dim-blur"
              />
            }
          />
          <Slider
            label="Dark brightness"
            testId="settings-dim-dark-brightness"
            value={settings.dim.darkBrightness}
            min={0}
            max={1}
            step={0.05}
            dimmed={settings.dim.effect !== 'dark'}
            onChange={(n) => void update({ dim: { darkBrightness: n } })}
            rightSlot={
              <ResetIcon
                show={settings.dim.darkBrightness !== DEFAULTS.dim.darkBrightness}
                onClick={() => void update({ dim: { darkBrightness: DEFAULTS.dim.darkBrightness } })}
                testId="reset-dim-dark-brightness"
              />
            }
          />
          <Slider
            label="Light brightness"
            testId="settings-dim-light-brightness"
            value={settings.dim.lightBrightness}
            min={1}
            max={3}
            step={0.1}
            dimmed={settings.dim.effect !== 'light'}
            onChange={(n) => void update({ dim: { lightBrightness: n } })}
            rightSlot={
              <ResetIcon
                show={settings.dim.lightBrightness !== DEFAULTS.dim.lightBrightness}
                onClick={() => void update({ dim: { lightBrightness: DEFAULTS.dim.lightBrightness } })}
                testId="reset-dim-light-brightness"
              />
            }
          />
          <Slider
            label="Transition"
            unit="ms"
            testId="settings-dim-transition"
            value={settings.dim.transitionMs}
            min={0}
            max={1000}
            step={50}
            onChange={(n) => void update({ dim: { transitionMs: n } })}
            rightSlot={
              <ResetIcon
                show={settings.dim.transitionMs !== DEFAULTS.dim.transitionMs}
                onClick={() => void update({ dim: { transitionMs: DEFAULTS.dim.transitionMs } })}
                testId="reset-dim-transition"
              />
            }
          />
        </Section>

        {/* ── 4. Edge dock ────────────────────────────────────── */}
        <Section title="Edge dock">
          <Row
            label="Enabled"
            rightSlot={
              <ResetIcon
                show={settings.edgeDock.enabled !== DEFAULTS.edgeDock.enabled}
                onClick={() => void update({ edgeDock: { enabled: DEFAULTS.edgeDock.enabled } })}
                testId="reset-edgedock-enabled"
              />
            }
          >
            <input
              type="checkbox"
              data-testid="settings-edgedock-enabled"
              checked={settings.edgeDock.enabled}
              onChange={(e) => void update({ edgeDock: { enabled: e.target.checked } })}
              className="accent-sky-500"
            />
          </Row>
          <Slider
            label="Animation"
            unit="ms"
            testId="settings-edgedock-animation"
            value={settings.edgeDock.animationMs}
            min={0}
            max={1000}
            step={50}
            onChange={(n) => void update({ edgeDock: { animationMs: n } })}
            rightSlot={
              <ResetIcon
                show={settings.edgeDock.animationMs !== DEFAULTS.edgeDock.animationMs}
                onClick={() => void update({ edgeDock: { animationMs: DEFAULTS.edgeDock.animationMs } })}
                testId="reset-edgedock-animation"
              />
            }
          />
          <Slider
            label="Trigger strip"
            unit="px"
            testId="settings-edgedock-trigger-strip"
            value={settings.edgeDock.triggerStripPx}
            min={1}
            max={10}
            step={1}
            onChange={(n) => void update({ edgeDock: { triggerStripPx: n } })}
            rightSlot={
              <ResetIcon
                show={settings.edgeDock.triggerStripPx !== DEFAULTS.edgeDock.triggerStripPx}
                onClick={() => void update({ edgeDock: { triggerStripPx: DEFAULTS.edgeDock.triggerStripPx } })}
                testId="reset-edgedock-trigger-strip"
              />
            }
          />
        </Section>

        {/* ── 5. Session ──────────────────────────────────────── */}
        <Section title="Session">
          <Row
            label="Restore tabs on launch"
            rightSlot={
              <ResetIcon
                show={settings.lifecycle.restoreTabsOnLaunch !== DEFAULTS.lifecycle.restoreTabsOnLaunch}
                onClick={() =>
                  void update({ lifecycle: { restoreTabsOnLaunch: DEFAULTS.lifecycle.restoreTabsOnLaunch } })
                }
                testId="reset-lifecycle-restore-tabs"
              />
            }
          >
            <input
              type="checkbox"
              data-testid="settings-lifecycle-restore-tabs"
              checked={settings.lifecycle.restoreTabsOnLaunch}
              onChange={(e) =>
                void update({ lifecycle: { restoreTabsOnLaunch: e.target.checked } })
              }
              className="accent-sky-500"
            />
          </Row>
        </Section>

        {/* ── 6. Browsing ─────────────────────────────────────── */}
        <Section title="Browsing">
          <Row
            label="Default new tab = mobile"
            rightSlot={
              <ResetIcon
                show={settings.browsing.defaultIsMobile !== DEFAULTS.browsing.defaultIsMobile}
                onClick={() =>
                  void update({ browsing: { defaultIsMobile: DEFAULTS.browsing.defaultIsMobile } })
                }
                testId="reset-browsing-default-mobile"
              />
            }
          >
            <input
              type="checkbox"
              data-testid="settings-browsing-default-mobile"
              checked={settings.browsing.defaultIsMobile}
              onChange={(e) =>
                void update({ browsing: { defaultIsMobile: e.target.checked } })
              }
              className="accent-sky-500"
            />
          </Row>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Mobile user agent</label>
              <ResetIcon
                show={settings.browsing.mobileUserAgent !== DEFAULTS.browsing.mobileUserAgent}
                onClick={() =>
                  void update({ browsing: { mobileUserAgent: DEFAULTS.browsing.mobileUserAgent } })
                }
                testId="reset-browsing-mobile-ua"
              />
            </div>
            <input
              type="text"
              data-testid="settings-browsing-mobile-ua"
              value={settings.browsing.mobileUserAgent}
              onChange={(e) =>
                void update({ browsing: { mobileUserAgent: e.target.value } })
              }
              spellCheck={false}
              className="w-full rounded bg-[var(--chrome-input-bg)] px-2 py-1 font-mono text-xs text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </Section>

        {/* ── 7. Search ────────────────────────────────────────── */}
        <Section
          title="Search"
          rightHeader={
            <ResetIcon
              show={
                settings.search.engines.length > BUILTIN_SEARCH_ENGINES.length ||
                settings.search.activeId !== 'google'
              }
              onClick={() =>
                void update({
                  search: {
                    engines: BUILTIN_SEARCH_ENGINES.map((e) => ({ ...e })),
                    activeId: 'google',
                  },
                })
              }
              testId="reset-search"
            />
          }
        >
          <Row label="Active engine">
            <select
              data-testid="settings-search-active"
              value={settings.search.activeId}
              onChange={(e) =>
                void update({ search: { activeId: e.target.value } })
              }
              className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            >
              {settings.search.engines.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.name}
                </option>
              ))}
            </select>
          </Row>

          <SearchEngineEditor
            engines={settings.search.engines}
            onAdd={(eng) =>
              void update({
                search: { engines: [...settings.search.engines, eng] },
              })
            }
            onDelete={(id) =>
              void update({
                search: {
                  engines: settings.search.engines.filter((e) => e.id !== id),
                },
              })
            }
          />
        </Section>
      </div>
    </div>
  );
}

// ── internal helpers ──────────────────────────────────────────────────

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
    <section className="flex flex-col gap-2">
      <div className="mb-1 flex items-center justify-between border-b border-[var(--chrome-border)] pb-1">
        <h3 className="text-sm font-semibold text-[var(--chrome-fg)]">{title}</h3>
        {rightHeader}
      </div>
      {children}
    </section>
  );
}

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
      <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">{label}</label>
      <div className="flex items-center gap-2">
        {children}
        {rightSlot}
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  testId: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Render the slider at reduced opacity (e.g. inactive dim effect controls). Still interactive. */
  dimmed?: boolean;
  onChange: (n: number) => void;
  rightSlot?: ReactNode;
}

function Slider({
  label,
  testId,
  value,
  min,
  max,
  step,
  unit,
  dimmed,
  onChange,
  rightSlot,
}: SliderProps): ReactElement {
  const display = step < 1 ? value.toFixed(2) : String(value);
  return (
    <div className={`flex flex-col gap-1 ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">{label}</label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--chrome-muted)]">
            {display}
            {unit ?? ''}
          </span>
          {rightSlot}
        </div>
      </div>
      <input
        type="range"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full appearance-none rounded bg-[var(--chrome-input-bg)] accent-sky-500"
      />
    </div>
  );
}

function ResetIcon({
  show,
  onClick,
  testId,
}: {
  show: boolean;
  onClick: () => void;
  testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Reset to default"
      aria-label="Reset to default"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      data-testid={testId}
      className={`shrink-0 rounded p-1 text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)] ${show ? '' : 'invisible'}`}
    >
      <RotateCcw size={14} />
    </button>
  );
}

interface SearchEngineEditorProps {
  engines: SearchEngine[];
  onAdd: (engine: SearchEngine) => void;
  onDelete: (id: string) => void;
}

function SearchEngineEditor({ engines, onAdd, onDelete }: SearchEngineEditorProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');

  const valid = name.trim() !== '' && urlTemplate.includes('{query}');

  const submit = (): void => {
    if (!valid) return;
    onAdd({ id: nanoid(), name: name.trim(), urlTemplate, builtin: false });
    setName('');
    setUrlTemplate('');
    setExpanded(false);
  };

  const cancel = (): void => {
    setName('');
    setUrlTemplate('');
    setExpanded(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Engines</label>
      <ul data-testid="settings-search-engines" className="flex flex-col gap-1">
        {engines.map((eng) => (
          <li
            key={eng.id}
            className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-[var(--chrome-hover)]"
          >
            <span className="text-[var(--chrome-fg)]">{eng.name}</span>
            {eng.builtin ? (
              <span className="text-xs text-[var(--chrome-muted)]">built-in</span>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${eng.name}`}
                data-testid={`settings-search-delete-${eng.id}`}
                onClick={() => onDelete(eng.id)}
                className="rounded p-1 text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)]"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!expanded ? (
        <button
          type="button"
          data-testid="settings-search-add-toggle"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 self-start rounded p-1 text-xs text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)]"
        >
          <Plus size={14} /> Add custom engine
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 rounded border border-[var(--chrome-border)] bg-[var(--chrome-input-bg)] p-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Name</label>
            <input
              type="text"
              data-testid="settings-search-add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className="rounded bg-[var(--chrome-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">URL template</label>
            <input
              type="text"
              data-testid="settings-search-add-template"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://example.com/search?q={query}"
              spellCheck={false}
              className="rounded bg-[var(--chrome-bg)] px-2 py-1 font-mono text-xs text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
            />
            <span className="text-xs text-[var(--chrome-muted)]">Must contain {'{query}'}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="settings-search-add-cancel"
              onClick={cancel}
              className="rounded px-2 py-1 text-xs text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="settings-search-add-confirm"
              onClick={submit}
              disabled={!valid}
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
