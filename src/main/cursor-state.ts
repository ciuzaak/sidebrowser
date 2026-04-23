export function isCursorInside(
  cursor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
  );
}
