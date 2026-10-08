/** First case-insensitive occurrence of `query` in `text` → [before, match, after]. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim();
  if (q === '') return null;
  // Regex `i` matching keeps indices in the original string (toLowerCase()
  // can change string length for some Unicode characters).
  const m = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(text);
  if (m === null) return null;
  return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)];
}
