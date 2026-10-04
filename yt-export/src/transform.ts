/**
 * Pure transform from raw YouTube API responses to rows shaped like types/db.ts.
 * No I/O here, so it can be unit tested and re-run from a saved raw.json.
 */
import { VideoSite, type DateString, type Episode, type Playlist, type PlaylistItem, type Timestamp } from "../../types/db.js";
import type { YtChannel, YtPlaylist, YtPlaylistItem, YtThumbnails, YtVideo } from "./youtube.js";

/** Everything fetched from the API; saved as <out>/raw.json. */
export interface RawExport {
  fetchedAt: string;
  channel: YtChannel;
  /** Channel playlists plus any extra --playlist ones. Does not include the uploads playlist. */
  playlists: YtPlaylist[];
  /** Playlist ID → its items (only for playlists in `playlists`). */
  playlistItems: Record<string, YtPlaylistItem[]>;
  /** Details of every video seen in any playlist or the uploads playlist. Private/deleted videos are absent. */
  videos: YtVideo[];
}

export interface ExportData {
  episodes: Episode[];
  playlists: Playlist[];
  playlist_items: PlaylistItem[];
}

/** ISO 8601 → Postgres `timestamp` text in UTC, as in backup/ ("2023-11-03 06:41:58", ms kept if non-zero). */
export function toPgTimestamp(value: string | Date): Timestamp {
  return new Date(value).toISOString().replace("T", " ").replace(/(\.000)?Z$/, "");
}

/** ISO 8601 → Postgres `date` text in UTC ("2021-10-23"). */
export function toPgDate(value: string | Date): DateString {
  return new Date(value).toISOString().slice(0, 10);
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "playlist";
}

/** Slugify each title, suffixing -2, -3, … on collisions (first occurrence keeps the bare slug). */
export function uniqueSlugs(titles: string[]): string[] {
  const used = new Set<string>();
  return titles.map((title) => {
    const base = slugify(title);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  });
}

const byPublishedThenId = (a: { id: string; snippet: { publishedAt: string } }, b: typeof a) =>
  a.snippet.publishedAt.localeCompare(b.snippet.publishedAt) || a.id.localeCompare(b.id);

const thumb = (t: YtThumbnails, ...sizes: (keyof YtThumbnails)[]) =>
  sizes.map((s) => t[s]?.url).find(Boolean) ?? null;

export function transform(raw: RawExport, now: Date): ExportData {
  const stamp = toPgTimestamp(now);

  // Episodes: every non-private video, oldest first, ids 1..n.
  const videos = raw.videos.filter((v) => v.status.privacyStatus !== "private").sort(byPublishedThenId);
  const episodeIdByVideo = new Map<string, number>();
  const episodes: Episode[] = videos.map((v, i) => {
    const id = i + 1;
    episodeIdByVideo.set(v.id, id);
    const viewCount = v.statistics?.viewCount;
    return {
      id,
      video_id: v.id,
      title: v.snippet.title,
      published_at: toPgTimestamp(v.snippet.publishedAt),
      description: v.snippet.description,
      image1: thumb(v.snippet.thumbnails, "default"),
      image2: thumb(v.snippet.thumbnails, "medium"),
      image3: thumb(v.snippet.thumbnails, "high"),
      created_at: stamp,
      updated_at: stamp,
      sort_order: null,
      active: v.status.privacyStatus === "public",
      video_site: VideoSite.YouTube,
      view_count: viewCount === undefined ? null : Number(viewCount),
    };
  });

  // Playlists: oldest first, ids 1..n.
  const ytPlaylists = [...raw.playlists].sort(byPublishedThenId);
  const slugs = uniqueSlugs(ytPlaylists.map((p) => p.snippet.title));
  const playlists: Playlist[] = ytPlaylists.map((p, i) => ({
    id: i + 1,
    playlist_id: p.id,
    name: p.snippet.title,
    description: p.snippet.description,
    publish_date: toPgDate(p.snippet.publishedAt),
    image: thumb(p.snippet.thumbnails, "high", "medium", "default"),
    active: (p.status?.privacyStatus ?? "public") === "public",
    created_at: stamp,
    updated_at: stamp,
    website: null,
    hashtag: null,
    playlist_category_id: null,
    slug: slugs[i],
  }));

  // Playlist items: in playlist order, then YouTube position. Items whose video isn't an
  // episode (private/deleted) are dropped; a video repeated in one playlist is kept once.
  const playlist_items: PlaylistItem[] = [];
  for (const playlist of playlists) {
    const items = [...(raw.playlistItems[playlist.playlist_id!] ?? [])].sort(
      (a, b) => a.snippet.position - b.snippet.position,
    );
    const seen = new Set<number>();
    for (const item of items) {
      const episodeId = episodeIdByVideo.get(item.contentDetails.videoId);
      if (episodeId === undefined || seen.has(episodeId)) continue;
      seen.add(episodeId);
      playlist_items.push({
        id: playlist_items.length + 1,
        playlist_id: playlist.id,
        episode_id: episodeId,
        sort_order: item.snippet.position,
        created_at: stamp,
        updated_at: stamp,
      });
    }
  }

  return { episodes, playlists, playlist_items };
}
