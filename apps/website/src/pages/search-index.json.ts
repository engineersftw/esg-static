// The video search index: one entry per active video, with the names of its active presenters,
// organizations and playlists, and its description. Built to dist/search-index.json and bundled
// into the Pages Function functions/api/search.ts, which searches it (src/helpers/search.ts).
import { getActiveOrganizations, getActivePresenters, getListedVideos, getVideoPlaylists } from '../helpers/collections';
import type { SearchEntry } from '../helpers/search';

const names = <T extends { id: string }>(entries: T[], name: (entry: T) => string) =>
  new Map(entries.map((entry) => [entry.id, name(entry).trim()]));

export async function GET() {
  const presenters = names(await getActivePresenters(), (p) => p.data.presenterName);
  const organizations = names(await getActiveOrganizations(), (o) => o.data.orgTitle);
  const resolve = (ids: { id: string }[], from: Map<string, string>) =>
    ids.flatMap(({ id }) => from.get(id) ?? []);

  const entries: SearchEntry[] = await Promise.all((await getListedVideos()).map(async (video) => ({
    slug: video.data.slug,
    title: video.data.videoTitle.trim(),
    date: video.data.publishedAt,
    // The stored high-quality thumbnail: the card crops it to 16:9 (see helpers/thumbnails.ts).
    thumbnail: video.data.thumbnailHigh ?? video.data.thumbnailMedium ?? video.data.thumbnailDefault,
    presenters: resolve(video.data.presenters, presenters),
    organizations: resolve(video.data.organizations, organizations),
    playlists: (await getVideoPlaylists(video.id)).map((playlist) => playlist.data.playlistTitle.trim()),
    description: video.body ?? '',
  })));
  return Response.json(entries);
}
