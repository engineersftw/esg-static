// Every active organization's name, slug, logo and website (its meetup page or site, the first
// `website` link, or null), in the list's order, for the name filter on
// /organizations (NameFilter.astro). It is a static file, so filtering costs no Function requests.
import { getActiveOrganizations } from '../helpers/collections';
import type { NameEntry } from '../helpers/nameFilter';

export async function GET() {
  const organizations = (await getActiveOrganizations()).sort((a, b) =>
    a.data.orgTitle.trim().localeCompare(b.data.orgTitle.trim()),
  );
  const entries: (NameEntry & { website: string | null })[] = organizations.map((o) => ({
    name: o.data.orgTitle.trim(),
    slug: o.data.slug,
    image: o.data.logoImage,
    website: o.data.links.find((link) => link.type === 'website')?.url ?? null,
  }));
  return Response.json(entries);
}
