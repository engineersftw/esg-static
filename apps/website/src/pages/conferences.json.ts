// Every active conference's title, slug, image and date, in the list's order (newest first), for
// the name filter on /conferences (NameFilter.astro). It is a static file, so filtering costs no
// Function requests.
import { getConferences } from '../helpers/collections';
import type { NameEntry } from '../helpers/nameFilter';

export async function GET() {
  const entries: NameEntry[] = (await getConferences()).map((c) => ({
    name: c.data.playlistTitle.trim(),
    slug: c.data.slug,
    image: c.data.image,
    byline: c.data.publishDate
      ? new Date(c.data.publishDate).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric' })
      : null,
  }));
  return Response.json(entries);
}
