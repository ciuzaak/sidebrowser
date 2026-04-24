import { describe, it, expect } from 'vitest';
import { resolveTheme } from '@renderer/theme/useTheme';

describe('resolveTheme', () => {
  it('choice=dark → dark regardless of system', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('choice=light → light regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('choice=system → follows systemIsDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
