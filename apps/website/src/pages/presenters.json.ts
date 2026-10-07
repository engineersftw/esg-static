// Every active presenter's name, slug, photo and byline, in the list's order, for the name filter
// on /presenters (NameFilter.astro). It is a static file, so filtering costs no Function requests.
import { getActivePresenters } from '../helpers/collections';
import type { NameEntry } from '../helpers/nameFilter';

export async function GET() {
  const presenters = (await getActivePresenters()).sort((a, b) =>
    a.data.presenterName.trim().localeCompare(b.data.presenterName.trim()),
  );
  const entries: NameEntry[] = presenters.map((p) => ({
    name: p.data.presenterName.trim(),
    slug: p.data.slug,
    image: p.data.imageUrl,
    byline: p.data.presenterByline,
  }));
  return Response.json(entries);
}
