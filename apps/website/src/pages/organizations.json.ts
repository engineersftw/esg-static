// Every active organization's name, slug and logo, in the list's order, for the name filter on
// /organizations (NameFilter.astro). It is a static file, so filtering costs no Function requests.
import { getActiveOrganizations } from '../helpers/collections';
import type { NameEntry } from '../helpers/nameFilter';

export async function GET() {
  const organizations = (await getActiveOrganizations()).sort((a, b) =>
    a.data.orgTitle.trim().localeCompare(b.data.orgTitle.trim()),
  );
  const entries: NameEntry[] = organizations.map((o) => ({
    name: o.data.orgTitle.trim(),
    slug: o.data.slug,
    image: o.data.logoImage,
  }));
  return Response.json(entries);
}
