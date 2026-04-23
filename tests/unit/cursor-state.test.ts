import { describe, it, expect } from 'vitest';
import { isCursorInside } from '../../src/main/cursor-state';

describe('isCursorInside', () => {
  it('returns true when cursor is at the center of bounds', () => {
    const cursor = { x: 50, y: 50 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(true);
  });

  it('returns true when cursor is at the left edge (x === bounds.x)', () => {
    const cursor = { x: 0, y: 50 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(true);
  });

  it('returns true when cursor is at the top edge (y === bounds.y)', () => {
    const cursor = { x: 50, y: 0 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(true);
  });

  it('returns false when cursor is one pixel past the right edge (x === bounds.x + width)', () => {
    const cursor = { x: 100, y: 50 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('returns false when cursor is one pixel past the bottom edge (y === bounds.y + height)', () => {
    const cursor = { x: 50, y: 100 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('returns false when cursor is to the left of bounds', () => {
    const cursor = { x: -1, y: 50 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('returns false when cursor is to the right of bounds', () => {
    const cursor = { x: 101, y: 50 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('returns false when cursor is above bounds', () => {
    const cursor = { x: 50, y: -1 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('returns false when cursor is below bounds', () => {
    const cursor = { x: 50, y: 101 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(isCursorInside(cursor, bounds)).toBe(false);
  });

  it('handles negative bounds coordinates (multi-monitor scenario)', () => {
    const bounds = { x: -200, y: -150, width: 200, height: 150 };

    // Cursor inside (near right and bottom edges)
    expect(isCursorInside({ x: -10, y: -10 }, bounds)).toBe(true);

    // Cursor at left edge (inclusive)
    expect(isCursorInside({ x: -200, y: -100 }, bounds)).toBe(true);

    // Cursor at right edge exclusive
    expect(isCursorInside({ x: 0, y: -100 }, bounds)).toBe(false);

    // Cursor at top edge (inclusive)
    expect(isCursorInside({ x: -100, y: -150 }, bounds)).toBe(true);

    // Cursor at bottom edge exclusive
    expect(isCursorInside({ x: -100, y: 0 }, bounds)).toBe(false);
  });
});
