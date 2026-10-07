/** Normalize: lowercase + collapse hyphens to spaces. */
export function normSearch(s: string): string {
  return s.toLowerCase().replace(/-/g, ' ');
}

/**
 * Multi-word match: ALL whitespace-delimited tokens in `query` must appear
 * somewhere in the combined text of `fields`. Single-word queries degenerate
 * to the existing .includes() behavior.
 */
export function multiWordMatch(fields: string[], query: string): boolean {
  if (!query) return true;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const combined = fields.join(' ');
  return tokens.every(token => combined.includes(token));
}
