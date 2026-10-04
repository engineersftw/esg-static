/**
 * Pure planner that syncs YouTube data into the Astro content collections (`video` and `playlist`).
 *
 * - A video or playlist that already has a file (matched by `videoId` / `playlistId`) gets its title,
 *   description (the Markdown body) and thumbnails refreshed. Everything else in the file is kept.
 * - One that has no file gets a new entry with the next free ID and a unique slug.
 * - Playlist membership is additive: a video YouTube lists in a playlist is added to the playlist's
 *   `videos` and the video's `playlists` if missing. Nothing is ever removed, and nothing is deleted
 *   for content YouTube no longer returns (those are reported instead).
 *
 * No I/O here, so it can be unit tested and run from a saved raw.json.
 */
import type { Playlist as PlaylistEntry, Video as VideoEntry } from "@esg/db-types/content";
import { serializeEntry, toBody, type Entry } from "./content.js";
import { slugify, thumb, type RawExport } from "./transform.js";
import type { YtPlaylist, YtVideo } from "./youtube.js";

export interface ExistingContent {
  videos: Entry<VideoEntry>[];
  playlists: Entry<PlaylistEntry>[];
}

export interface SyncWrite {
  kind: "create" | "update";
  /** Relative to the content directory, e.g. "video/4442.md". */
  path: string;
  content: string;
  title: string;
  /** For updates: frontmatter fields (and "body") that differ from the existing file. */
  changed: string[];
}

export interface CollectionSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** YouTube IDs of existing entries YouTube didn't return (private, deleted or not fetched). */
  notOnYouTube: string[];
  /** Titles of new entries not created because they would be empty (playlists with no available videos). */
  skipped: string[];
  /** YouTube IDs left out of the sync on request (`excludeVideos`) that matched a fetched video or an entry. */
  excluded: string[];
}

export interface SyncOptions {
  /** YouTube video IDs to leave out: not created, not updated, not added to any playlist. */
  excludeVideos?: Iterable<string>;
}

export interface SyncPlan {
  writes: SyncWrite[];
  videos: CollectionSummary;
  playlists: CollectionSummary;
}

const byPublished = (a: { id: string; snippet: { publishedAt: string } }, b: typeof a) =>
  a.snippet.publishedAt.localeCompare(b.snippet.publishedAt) || a.id.localeCompare(b.id);

const maxId = (entries: Entry<object>[]) => entries.reduce((m, e) => Math.max(m, Number(e.id)), 0);

/** `current` plus any of `add` it lacks, in order. Returns `current` itself when nothing is added. */
function appendMissing(current: string[], add: string[] = []): string[] {
  const missing = add.filter((id) => !current.includes(id));
  return missing.length ? [...current, ...missing] : current;
}

/** Names of the fields whose values differ, plus "body". */
function changedFields(before: object, after: object, bodyBefore: string, bodyAfter: string): string[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const fields = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return bodyBefore === bodyAfter ? fields : [...fields, "body"];
}

/** Slugs unique within a collection: existing ones are reserved, collisions get -2, -3, … */
function slugAllocator(existing: string[]) {
  const used = new Set(existing);
  return (text: string, fallback: string) => {
    const base = slugify(text, fallback);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}

function summarize(): CollectionSummary {
  return { created: 0, updated: 0, unchanged: 0, notOnYouTube: [], skipped: [], excluded: [] };
}

export function planSync(raw: RawExport, existing: ExistingContent, opts: SyncOptions = {}): SyncPlan {
  const excluded = new Set(opts.excludeVideos);
  const videos = new Map<string, YtVideo>(
    raw.videos.filter((v) => v.status.privacyStatus !== "private" && !excluded.has(v.id)).map((v) => [v.id, v]),
  );
  const playlists = new Map<string, YtPlaylist>(raw.playlists.map((p) => [p.id, p]));

  const videoEntries = new Map(existing.videos.filter((e) => e.data.videoSite === "youtube").map((e) => [e.data.videoId, e]));
  const playlistEntries = new Map(existing.playlists.filter((e) => e.data.playlistId).map((e) => [e.data.playlistId!, e]));

  // Entry IDs: existing ones are kept; new ones continue after the highest, oldest first.
  const videoEntryId = new Map([...videoEntries].map(([yt, e]) => [yt, e.id]));
  let nextVideoId = maxId(existing.videos);
  const newVideos = [...videos.values()].filter((v) => !videoEntries.has(v.id)).sort(byPublished);
  for (const v of newVideos) videoEntryId.set(v.id, String(++nextVideoId));

  const playlistEntryId = new Map([...playlistEntries].map(([yt, e]) => [yt, e.id]));
  let nextPlaylistId = maxId(existing.playlists);
  const hasVideos = (p: YtPlaylist) => (raw.playlistItems[p.id] ?? []).some((i) => videos.has(i.contentDetails.videoId));
  const unseenPlaylists = [...playlists.values()].filter((p) => !playlistEntries.has(p.id)).sort(byPublished);
  const newPlaylists = unseenPlaylists.filter(hasVideos);
  for (const p of newPlaylists) playlistEntryId.set(p.id, String(++nextPlaylistId));

  // Membership as YouTube lists it, by entry ID. Items without an entry (private, deleted, not Vimeo) are skipped.
  const videosByPlaylist = new Map<string, string[]>();
  const playlistsByVideo = new Map<string, string[]>();
  for (const p of raw.playlists) {
    const playlistId = playlistEntryId.get(p.id);
    if (playlistId === undefined) continue; // new but empty, so not created
    const items = [...(raw.playlistItems[p.id] ?? [])].sort((a, b) => a.snippet.position - b.snippet.position);
    for (const item of items) {
      const videoId = videoEntryId.get(item.contentDetails.videoId);
      if (videoId === undefined || !videos.has(item.contentDetails.videoId)) continue;
      videosByPlaylist.set(playlistId, appendMissing(videosByPlaylist.get(playlistId) ?? [], [videoId]));
      playlistsByVideo.set(videoId, appendMissing(playlistsByVideo.get(videoId) ?? [], [playlistId]));
    }
  }

  const writes: SyncWrite[] = [];
  const videoSummary = summarize();
  const playlistSummary = summarize();

  // --- Videos -----------------------------------------------------------------------------------
  for (const e of existing.videos) {
    if (e.data.videoSite !== "youtube" || excluded.has(e.data.videoId)) continue;
    const v = videos.get(e.data.videoId);
    if (!v) {
      videoSummary.notOnYouTube.push(e.data.videoId);
      continue;
    }
    const t = v.snippet.thumbnails;
    const data: VideoEntry = {
      ...e.data,
      videoTitle: v.snippet.title,
      thumbnailDefault: thumb(t, "default") ?? e.data.thumbnailDefault,
      thumbnailMedium: thumb(t, "medium") ?? e.data.thumbnailMedium,
      thumbnailHigh: thumb(t, "high") ?? e.data.thumbnailHigh,
      playlists: appendMissing(e.data.playlists, playlistsByVideo.get(e.id)),
    };
    const body = toBody(v.snippet.description);
    const content = serializeEntry(data, body);
    if (content === e.text) {
      videoSummary.unchanged++;
      continue;
    }
    videoSummary.updated++;
    writes.push({
      kind: "update",
      path: e.path,
      content,
      title: data.videoTitle,
      changed: changedFields(e.data, data, e.body, body),
    });
  }

  const videoSlug = slugAllocator(existing.videos.map((e) => e.data.slug));
  for (const v of newVideos) {
    const id = videoEntryId.get(v.id)!;
    const t = v.snippet.thumbnails;
    const data: VideoEntry = {
      id,
      videoId: v.id,
      videoTitle: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      thumbnailDefault: thumb(t, "default"),
      thumbnailMedium: thumb(t, "medium"),
      thumbnailHigh: thumb(t, "high"),
      slug: videoSlug(v.snippet.title, `video-${id}`),
      organizations: [],
      presenters: [],
      playlists: [...(playlistsByVideo.get(id) ?? [])].sort((a, b) => Number(a) - Number(b)),
      active: v.status.privacyStatus === "public",
      videoSite: "youtube",
    };
    videoSummary.created++;
    writes.push({
      kind: "create",
      path: `video/${id}.md`,
      content: serializeEntry(data, toBody(v.snippet.description)),
      title: data.videoTitle,
      changed: [],
    });
  }

  // --- Playlists --------------------------------------------------------------------------------
  for (const e of existing.playlists) {
    if (!e.data.playlistId) continue;
    const p = playlists.get(e.data.playlistId);
    if (!p) {
      playlistSummary.notOnYouTube.push(e.data.playlistId);
      continue;
    }
    const data: PlaylistEntry = {
      ...e.data,
      playlistTitle: p.snippet.title,
      image: thumb(p.snippet.thumbnails, "high", "medium", "default") ?? e.data.image,
      videos: appendMissing(e.data.videos, videosByPlaylist.get(e.id)),
    };
    const body = toBody(p.snippet.description);
    const content = serializeEntry(data, body);
    if (content === e.text) {
      playlistSummary.unchanged++;
      continue;
    }
    playlistSummary.updated++;
    writes.push({
      kind: "update",
      path: e.path,
      content,
      title: data.playlistTitle,
      changed: changedFields(e.data, data, e.body, body),
    });
  }

  const playlistSlug = slugAllocator(existing.playlists.map((e) => e.data.slug));
  for (const p of newPlaylists) {
    const id = playlistEntryId.get(p.id)!;
    const data: PlaylistEntry = {
      id,
      playlistId: p.id,
      playlistTitle: p.snippet.title,
      // YouTube's creation date; the curated event date isn't known.
      publishDate: p.snippet.publishedAt.slice(0, 10),
      image: thumb(p.snippet.thumbnails, "high", "medium", "default"),
      website: null,
      hashtag: null,
      category: null,
      slug: playlistSlug(p.snippet.title, `playlist-${id}`),
      active: (p.status?.privacyStatus ?? "public") === "public",
      videos: videosByPlaylist.get(id) ?? [],
      subPlaylists: [],
    };
    playlistSummary.created++;
    writes.push({
      kind: "create",
      path: `playlist/${id}.md`,
      content: serializeEntry(data, toBody(p.snippet.description)),
      title: data.playlistTitle,
      changed: [],
    });
  }

  videoSummary.excluded = [...excluded].filter((id) => videoEntries.has(id) || raw.videos.some((v) => v.id === id));
  playlistSummary.skipped = unseenPlaylists.filter((p) => !hasVideos(p)).map((p) => p.snippet.title);

  return { writes, videos: videoSummary, playlists: playlistSummary };
}
