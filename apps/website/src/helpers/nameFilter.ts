// Filtering the presenter and organization lists by name, in the browser: NameFilter.astro loads
// every name from /presenters.json or /organizations.json (src/pages/*.json.ts) and calls this.
import { normalize, queryTerms } from './search';

/** One presenter or organization, as the list pages show it. */
export interface NameEntry {
  name: string;
  slug: string;
  image: string | null;
  /** A presenter's byline; organizations have none. */
  byline?: string | null;
}

/**
 * The entries whose name contains every word of `query` (ignoring case and accents), keeping their
 * order, except that names starting with the first word come first.
 */
export function filterByName<T extends NameEntry>(entries: T[], query: string): T[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const matches = entries
    .map((entry) => ({ entry, name: normalize(entry.name.trim()) }))
    .filter(({ name }) => terms.every((term) => name.includes(term)));
  const starts = matches.filter(({ name }) => name.startsWith(terms[0]));
  const rest = matches.filter(({ name }) => !name.startsWith(terms[0]));
  return [...starts, ...rest].map(({ entry }) => entry);
}
