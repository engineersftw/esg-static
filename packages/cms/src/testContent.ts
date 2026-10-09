// Small content collections for the tests.
import { parseEntry, serializeEntry, type Entry } from "@esg/content";
import type { Organization, Playlist, Presenter, Video } from "@esg/db-types/content";
import type { Cms, ContentEntries } from "./cms.js";

export const entry = <T extends object>(path: string, data: T, body = "") => parseEntry<T>(path, serializeEntry(data, body));

export function video(id: string, publishedAt: string, over: Partial<Video> = {}): Entry<Video> {
  return entry(`video/${id}.md`, {
    id,
    videoId: `yt${id}`,
    videoTitle: `Video ${id}`,
    publishedAt,
    thumbnailDefault: null,
    thumbnailMedium: null,
    thumbnailHigh: null,
    slug: `video-${id}`,
    organizations: [],
    presenters: [],
    active: true,
    videoSite: "youtube",
    ...over,
  } satisfies Video);
}

export function presenter(id: string, name: string, over: Partial<Presenter> = {}): Entry<Presenter> {
  return entry(`presenter/${id}.md`, {
    id,
    presenterName: name,
    presenterByline: null,
    links: [],
    email: null,
    imageUrl: null,
    slug: name.toLowerCase().replace(/ /g, "-"),
    active: true,
    ...over,
  } satisfies Presenter);
}

export function organization(id: string, over: Partial<Organization> = {}): Entry<Organization> {
  return entry(`organization/${id}.md`, {
    id,
    orgTitle: `Org ${id}`,
    links: [],
    logoImage: null,
    contactPerson: null,
    slug: `org-${id}`,
    active: true,
    ...over,
  } satisfies Organization);
}

export function playlist(id: string, over: Partial<Playlist> = {}): Entry<Playlist> {
  return entry(`playlist/${id}.md`, {
    id,
    playlistId: `PL${id}`,
    playlistTitle: `Playlist ${id}`,
    publishDate: null,
    image: null,
    website: null,
    hashtag: null,
    category: "Meetup",
    slug: `playlist-${id}`,
    active: true,
    videos: [],
    subPlaylists: [],
    ...over,
  } satisfies Playlist);
}

export function content(over: Partial<ContentEntries> = {}): ContentEntries {
  return {
    video: [
      video("1", "2020-01-01T00:00:00Z", { organizations: ["5"], presenters: ["9"] }),
      video("2", "2021-01-01T00:00:00Z"),
      video("3", "2022-01-01T00:00:00Z", { organizations: ["5"], presenters: ["9"] }),
    ],
    organization: [organization("5")],
    presenter: [presenter("7", "Jane Doe"), presenter("9", "Ann Lee")],
    playlist: [playlist("4", { videos: ["1", "3"] })],
    ...over,
  };
}

/** Stand-in random IDs for new entries: "new1", "new2", … */
export function counterIds() {
  let n = 0;
  return () => `new${++n}`;
}

export const data = (cms: Cms, path: string) => {
  const c = cms.changes().find((x) => x.path === path);
  if (!c) throw new Error(`no change to ${path}`);
  return parseEntry<Record<string, unknown>>(path, c.content);
};
