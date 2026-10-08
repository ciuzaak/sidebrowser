import { ChevronsUpDown, RotateCcw, X, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import type { Settings, ThemeChoice, SearchEngine } from '@shared/types';
import { DEFAULTS, BUILTIN_SEARCH_ENGINES } from '@shared/settings-defaults';
import { nanoid } from 'nanoid';
import { useSettingsStore } from '../store/settings-store';
import { StorageSection } from './StorageSection';

/**
 * Right-side overlay drawer exposing all 6 Settings sections (spec §7).
 *
 * **View-suppression coordination.** React DOM cannot cover the native
 * `WebContentsView` that hosts the active tab. The drawer relies on App.tsx
 * firing `view:set-suppressed` IPC on `open` state transitions — main then
 * hides the active view (M17: View.setVisible(false), bounds unchanged), so
 * this absolutely-positioned panel renders unobstructed. Closing the drawer
 * shows the view again via the inverse IPC. See spec §4.2 for the
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
  /** M13: ref to the topbar toggle so we don't auto-close when the user clicks it. */
  toggleRef: RefObject<HTMLButtonElement | null>;
}

type DimEffect = Settings['dim']['effect'];
type WindowPreset = Settings['window']['preset'];

export function SettingsDrawer({ open, onClose, toggleRef }: SettingsDrawerProps): ReactElement | null {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // M13: outside-click to close. Effect must run unconditionally (Rules of Hooks)
  // — placed BEFORE the early returns; the `open` guard inside short-circuits.
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

  // Null-gate (pre-hydration) AND closed-gate (don't paint anything when hidden).
  if (!open) return null;
  if (settings === null) return null;

  return (
    <div
      ref={drawerRef}
      data-testid="settings-drawer"
      className="absolute inset-0 z-10 flex flex-col overflow-y-auto bg-[var(--surface)] text-[var(--fg)]"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <h2 className="text-base font-semibold">Settings</h2>
        <button
          type="button"
          aria-label="Close settings"
          data-testid="settings-close"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-4">
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
            <SelectField
              testId="settings-theme"
              value={settings.appearance.theme}
              onChange={(v) => void update({ appearance: { theme: v as ThemeChoice } })}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </SelectField>
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
            <SelectField
              testId="settings-window-preset"
              value={settings.window.preset}
              onChange={(v) => void update({ window: { preset: v as WindowPreset } })}
            >
              <option value="iphone14pro">iPhone 14 Pro (393x852)</option>
              <option value="iphonese">iPhone SE (375x667)</option>
              <option value="pixel7">Pixel 7 (412x915)</option>
            </SelectField>
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
          <Row
            label="Always on top"
            rightSlot={
              <ResetIcon
                show={settings.window.alwaysOnTop !== DEFAULTS.window.alwaysOnTop}
                onClick={() => void update({ window: { alwaysOnTop: DEFAULTS.window.alwaysOnTop } })}
                testId="reset-window-always-on-top"
              />
            }
          >
            <label className="mac-toggle">
              <input
                type="checkbox"
                data-testid="settings-window-always-on-top"
                checked={settings.window.alwaysOnTop}
                onChange={(e) => void update({ window: { alwaysOnTop: e.target.checked } })}
              />
            </label>
          </Row>
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
            <SelectField
              testId="settings-dim-effect"
              value={settings.dim.effect}
              onChange={(v) => void update({ dim: { effect: v as DimEffect } })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="blur">Blur</option>
              <option value="none">None</option>
            </SelectField>
          </Row>
          {settings.dim.effect === 'blur' && (
            <Slider
              label="Blur"
              unit="px"
              testId="settings-dim-blur"
              value={settings.dim.blurPx}
              min={0}
              max={40}
              step={1}
              onChange={(n) => void update({ dim: { blurPx: n } })}
              rightSlot={
                <ResetIcon
                  show={settings.dim.blurPx !== DEFAULTS.dim.blurPx}
                  onClick={() => void update({ dim: { blurPx: DEFAULTS.dim.blurPx } })}
                  testId="reset-dim-blur"
                />
              }
            />
          )}
          {settings.dim.effect === 'dark' && (
            <Slider
              label="Dark brightness"
              testId="settings-dim-dark-brightness"
              value={settings.dim.darkBrightness}
              min={0}
              max={1}
              step={0.05}
              onChange={(n) => void update({ dim: { darkBrightness: n } })}
              rightSlot={
                <ResetIcon
                  show={settings.dim.darkBrightness !== DEFAULTS.dim.darkBrightness}
                  onClick={() => void update({ dim: { darkBrightness: DEFAULTS.dim.darkBrightness } })}
                  testId="reset-dim-dark-brightness"
                />
              }
            />
          )}
          {settings.dim.effect === 'light' && (
            <Slider
              label="Light brightness"
              testId="settings-dim-light-brightness"
              value={settings.dim.lightBrightness}
              min={0}
              max={1}
              step={0.05}
              onChange={(n) => void update({ dim: { lightBrightness: n } })}
              rightSlot={
                <ResetIcon
                  show={settings.dim.lightBrightness !== DEFAULTS.dim.lightBrightness}
                  onClick={() => void update({ dim: { lightBrightness: DEFAULTS.dim.lightBrightness } })}
                  testId="reset-dim-light-brightness"
                />
              }
            />
          )}
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
            <label className="mac-toggle">
              <input
                type="checkbox"
                data-testid="settings-edgedock-enabled"
                checked={settings.edgeDock.enabled}
                onChange={(e) => void update({ edgeDock: { enabled: e.target.checked } })}
              />
            </label>
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
            <label className="mac-toggle">
              <input
                type="checkbox"
                data-testid="settings-lifecycle-restore-tabs"
                checked={settings.lifecycle.restoreTabsOnLaunch}
                onChange={(e) =>
                  void update({ lifecycle: { restoreTabsOnLaunch: e.target.checked } })
                }
              />
            </label>
          </Row>
          <Row
            label="Unload inactive tabs"
            rightSlot={
              <ResetIcon
                show={settings.lifecycle.discardAfterMin !== DEFAULTS.lifecycle.discardAfterMin}
                onClick={() =>
                  void update({ lifecycle: { discardAfterMin: DEFAULTS.lifecycle.discardAfterMin } })
                }
                testId="reset-lifecycle-discard"
              />
            }
          >
            <SelectField
              testId="settings-lifecycle-discard"
              value={String(settings.lifecycle.discardAfterMin)}
              onChange={(v) => void update({ lifecycle: { discardAfterMin: Number(v) } })}
            >
              <option value="0">Never</option>
              <option value="15">After 15 min</option>
              <option value="30">After 30 min</option>
              <option value="60">After 1 hour</option>
            </SelectField>
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
            <label className="mac-toggle">
              <input
                type="checkbox"
                data-testid="settings-browsing-default-mobile"
                checked={settings.browsing.defaultIsMobile}
                onChange={(e) =>
                  void update({ browsing: { defaultIsMobile: e.target.checked } })
                }
              />
            </label>
          </Row>
          <Row
            label="Mute when hidden at edge"
            rightSlot={
              <ResetIcon
                show={settings.browsing.muteWhenHidden !== DEFAULTS.browsing.muteWhenHidden}
                onClick={() =>
                  void update({ browsing: { muteWhenHidden: DEFAULTS.browsing.muteWhenHidden } })
                }
                testId="reset-browsing-mute-hidden"
              />
            }
          >
            <label className="mac-toggle">
              <input
                type="checkbox"
                data-testid="settings-browsing-mute-hidden"
                checked={settings.browsing.muteWhenHidden}
                onChange={(e) => void update({ browsing: { muteWhenHidden: e.target.checked } })}
              />
            </label>
          </Row>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--fg-muted)]">Mobile user agent</label>
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
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1 font-mono text-xs text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
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
            <SelectField
              testId="settings-search-active"
              value={settings.search.activeId}
              onChange={(v) => void update({ search: { activeId: v } })}
            >
              {settings.search.engines.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.name}
                </option>
              ))}
            </SelectField>
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

        {/* ── 8. Storage (M16) ─────────────────────────────────── */}
        <StorageSection Section={Section} />
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
    <section className="rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] p-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h3>
        {rightHeader}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
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
      <label className="text-sm text-[var(--fg)]">{label}</label>
      <div className="flex items-center gap-2">
        {children}
        {rightSlot}
      </div>
    </div>
  );
}

/** M17: styled <select> (globals.css `.mac-select`) with a chevron icon overlay. */
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

interface SliderProps {
  label: string;
  testId: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
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
  onChange,
  rightSlot,
}: SliderProps): ReactElement {
  const display = step < 1 ? value.toFixed(2) : String(value);
  // M17: filled-track percentage, read by the .mac-slider track gradient.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm text-[var(--fg)]">{label}</label>
        <div className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
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
        className="mac-slider"
        style={{ '--fill': `${pct}%` } as CSSProperties}
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
      className={`shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] ${show ? '' : 'invisible'}`}
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

  const trimmedTemplate = urlTemplate.trim();
  const valid = name.trim() !== '' && trimmedTemplate.includes('{query}');

  const submit = (): void => {
    if (!valid) return;
    onAdd({ id: nanoid(), name: name.trim(), urlTemplate: trimmedTemplate, builtin: false });
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
      <label className="text-xs font-medium text-[var(--fg-muted)]">Engines</label>
      <ul data-testid="settings-search-engines" className="flex flex-col gap-1">
        {engines.map((eng) => (
          <li
            key={eng.id}
            className="flex items-center justify-between rounded-[var(--radius-md)] px-2 py-1 text-sm hover:bg-[var(--accent-tint)]"
          >
            <span className="text-[var(--fg)]">{eng.name}</span>
            {eng.builtin ? (
              <span className="text-xs text-[var(--fg-muted)]">built-in</span>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${eng.name}`}
                data-testid={`settings-search-delete-${eng.id}`}
                onClick={() => onDelete(eng.id)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
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
          className="flex items-center gap-1 self-start rounded-[var(--radius-md)] p-1.5 text-xs text-[var(--accent-text)] hover:bg-[var(--accent-tint)]"
        >
          <Plus size={14} /> Add custom engine
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--fg-muted)]">Name</label>
            <input
              type="text"
              data-testid="settings-search-add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--fg-muted)]">URL template</label>
            <input
              type="text"
              data-testid="settings-search-add-template"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://example.com/search?q={query}"
              spellCheck={false}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 font-mono text-xs text-[var(--fg)] outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
            />
            <span className="text-xs text-[var(--fg-muted)]">Must contain {'{query}'}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="settings-search-add-cancel"
              onClick={cancel}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg)] hover:bg-[var(--accent-tint)]"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="settings-search-add-confirm"
              onClick={submit}
              disabled={!valid}
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
