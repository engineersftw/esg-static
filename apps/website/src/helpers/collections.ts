import { type CollectionEntry, getCollection, getEntries } from 'astro:content';

const newestFirst = (a: CollectionEntry<'video'>, b: CollectionEntry<'video'>) =>
  b.data.publishedAt.localeCompare(a.data.publishedAt) || Number(b.id) - Number(a.id);

/** Videos shown in listings: newest first, without inactive (unlisted) ones. */
export async function getListedVideos() {
  return (await getCollection('video', (video) => video.data.active)).sort(newestFirst);
}

/** Drop inactive videos from resolved references, keeping their order. */
export const listed = (videos: CollectionEntry<'video'>[]) => videos.filter((video) => video.data.active);

const newestPlaylistFirst = (a: CollectionEntry<'playlist'>, b: CollectionEntry<'playlist'>) =>
  (b.data.publishDate ?? '').localeCompare(a.data.publishDate ?? '') || Number(b.id) - Number(a.id);

/** Playlists in the "Conference" category, newest first. */
export async function getConferences() {
  return (await getCollection('playlist', (playlist) => playlist.data.category === 'Conference')).sort(
    newestPlaylistFirst,
  );
}

/**
 * Every playlist that gets a /conference page: the conferences plus their sub-playlists (tracks),
 * each with the playlist it is nested under, if any.
 */
export async function getConferencePages() {
  const pages = new Map<string, { playlist: CollectionEntry<'playlist'>; parent?: CollectionEntry<'playlist'> }>();
  const queue = (await getConferences()).map((playlist) => ({ playlist, parent: undefined as CollectionEntry<'playlist'> | undefined }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (pages.has(next.playlist.id)) continue;
    pages.set(next.playlist.id, next);
    for (const sub of await getEntries(next.playlist.data.subPlaylists)) queue.push({ playlist: sub, parent: next.playlist });
  }
  return [...pages.values()];
}
