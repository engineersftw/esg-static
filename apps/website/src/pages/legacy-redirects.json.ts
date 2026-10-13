// ID → slug for every active video, organization, presenter, conference and playlist from the Rails site (the
// numeric IDs), plus lowercase X handle → presenter slug (the old /presenter/<twitter_id> and
// /s/<twitter_id>). Used by the Pages Function in functions/_middleware.ts to redirect the old URLs.
// Entries added since have no old URLs. Inactive entries are left out, so their old URLs 404 like
// their pages do.
import { getActiveOrganizations, getActivePresenters, getActiveVideos, getConferencePages, getPlaylistPages } from '../helpers/collections';
import { handleSlugs, slugsById } from '../helpers/legacyRedirects';

export async function GET() {
  const presenters = await getActivePresenters();
  // Playlists with a /conference page: conferences and their tracks.
  // An ID that is also the slug of a conference page is left out, so that page keeps working.
  const pages = (await getConferencePages()).map(({ playlist }) => playlist);
  const pageSlugs = new Set(pages.map((playlist) => playlist.data.slug));
  const conferences = pages.filter((playlist) => !pageSlugs.has(playlist.id));
  // The other playlists, which have a /playlist page. Same rule for an ID that is a page slug.
  const playlists = (await getPlaylistPages()).map(({ playlist }) => playlist);
  const playlistSlugs = new Set(playlists.map((playlist) => playlist.data.slug));
  return Response.json({
    video: slugsById(await getActiveVideos()),
    organization: slugsById(await getActiveOrganizations()),
    presenter: slugsById(presenters),
    presenterHandle: handleSlugs(presenters),
    conference: slugsById(conferences),
    playlist: slugsById(playlists.filter((playlist) => !playlistSlugs.has(playlist.id))),
  });
}
