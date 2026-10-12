// Pure helpers for src/pages/legacy-redirects.json.ts: the maps the Pages Function in
// functions/_middleware.ts uses to redirect the old Rails URLs.
// The website doesn't depend on @esg/db-types, so the link shape is spelled out here.
export interface Entry {
  id: string;
  data: { slug: string; links?: { type: string; url: string }[] };
}

/** Rails ids were plain numbers; entries added since have no old URLs. */
const isLegacyId = (id: string) => /^\d+$/.test(id);

/** `id` → slug for the entries that came from Rails. */
export const slugsById = (entries: Entry[]): Record<string, string> =>
  Object.fromEntries(entries.filter((entry) => isLegacyId(entry.id)).map((entry) => [entry.id, entry.data.slug]));

/** The lowercase handle in an X (or old Twitter) profile URL, e.g. `https://x.com/Jane_Doe` → `jane_doe`. */
export function xHandle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|mobile)\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const handle = parsed.pathname.split('/').filter(Boolean)[0];
  return handle && /^\w{1,15}$/.test(handle) ? handle.toLowerCase() : null;
}

/**
 * Old `/presenter/<twitter_id>` and `/s/<twitter_id>` URLs: lowercase X handle → presenter slug, for
 * the Rails presenters. Two presenters can share a handle; the first in `presenters` order wins.
 * A handle that is also the slug of a presenter page is left out, since that page must keep working
 * (and a presenter whose slug is their handle would redirect to itself).
 */
export function handleSlugs(presenters: Entry[]): Record<string, string> {
  const slugs = new Set(presenters.map((presenter) => presenter.data.slug.toLowerCase()));
  const map: Record<string, string> = {};
  for (const presenter of presenters) {
    if (!isLegacyId(presenter.id)) continue;
    const link = presenter.data.links?.find((l) => l.type === 'x');
    const handle = link && xHandle(link.url);
    if (handle && !slugs.has(handle) && !(handle in map)) map[handle] = presenter.data.slug;
  }
  return map;
}
