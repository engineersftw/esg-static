/**
 * Frontmatter of the Astro content collections (`video`, `organization`, `presenter`, `playlist`) that
 * pg-export writes as Markdown, one file per entry at `<collection>/<id>.md`.
 *
 * Field names follow apps/website/src/content.config.ts (`playlist` follows the same style). The entry
 * ID is the file name: the database ID as a string for entries from the Rails site, and for newer
 * ones `yt-<YouTube ID>` (videos, and playlists with a YouTube playlist) or a random ID (see
 * @esg/content's ids.ts). Relations are lists of entry IDs, so they work with Astro's `reference()`.
 * Each link is stored on one side only: a video lists its organizations and presenters, a playlist
 * lists its videos and sub-playlists. The other direction is worked out by whoever needs it.
 * Each entry's description is the Markdown body, not a frontmatter field.
 *
 * Astro's glob loader uses a frontmatter `slug` as the entry ID by default, so load these with
 * `glob({ pattern: "*.md", base, generateId: ({ entry }) => entry.replace(/\.md$/, "") })`,
 * otherwise every reference to an ID fails.
 */

/** Collection names, also the directory names under the export root. */
export const Collection = {
  Video: "video",
  Organization: "organization",
  Presenter: "presenter",
  Playlist: "playlist",
} as const;
export type Collection = (typeof Collection)[keyof typeof Collection];

/** ISO 8601 timestamp in UTC, e.g. "2023-11-03T06:41:58Z". */
export type IsoTimestamp = string;
/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

/** `video/<id>.md`; the body is the episode description. */
export interface Video {
  /** The file name and the collection entry ID (see the header for its forms). */
  id: string;
  /** External ID on the video site (YouTube video ID or numeric Vimeo ID). */
  videoId: string;
  videoTitle: string;
  publishedAt: IsoTimestamp;
  thumbnailDefault: string | null;
  thumbnailMedium: string | null;
  thumbnailHigh: string | null;
  slug: string;
  /** Organization entry IDs. */
  organizations: string[];
  /** Presenter entry IDs. */
  presenters: string[];
  /** False for videos hidden on the old site (unlisted). */
  active: boolean;
  videoSite: "youtube" | "vimeo";
}

/** The kinds of profile link a presenter or organization can have. */
export type ProfileLinkType = "x" | "website" | "linkedin" | "instagram" | "tiktok";

/**
 * A presenter's or organization's link. `url` is always a full URL (an X handle is stored as
 * `https://x.com/<handle>`), so the site only has to label it.
 */
export interface ProfileLink {
  type: ProfileLinkType;
  url: string;
}

/** `organization/<id>.md`; the body is the organization description. */
export interface Organization {
  id: string;
  orgTitle: string;
  /** In display order. */
  links: ProfileLink[];
  logoImage: string | null;
  contactPerson: string | null;
  slug: string;
  /** False for organizations hidden on the old site; the site leaves them out. */
  active: boolean;
}

/** `presenter/<id>.md`; the body is the presenter biography. */
export interface Presenter {
  id: string;
  presenterName: string;
  presenterByline: string | null;
  /** In display order. A `website` link is a personal site; LinkedIn profiles are `linkedin` links. */
  links: ProfileLink[];
  /** Null unless pg-export ran with --include-emails. */
  email: string | null;
  imageUrl: string | null;
  slug: string;
  /** False for presenters hidden on the old site; the site leaves them out. */
  active: boolean;
}

/** `playlist/<id>.md`; the body is the playlist description. */
export interface Playlist {
  id: string;
  /** External playlist ID on the video site (YouTube playlist ID). */
  playlistId: string | null;
  playlistTitle: string;
  publishDate: IsoDate | null;
  image: string | null;
  website: string | null;
  hashtag: string | null;
  /** Category title: "Conference", "Meetup", "Tutorial", "Training", "Shows" or "Conference Track". */
  category: string | null;
  slug: string;
  /** False for playlists hidden on the old site; the site leaves them out. */
  active: boolean;
  /** Video entry IDs, in playlist order. */
  videos: string[];
  /** Nested playlist entry IDs, in sequence order. */
  subPlaylists: string[];
}
