import { type CollectionEntry, getCollection, getEntries } from 'astro:content';

const newestFirst = (a: CollectionEntry<'video'>, b: CollectionEntry<'video'>) =>
  b.data.publishedAt.localeCompare(a.data.publishedAt) || Number(b.id) - Number(a.id);

/**
 * Every active video. Use this, not `getCollection('video')`, for anything that lists or builds a
 * page for videos: inactive (unlisted) ones are left out of the site entirely.
 */
export const getActiveVideos = () => getCollection('video', (video) => video.data.active);

/** Videos shown in listings: newest first, without inactive (unlisted) ones. */
export async function getListedVideos() {
  return (await getActiveVideos()).sort(newestFirst);
}

/** Drop inactive videos from resolved references, keeping their order. */
export const listed = (videos: CollectionEntry<'video'>[]) => videos.filter((video) => video.data.active);

/** Every active organization. Use this, not `getCollection('organization')`. */
export const getActiveOrganizations = () => getCollection('organization', (organization) => organization.data.active);

/** Every active presenter. Use this, not `getCollection('presenter')`. */
export const getActivePresenters = () => getCollection('presenter', (presenter) => presenter.data.active);

/** Every active playlist. Use this, not `getCollection('playlist')`. */
export const getActivePlaylists = () => getCollection('playlist', (playlist) => playlist.data.active);

/** Drop inactive organizations from resolved references, keeping their order. */
export const listedOrganizations = (organizations: CollectionEntry<'organization'>[]) =>
  organizations.filter((organization) => organization.data.active);

/** Drop inactive presenters from resolved references, keeping their order. */
export const listedPresenters = (presenters: CollectionEntry<'presenter'>[]) =>
  presenters.filter((presenter) => presenter.data.active);

/** Drop inactive playlists from resolved references, keeping their order. */
export const listedPlaylists = (playlists: CollectionEntry<'playlist'>[]) =>
  playlists.filter((playlist) => playlist.data.active);

const newestPlaylistFirst = (a: CollectionEntry<'playlist'>, b: CollectionEntry<'playlist'>) =>
  (b.data.publishDate ?? '').localeCompare(a.data.publishDate ?? '') || Number(b.id) - Number(a.id);

/** Active playlists in the "Conference" category, newest first. */
export async function getConferences() {
  return (
    await getCollection('playlist', (playlist) => playlist.data.active && playlist.data.category === 'Conference')
  ).sort(newestPlaylistFirst);
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
    for (const sub of listedPlaylists(await getEntries(next.playlist.data.subPlaylists))) queue.push({ playlist: sub, parent: next.playlist });
  }
  return [...pages.values()];
}

/**
 * Every active playlist that gets a /playlist page: those without a /conference page (meetups,
 * uncategorised playlists), each with the active playlist it is nested under, if any. Conference
 * playlists and their tracks keep their /conference page as the only one.
 */
export async function getPlaylistPages() {
  const conferenceIds = new Set((await getConferencePages()).map(({ playlist }) => playlist.id));
  const playlists = await getCollection('playlist', (playlist) => playlist.data.active);
  const parentOf = new Map<string, CollectionEntry<'playlist'>>();
  for (const playlist of playlists) {
    for (const sub of playlist.data.subPlaylists) if (!parentOf.has(sub.id)) parentOf.set(sub.id, playlist);
  }
  return playlists
    .filter((playlist) => !conferenceIds.has(playlist.id))
    .map((playlist) => ({ playlist, parent: parentOf.get(playlist.id) }));
}
