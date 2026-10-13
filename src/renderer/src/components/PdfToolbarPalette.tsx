import { Download, EllipsisVertical, Printer } from 'lucide-react';
import { useState, type PointerEvent, type ReactElement } from 'react';
import { normalizeHexColor, toolbarForeground } from '@shared/pdf-toolbar';
import { hexToHsv, hsvToHex } from '../lib/color-picker';

const SWATCHES = [
  ['Charcoal', '#3c3c3c'], ['Slate', '#475569'], ['Navy', '#1e3a5f'], ['Blue', '#2563eb'],
  ['Teal', '#0f766e'], ['Green', '#15803d'], ['Purple', '#7c3aed'], ['Rose', '#be185d'],
  ['White', '#ffffff'], ['Silver', '#cbd5e1'], ['Sky', '#7dd3fc'], ['Mint', '#a7f3d0'],
  ['Yellow', '#fde047'], ['Orange', '#fb923c'], ['Lavender', '#c4b5fd'], ['Pink', '#f9a8d4'],
] as const;

export function PdfToolbarPalette({ value, onChange }: { value: string; onChange: (color: string) => void }): ReactElement {
  const hsv = hexToHsv(value);
  const [rememberedHue, setHue] = useState(hsv.h);
  const hue = hsv.s > 0 && hsv.v > 0 ? hsv.h : rememberedHue;
  const [edit, setEdit] = useState({ color: value, text: value });
  const draft = edit.color === value ? edit.text : value;
  const choose = (color: string): void => {
    setEdit({ color, text: color });
    onChange(color);
  };
  const pick = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    choose(hsvToHex({ h: hue, s, v }));
  };
  const commitHex = (): void => {
    const color = normalizeHexColor(draft);
    if (color) choose(color);
    else setEdit({ color: value, text: value });
  };
  const foreground = toolbarForeground(value);

  return (
    <div className="flex flex-col gap-3" data-testid="pdf-toolbar-palette">
      <div
        className="flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-xs"
        style={{ backgroundColor: value, color: foreground }}
        data-testid="pdf-toolbar-preview"
      >
        <span>Toolbar preview</span>
        <span className="flex gap-3" aria-hidden><Download size={14} /><Printer size={14} /><EllipsisVertical size={14} /></span>
      </div>
      <div className="grid grid-cols-8 gap-1.5" aria-label="Preset colors">
        {SWATCHES.map(([name, color]) => (
          <button
            key={color}
            type="button"
            aria-label={`Use ${name}`}
            aria-pressed={value === color}
            title={`${name} (${color})`}
            onClick={() => choose(color)}
            className="h-7 rounded-[var(--radius-sm)] border border-[var(--border)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={{ backgroundColor: color, boxShadow: value === color ? '0 0 0 2px var(--accent)' : undefined }}
          />
        ))}
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Color spectrum"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={value}
        data-testid="pdf-color-spectrum"
        className="relative h-28 cursor-crosshair rounded-[var(--radius-md)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hue} 100% 50%)`, touchAction: 'none' }}
        onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.02;
          const s = hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0);
          const v = hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
          choose(hsvToHex({ h: hue, s, v }));
        }}
      >
        <span aria-hidden className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#000]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
        Hue
        <input
          type="range" min={0} max={360} step={1} value={Math.round(hue)}
          aria-label="Hue" data-testid="pdf-color-hue"
          className="h-3 min-w-0 flex-1 cursor-pointer rounded-full appearance-none"
          style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
          onChange={(event) => {
            const h = Number(event.target.value);
            setHue(h);
            choose(hsvToHex({ ...hsv, h }));
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
        HEX
        <input
          type="text" value={draft} maxLength={7} spellCheck={false}
          aria-label="PDF toolbar hex color" data-testid="pdf-color-hex"
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--fg)]"
          onChange={(event) => {
            const text = event.target.value;
            setEdit({ color: value, text });
            if (/^#[0-9a-f]{6}$/i.test(text)) onChange(text.toLowerCase());
          }}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitHex(); }
            if (event.key === 'Escape') setEdit({ color: value, text: value });
          }}
        />
      </label>
    </div>
  );
}
