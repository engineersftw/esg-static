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
 * A handle that is the slug of another presenter's page is left out, since that page must keep
 * working. A presenter whose slug is their own handle stays in, so `/s/<handle>` finds them; the
 * function leaves `/presenter/<handle>` alone when it would redirect to itself.
 */
export function handleSlugs(presenters: Entry[]): Record<string, string> {
  const slugOwners = new Map(presenters.map((presenter) => [presenter.data.slug.toLowerCase(), presenter.id]));
  const map: Record<string, string> = {};
  for (const presenter of presenters) {
    if (!isLegacyId(presenter.id)) continue;
    const link = presenter.data.links?.find((l) => l.type === 'x');
    const handle = link && xHandle(link.url);
    if (handle && (slugOwners.get(handle) ?? presenter.id) === presenter.id && !(handle in map)) map[handle] = presenter.data.slug;
  }
  return map;
}

/**
 * Old links with junk on the end: a search-engine tracking tail glued to the path (`…--1005&sa=U`,
 * from Google's `&sa=U` query parameters) or a literal `/null` segment after a video, presenter or
 * organization (`/video/<slug>/null`, from a missing value in the Rails view). Also the feed's old
 * trailing slashes (`/feed/`, `//feed/`). Returns the clean path, or the path itself when it has no
 * junk. Slugs, IDs and handles never contain `&`.
 */
export function cleanLegacyPath(pathname: string): string {
  const withoutTail = pathname.replace(/&.*$/, '') || pathname;
  return withoutTail
    .replace(/^(\/(?:video|presenter|organization)\/[^/]+)\/null\/?$/, '$1')
    .replace(/^\/+feed\/+$/, '/feed');
}

/** The key in `presenterHandle` for the handle in an old URL: lowercase, without a leading `@` (`/s/@Jane`). */
export const handleKey = (handle: string): string => handle.replace(/^@/, '').toLowerCase();

/**
 * A page number after an organization or presenter slug (`/organization/geekcampsg/5`) is the old
 * Rails pagination, or a page beyond the last one. Returns the entry's own page for the caller to
 * redirect to once the static site has said it has no such page, or null for any other path.
 */
export function pastLastPage(pathname: string): { kind: 'organization' | 'presenter'; slug: string } | null {
  const match = /^\/(organization|presenter)\/([^/]+)\/\d+\/?$/.exec(pathname);
  return match ? { kind: match[1] as 'organization' | 'presenter', slug: match[2] } : null;
}
