/**
 * Links between videos and the other collections. Each link is stored on one side only:
 *
 * - a video's `organizations` and `presenters` (in display order);
 * - a playlist's `videos` (in playlist order) and `subPlaylists`.
 *
 * The other direction (an organization's or presenter's videos, a video's playlists) is worked out
 * by whoever needs it, so adding a talk never edits the files of the people in it.
 *
 * No I/O, and no array passed in is ever changed: the list helpers return new arrays.
 */

/** The kinds of link a video has, and the collection each one points at. */
export const VIDEO_LINKS = {
  organizations: "organization",
  presenters: "presenter",
  playlists: "playlist",
} as const;
export type VideoLinkField = keyof typeof VIDEO_LINKS;

/** `ids` with `id` at the end, or `ids` itself if it is already there. */
export function append(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** `ids` without `id`, or `ids` itself if it isn't there. */
export function without(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : ids;
}
