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
