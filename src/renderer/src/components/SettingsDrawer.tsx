import { X } from 'lucide-react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import type { Settings } from '@shared/types';
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
        {/* ── 1. Window ───────────────────────────────────────── */}
        <Section title="Window">
          <Row label="Preset">
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
          />
        </Section>

        {/* ── 3. Dim ──────────────────────────────────────────── */}
        <Section title="Dim">
          <Row label="Effect">
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
          />
        </Section>

        {/* ── 4. Edge dock ────────────────────────────────────── */}
        <Section title="Edge dock">
          <Row label="Enabled">
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
          />
        </Section>

        {/* ── 5. Session ──────────────────────────────────────── */}
        <Section title="Session">
          <Row label="Restore tabs on launch">
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
          <Row label="Default new tab = mobile">
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
            <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">Mobile user agent</label>
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
      </div>
    </div>
  );
}

// ── internal helpers ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="mb-1 border-b border-[var(--chrome-border)] pb-1 text-sm font-semibold text-[var(--chrome-fg)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">{label}</label>
      {children}
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
}: SliderProps): ReactElement {
  const display = step < 1 ? value.toFixed(2) : String(value);
  return (
    <div className={`flex flex-col gap-1 ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--chrome-fg)] opacity-80">{label}</label>
        <span className="text-xs text-[var(--chrome-muted)]">
          {display}
          {unit ?? ''}
        </span>
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
