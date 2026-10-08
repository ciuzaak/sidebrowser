import { describe, it, expect } from 'vitest';
import { formatBytes, downloadPercent } from '../../src/renderer/src/lib/format-bytes';

describe('formatBytes', () => {
  it('formats across units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12.3 * 1024)).toBe('12.3 KB');
    expect(formatBytes(376 * 1024 * 1024)).toBe('376 MB');
    expect(formatBytes(1.14 * 1024 ** 3)).toBe('1.14 GB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('downloadPercent', () => {
  it('rounds and clamps; null when size unknown', () => {
    expect(downloadPercent(50, 200)).toBe(25);
    expect(downloadPercent(300, 200)).toBe(100);
    expect(downloadPercent(10, 0)).toBeNull();
  });
});
