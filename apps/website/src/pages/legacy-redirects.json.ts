// ID → slug for every active video, organization and presenter, used by the Pages Function in
// functions/_middleware.ts to redirect the old Rails ID-based URLs. Inactive entries are left out,
// so their old URLs 404 like their pages do.
import type { CollectionEntry } from 'astro:content';
import { getActiveOrganizations, getActivePresenters, getActiveVideos } from '../helpers/collections';

const bySlug = (entries: CollectionEntry<'video' | 'organization' | 'presenter'>[]) =>
  Object.fromEntries(entries.map((entry) => [entry.id, entry.data.slug]));

export async function GET() {
  return Response.json({
    video: bySlug(await getActiveVideos()),
    organization: bySlug(await getActiveOrganizations()),
    presenter: bySlug(await getActivePresenters()),
  });
}
