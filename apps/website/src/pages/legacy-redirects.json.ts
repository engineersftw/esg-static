// ID → slug for every active video, organization and presenter from the Rails site (the numeric
// IDs), used by the Pages Function in functions/_middleware.ts to redirect the old ID-based URLs.
// Entries added since have no old URLs. Inactive entries are left out, so their old URLs 404 like
// their pages do.
import type { CollectionEntry } from 'astro:content';
import { getActiveOrganizations, getActivePresenters, getActiveVideos } from '../helpers/collections';

const bySlug = (entries: CollectionEntry<'video' | 'organization' | 'presenter'>[]) =>
  Object.fromEntries(entries.filter((entry) => /^\d+$/.test(entry.id)).map((entry) => [entry.id, entry.data.slug]));

export async function GET() {
  return Response.json({
    video: bySlug(await getActiveVideos()),
    organization: bySlug(await getActiveOrganizations()),
    presenter: bySlug(await getActivePresenters()),
  });
}
