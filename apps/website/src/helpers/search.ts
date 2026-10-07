// Video keyword search, used by the Pages Function functions/api/search.ts over the index that
// src/pages/search-index.json.ts builds. It is plain TypeScript with no Astro or Workers APIs, so
// the tests run it directly.
//
// Every word of the query must appear somewhere in a video: its title, presenters, organizations,
// playlists or description. Matching ignores case and accents, and a word matches inside longer
// words ("kube" finds "Kubernetes"). Results rank title matches first, then presenter and
// organization names, then playlists, then descriptions, with a bonus for a match at the start of a
// word and for the whole query appearing in the title; ties keep the index order, newest first.

/** One video in the index. */
export interface SearchEntry {
  slug: string;
  title: string;
  /** ISO 8601 publish time. */
  date: string;
  thumbnail: string | null;
  presenters: string[];
  organizations: string[];
  playlists: string[];
  description: string;
}

/** What a result shows: everything but the text that was only there to be searched. */
export type SearchResult = Omit<SearchEntry, 'playlists' | 'description'>;

export interface SearchResponse {
  query: string;
  /** How many videos match in all. */
  total: number;
  page: number;
  pageSize: number;
  results: SearchResult[];
}

export const PAGE_SIZE = 20;
/** Longer queries are cut to this many characters. */
export const MAX_QUERY_LENGTH = 100;
const MAX_TERMS = 8;

/** Lowercase without accents, so "Café" matches "cafe". */
export const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The words of a query, normalized and without repeats. Punctuation around a word is dropped, but
 * "+" and "#" are kept so that "C++" and "C#" stay searchable; a word of one letter is ignored unless
 * it is all there is to search for.
 */
export function queryTerms(query: string): string[] {
  const words = normalize(query.slice(0, MAX_QUERY_LENGTH))
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}+#]+|[^\p{L}\p{N}+#]+$/gu, ''))
    .filter(Boolean);
  const unique = [...new Set(words)];
  const long = unique.filter((word) => word.length > 1);
  return (long.length ? long : unique).slice(0, MAX_TERMS);
}

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);

/** Where `term` matches in `text`: -1 if nowhere, 1 inside a word, 2 at the start of one. */
function matchStrength(text: string, term: string): number {
  let at = text.indexOf(term);
  if (at < 0) return -1;
  while (at >= 0) {
    if (!isWordChar(text[at - 1])) return 2;
    at = text.indexOf(term, at + 1);
  }
  return 1;
}

// Points for a term found in each field, at the start of a word / inside one.
const WEIGHTS = [
  ['title', 15, 10],
  ['people', 10, 7],
  ['playlists', 5, 4],
  ['description', 2, 1],
] as const;
const WHOLE_QUERY_IN_TITLE = 20;

interface Prepared {
  entry: SearchEntry;
  title: string;
  people: string;
  playlists: string;
  description: string;
}

/** A search function over `entries`, which normalizes their text once. */
export function createSearch(entries: SearchEntry[]) {
  const prepared: Prepared[] = entries.map((entry) => ({
    entry,
    title: normalize(entry.title),
    people: normalize([...entry.presenters, ...entry.organizations].join('\n')),
    playlists: normalize(entry.playlists.join('\n')),
    description: normalize(entry.description),
  }));

  return function search(query: string, page = 1): SearchResponse {
    const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
    const terms = queryTerms(trimmed);
    const phrase = terms.length > 1 ? normalize(trimmed).replace(/\s+/g, ' ') : null;

    const scored: { entry: SearchEntry; score: number }[] = [];
    if (terms.length) {
      for (const item of prepared) {
        let score = 0;
        for (const term of terms) {
          let best = 0;
          for (const [field, start, inside] of WEIGHTS) {
            const strength = matchStrength(item[field], term);
            if (strength > 0) best = Math.max(best, strength === 2 ? start : inside);
          }
          if (!best) {
            score = 0;
            break;
          }
          score += best;
        }
        if (!score) continue;
        if (phrase && item.title.includes(phrase)) score += WHOLE_QUERY_IN_TITLE;
        scored.push({ entry: item.entry, score });
      }
    }
    // Array.prototype.sort is stable, so equal scores keep the index order.
    scored.sort((a, b) => b.score - a.score);

    const pages = Math.max(1, Math.ceil(scored.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const results = scored
      .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
      .map(({ entry: { playlists: _playlists, description: _description, ...result } }) => result);
    return { query: trimmed, total: scored.length, page: current, pageSize: PAGE_SIZE, results };
  };
}
