/**
 * window.open / target=_blank routing (M16). Pure — the Electron wiring lives in
 * ViewManager's setWindowOpenHandler.
 *
 * - `new-window` (window.open with features — OAuth / payment popups) becomes a
 *   real popup window so `window.opener` survives and the flow can postMessage
 *   back. Only for http(s) URLs.
 * - `background-tab` (Ctrl / middle click) opens a tab without activating it.
 * - Everything else opens and activates a tab (pre-M16 behavior).
 */
export type WindowOpenDecision = { kind: 'popup' } | { kind: 'tab'; activate: boolean };

export function decideWindowOpen(details: { disposition: string; url: string }): WindowOpenDecision {
  if (details.disposition === 'new-window' && /^https?:/i.test(details.url)) {
    return { kind: 'popup' };
  }
  if (details.disposition === 'background-tab') return { kind: 'tab', activate: false };
  return { kind: 'tab', activate: true };
}

const POPUP_MIN = 320;
const POPUP_MAX = 1000;

/** Popup size from a window.open features string ("width=500,height=600"), clamped. */
export function popupSizeFromFeatures(features: string): { width: number; height: number } {
  const read = (key: string, fallback: number): number => {
    const m = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(\\d+)`, 'i').exec(features);
    const n = m ? Number(m[1]) : fallback;
    return Math.min(POPUP_MAX, Math.max(POPUP_MIN, n));
  };
  return { width: read('width', 500), height: read('height', 640) };
}
