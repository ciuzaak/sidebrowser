/** First case-insensitive occurrence of `query` in `text` → [before, match, after]. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim();
  if (q === '') return null;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return null;
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}
