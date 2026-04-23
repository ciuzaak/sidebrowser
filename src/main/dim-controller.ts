/**
 * DimController: idempotent apply/clear/retarget state machine for CSS dim effects.
 * CssTarget interface decouples from Electron so unit tests can use vi.fn() mocks.
 * Production code passes WebContents directly (structurally matches the interface).
 */

import type { DimSettings } from './settings';
import { buildFilterCSS } from './build-filter-css';

export interface CssTarget {
  insertCSS(rule: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
}

export class DimController {
  private state: { target: CssTarget; key: string } | null = null;

  async apply(target: CssTarget, dim: DimSettings): Promise<void> {
    const rule = buildFilterCSS(dim.effect, dim);
    if (rule === null) {
      await this.clear();
      return;
    }
    // Idempotent: same target already applied — return early
    if (this.state && this.state.target === target) return;
    // Different target (or no prior state): remove old CSS first
    if (this.state) await this.state.target.removeInsertedCSS(this.state.key);
    const key = await target.insertCSS(rule);
    this.state = { target, key };
  }

  async clear(): Promise<void> {
    if (!this.state) return;
    await this.state.target.removeInsertedCSS(this.state.key);
    this.state = null;
  }

  async retarget(newTarget: CssTarget, dim: DimSettings): Promise<void> {
    // No-op when inactive: avoids pre-applying dim before cursor leaves window
    if (!this.state) return;
    await this.apply(newTarget, dim);
  }

  get isActive(): boolean {
    return this.state !== null;
  }
}
