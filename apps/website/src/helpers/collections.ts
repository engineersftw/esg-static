import { type CollectionEntry, getCollection, getEntries } from 'astro:content';

/** Entry IDs in order: legacy numeric IDs by number, then the others (`yt-…`, random) as text. */
export function compareIds(a: string, b: string) {
  const [legacyA, legacyB] = [/^\d+$/.test(a), /^\d+$/.test(b)];
  if (legacyA && legacyB) return Number(a) - Number(b);
  if (legacyA !== legacyB) return legacyA ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

const newestFirst = (a: CollectionEntry<'video'>, b: CollectionEntry<'video'>) =>
  b.data.publishedAt.localeCompare(a.data.publishedAt) || compareIds(b.id, a.id);

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

let peopleNames: Promise<{ presenters: Map<string, string>; organizations: Map<string, string> }> | undefined;

// The names of every active presenter and organization by ID, looked up once per build.
const getPeopleNames = () =>
  (peopleNames ??= Promise.all([getActivePresenters(), getActiveOrganizations()]).then(([presenters, organizations]) => ({
    presenters: new Map(presenters.map((p) => [p.id, p.data.presenterName.trim()])),
    organizations: new Map(organizations.map((o) => [o.id, o.data.orgTitle.trim()])),
  })));

/**
 * The names under a video's card: its active presenters, then its active organizations, comma
 * separated. `without` leaves one name out, such as the organization whose page lists the video.
 */
export async function getVideoByline(video: CollectionEntry<'video'>, without?: string) {
  const { presenters, organizations } = await getPeopleNames();
  const names = [
    ...video.data.presenters.flatMap(({ id }) => presenters.get(id) ?? []),
    ...video.data.organizations.flatMap(({ id }) => organizations.get(id) ?? []),
  ];
  return names.filter((name) => name !== without?.trim()).join(', ');
}

type ReverseLinks = {
  videosByPresenter: Map<string, CollectionEntry<'video'>[]>;
  videosByOrganization: Map<string, CollectionEntry<'video'>[]>;
  playlistsByVideo: Map<string, CollectionEntry<'playlist'>[]>;
};
let reverseLinks: Promise<ReverseLinks> | undefined;

const push = <T extends { id: string }>(map: Map<string, T[]>, key: string, entry: T) => {
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.some((e) => e.id === entry.id)) list.push(entry);
};

// Each link is stored on one side only: a video names its presenters and organizations, and a
// playlist lists its videos. The other direction is worked out here, once per build.
const getReverseLinks = () =>
  (reverseLinks ??= Promise.all([getListedVideos(), getActivePlaylists()]).then(([videos, playlists]) => {
    const links: ReverseLinks = { videosByPresenter: new Map(), videosByOrganization: new Map(), playlistsByVideo: new Map() };
    for (const video of videos) {
      for (const { id } of video.data.presenters) push(links.videosByPresenter, id, video);
      for (const { id } of video.data.organizations) push(links.videosByOrganization, id, video);
    }
    for (const playlist of [...playlists].sort((a, b) => compareIds(a.id, b.id))) {
      for (const { id } of playlist.data.videos) push(links.playlistsByVideo, id, playlist);
    }
    return links;
  }));

/** A presenter's active videos, newest first. */
export const getPresenterVideos = async (presenterId: string) =>
  (await getReverseLinks()).videosByPresenter.get(presenterId) ?? [];

/** An organization's active videos, newest first. */
export const getOrganizationVideos = async (organizationId: string) =>
  (await getReverseLinks()).videosByOrganization.get(organizationId) ?? [];

/** The active playlists that list a video. */
export const getVideoPlaylists = async (videoId: string) =>
  (await getReverseLinks()).playlistsByVideo.get(videoId) ?? [];

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
  (b.data.publishDate ?? '').localeCompare(a.data.publishDate ?? '') || compareIds(b.id, a.id);

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
