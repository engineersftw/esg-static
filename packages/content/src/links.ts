/**
 * Links between videos and the other collections. Each link is stored on both sides: a video's
 * `organizations` / `presenters` / `playlists` ID lists, and the `videos` list of each organization,
 * presenter and playlist. These helpers keep the two in step.
 *
 * Order rules, as pg-export writes them: a video's lists and a playlist's `videos` are in curated
 * order (new IDs go last); an organization's or presenter's `videos` are newest first.
 *
 * No I/O, and no array passed in is ever changed: the list helpers return new arrays.
 */
import type { Video } from "@esg/db-types/content";

/** The video fields that hold links, and the collection each one points at. */
export const VIDEO_LINKS = {
  organizations: "organization",
  presenters: "presenter",
  playlists: "playlist",
} as const;
export type VideoLinkField = keyof typeof VIDEO_LINKS;

/** An organization, presenter or playlist: anything with a `videos` list. */
export interface HasVideos {
  id: string;
  videos: string[];
}

/** `ids` with `id` at the end, or `ids` itself if it is already there. */
export function append(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** `ids` without `id`, or `ids` itself if it isn't there. */
export function without(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : ids;
}

/**
 * `ids` (video IDs, newest first) with `id` inserted before the first video published before it, or
 * `ids` itself if it is already there. Videos with no known date count as oldest. Existing order is kept.
 */
export function insertNewestFirst(ids: string[], id: string, publishedAt: (id: string) => string | undefined): string[] {
  if (ids.includes(id)) return ids;
  const date = publishedAt(id) ?? "";
  const i = ids.findIndex((x) => (publishedAt(x) ?? "") < date);
  return i < 0 ? [...ids, id] : [...ids.slice(0, i), id, ...ids.slice(i)];
}

/** How a video is added to the `videos` list of the collection behind `field`. */
export function addVideo(field: VideoLinkField, ids: string[], videoId: string, publishedAt: (id: string) => string | undefined) {
  return field === "playlists" ? append(ids, videoId) : insertNewestFirst(ids, videoId, publishedAt);
}

/**
 * Complete every one-sided link between `videos` and one other collection (`field` names which): a
 * video that lists an entry the entry doesn't list back is added to the entry's `videos`, and an entry
 * that lists a video the video doesn't list back is added to the video's `field`. IDs with no entry
 * are left as they are. Nothing is removed.
 *
 * Replaces the changed arrays on the objects in the maps (the arrays themselves are not mutated) and
 * returns the IDs of the objects it changed.
 */
export function reconcileLinks(
  field: VideoLinkField,
  videos: Map<string, Video>,
  others: Map<string, HasVideos>,
): { videos: Set<string>; others: Set<string> } {
  const changed = { videos: new Set<string>(), others: new Set<string>() };
  const publishedAt = (id: string) => videos.get(id)?.publishedAt;
  for (const v of videos.values()) {
    for (const otherId of v[field]) {
      const o = others.get(otherId);
      if (!o || o.videos.includes(v.id)) continue;
      o.videos = addVideo(field, o.videos, v.id, publishedAt);
      changed.others.add(o.id);
    }
  }
  for (const o of others.values()) {
    for (const videoId of o.videos) {
      const v = videos.get(videoId);
      if (!v || v[field].includes(o.id)) continue;
      v[field] = append(v[field], o.id);
      changed.videos.add(v.id);
    }
  }
  return changed;
}
