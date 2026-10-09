/**
 * Pure planner that syncs YouTube data into the Astro content collections (`video` and `playlist`).
 *
 * - A video or playlist that already has a file (matched by `videoId` / `playlistId`) gets its title,
 *   description (the Markdown body) and thumbnails refreshed. Everything else in the file is kept.
 * - One that has no file gets a new entry named after its YouTube ID (`yt-<id>`, see @esg/content's
 *   ids.ts) with a unique slug.
 * - Playlist membership is additive: a video YouTube lists in a playlist is appended to the
 *   playlist's `videos` if missing. Membership is stored on the playlist only. Nothing is ever
 *   removed, and nothing is deleted for content YouTube no longer returns (those are reported instead).
 *
 * No I/O here, so it can be unit tested and run from a saved raw.json.
 */
import type { Playlist as PlaylistEntry, Video as VideoEntry } from "@esg/db-types/content";
import { caseClashes, playlistEntryId as newPlaylistId, serializeEntry, slugAllocator, toBody, videoEntryId as newVideoId, type Entry } from "@esg/content";
import { thumb, type RawExport } from "./transform.js";
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

/** An existing entry YouTube was asked about and did not return: private or deleted there. */
export interface MissingEntry {
  /** Entry ID, the file name without `.md`. */
  entry: string;
  youtubeId: string;
  title: string;
  /** True if the site publishes it. */
  active: boolean;
}

export interface CollectionSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** Existing entries YouTube was asked about and did not return (private or deleted). */
  notOnYouTube: MissingEntry[];
  /** Existing entries YouTube was never asked about (not in the data), so their state is unknown. */
  notFetched: number;
  /** Missing entries set to `active: false` (`deactivateMissing`); also counted in neither updated nor unchanged. */
  deactivated: number;
  /** Titles of new entries not created because they would be empty (playlists with no available videos). */
  skipped: string[];
  /** YouTube IDs left out of the sync on request (`excludeVideos`) that matched a fetched video or an entry. */
  excluded: string[];
}

export interface SyncOptions {
  /** Set `active: false` on existing entries YouTube was asked about and did not return (private or deleted). */
  deactivateMissing?: boolean;
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

function summarize(): CollectionSummary {
  return { created: 0, updated: 0, unchanged: 0, notOnYouTube: [], notFetched: 0, deactivated: 0, skipped: [], excluded: [] };
}

export function planSync(raw: RawExport, existing: ExistingContent, opts: SyncOptions = {}): SyncPlan {
  const excluded = new Set(opts.excludeVideos);
  const videos = new Map<string, YtVideo>(
    raw.videos.filter((v) => v.status.privacyStatus !== "private" && !excluded.has(v.id)).map((v) => [v.id, v]),
  );
  const playlists = new Map<string, YtPlaylist>(raw.playlists.map((p) => [p.id, p]));

  // What YouTube was asked about. Older files don't record it: then a video counts as asked about if
  // it is in a fetched playlist (a private one shows up there as "Private video") and every playlist
  // in the data was returned.
  const requestedVideos = new Set(
    raw.requested?.videos ?? Object.values(raw.playlistItems).flatMap((items) => items.map((i) => i.contentDetails.videoId)),
  );
  for (const v of raw.videos) requestedVideos.add(v.id);
  const requestedPlaylists = new Set(raw.requested?.playlists ?? []);
  for (const p of raw.playlists) requestedPlaylists.add(p.id);

  const videoEntries = new Map(existing.videos.filter((e) => e.data.videoSite === "youtube").map((e) => [e.data.videoId, e]));
  const playlistEntries = new Map(existing.playlists.filter((e) => e.data.playlistId).map((e) => [e.data.playlistId!, e]));

  // Entry IDs: existing ones are kept; new ones are named after their YouTube IDs.
  const videoEntryId = new Map([...videoEntries].map(([yt, e]) => [yt, e.id]));
  const newVideos = [...videos.values()].filter((v) => !videoEntries.has(v.id)).sort(byPublished);
  for (const v of newVideos) videoEntryId.set(v.id, newVideoId("youtube", v.id));

  const playlistEntryId = new Map([...playlistEntries].map(([yt, e]) => [yt, e.id]));
  const hasVideos = (p: YtPlaylist) => (raw.playlistItems[p.id] ?? []).some((i) => videos.has(i.contentDetails.videoId));
  const unseenPlaylists = [...playlists.values()].filter((p) => !playlistEntries.has(p.id)).sort(byPublished);
  const newPlaylists = unseenPlaylists.filter(hasVideos);
  for (const p of newPlaylists) playlistEntryId.set(p.id, newPlaylistId(p.id));

  // YouTube IDs are case-sensitive, but on macOS and Windows two files whose names differ only in
  // case are the same file, so refuse to create one.
  for (const [collection, ids] of [
    ["video", [...existing.videos.map((e) => e.id), ...newVideos.map((v) => videoEntryId.get(v.id)!)]],
    ["playlist", [...existing.playlists.map((e) => e.id), ...newPlaylists.map((p) => playlistEntryId.get(p.id)!)]],
  ] as const) {
    const clashes = caseClashes(ids);
    if (clashes.length) throw new Error(`${collection} IDs that differ only in case: ${clashes.map((c) => c.join(" / ")).join(", ")}`);
  }

  // Membership as YouTube lists it, by entry ID. Items without an entry (private, deleted, not Vimeo) are skipped.
  const videosByPlaylist = new Map<string, string[]>();
  for (const p of raw.playlists) {
    const playlistId = playlistEntryId.get(p.id);
    if (playlistId === undefined) continue; // new but empty, so not created
    const items = [...(raw.playlistItems[p.id] ?? [])].sort((a, b) => a.snippet.position - b.snippet.position);
    for (const item of items) {
      const videoId = videoEntryId.get(item.contentDetails.videoId);
      if (videoId === undefined || !videos.has(item.contentDetails.videoId)) continue;
      videosByPlaylist.set(playlistId, appendMissing(videosByPlaylist.get(playlistId) ?? [], [videoId]));
    }
  }

  // Every entry's final state. `before` is the file it replaces (none for a new entry); `outcome` is
  // how it counts in the summary. Excluded videos get no draft, so nothing touches them.
  const videoDrafts: Draft<VideoEntry>[] = [];
  const playlistDrafts: Draft<PlaylistEntry>[] = [];
  const videoSummary = summarize();
  const playlistSummary = summarize();

  // --- Videos -----------------------------------------------------------------------------------
  for (const e of existing.videos) {
    if (e.data.videoSite === "youtube" && excluded.has(e.data.videoId)) continue;
    if (e.data.videoSite !== "youtube") {
      videoDrafts.push(keep(e));
      continue;
    }
    const v = videos.get(e.data.videoId);
    if (!v) {
      if (!requestedVideos.has(e.data.videoId)) {
        videoSummary.notFetched++;
        videoDrafts.push(keep(e));
        continue;
      }
      videoSummary.notOnYouTube.push({ entry: e.id, youtubeId: e.data.videoId, title: e.data.videoTitle, active: e.data.active });
      videoDrafts.push(opts.deactivateMissing && e.data.active ? deactivate(e) : keep(e));
      continue;
    }
    const t = v.snippet.thumbnails;
    videoDrafts.push({
      id: e.id,
      before: e,
      path: e.path,
      outcome: "refresh",
      data: {
        ...e.data,
        videoTitle: v.snippet.title,
        thumbnailDefault: thumb(t, "default") ?? e.data.thumbnailDefault,
        thumbnailMedium: thumb(t, "medium") ?? e.data.thumbnailMedium,
        thumbnailHigh: thumb(t, "high") ?? e.data.thumbnailHigh,
      },
      body: toBody(v.snippet.description),
    });
  }

  const videoSlug = slugAllocator(existing.videos.map((e) => e.data.slug));
  for (const v of newVideos) {
    const id = videoEntryId.get(v.id)!;
    const t = v.snippet.thumbnails;
    videoDrafts.push({
      id,
      path: `video/${id}.md`,
      outcome: "create",
      data: {
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
        active: v.status.privacyStatus === "public",
        videoSite: "youtube",
      },
      body: toBody(v.snippet.description),
    });
  }

  // --- Playlists --------------------------------------------------------------------------------
  for (const e of existing.playlists) {
    if (!e.data.playlistId) {
      playlistDrafts.push(keep(e));
      continue;
    }
    const p = playlists.get(e.data.playlistId);
    if (!p) {
      if (!requestedPlaylists.has(e.data.playlistId)) {
        playlistSummary.notFetched++;
        playlistDrafts.push(keep(e));
        continue;
      }
      playlistSummary.notOnYouTube.push({ entry: e.id, youtubeId: e.data.playlistId, title: e.data.playlistTitle, active: e.data.active });
      playlistDrafts.push(opts.deactivateMissing && e.data.active ? deactivate(e) : keep(e));
      continue;
    }
    playlistDrafts.push({
      id: e.id,
      before: e,
      path: e.path,
      outcome: "refresh",
      data: {
        ...e.data,
        playlistTitle: p.snippet.title,
        image: thumb(p.snippet.thumbnails, "high", "medium", "default") ?? e.data.image,
        videos: appendMissing(e.data.videos, videosByPlaylist.get(e.id)),
      },
      body: toBody(p.snippet.description),
    });
  }

  const playlistSlug = slugAllocator(existing.playlists.map((e) => e.data.slug));
  for (const p of newPlaylists) {
    const id = playlistEntryId.get(p.id)!;
    playlistDrafts.push({
      id,
      path: `playlist/${id}.md`,
      outcome: "create",
      data: {
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
      },
      body: toBody(p.snippet.description),
    });
  }

  const writes: SyncWrite[] = [];
  emit(writes, videoDrafts, videoSummary, (d) => d.videoTitle);
  emit(writes, playlistDrafts, playlistSummary, (d) => d.playlistTitle);

  videoSummary.excluded = [...excluded].filter((id) => videoEntries.has(id) || raw.videos.some((v) => v.id === id));
  playlistSummary.skipped = unseenPlaylists.filter((p) => !hasVideos(p)).map((p) => p.snippet.title);

  return { writes, videos: videoSummary, playlists: playlistSummary };
}

interface Draft<T extends object> {
  /** Entry ID, the file name without `.md`. */
  id: string;
  before?: Entry<T>;
  path: string;
  data: T;
  body: string;
  /** "refresh": matched on YouTube; "keep": not, left as it was. */
  outcome: "create" | "refresh" | "deactivate" | "keep";
}

/** A copy of the entry as it is. */
const keep = <T extends object>(e: Entry<T>): Draft<T> => ({ id: e.id, before: e, path: e.path, data: { ...e.data }, body: e.body, outcome: "keep" });

const deactivate = <T extends { active: boolean }>(e: Entry<T>): Draft<T> => ({ ...keep(e), data: { ...e.data, active: false }, outcome: "deactivate" });

/** Push a write for each draft that creates or changes a file, and count it in the summary. */
function emit<T extends object>(writes: SyncWrite[], drafts: Draft<T>[], summary: CollectionSummary, title: (data: T) => string) {
  for (const d of drafts) {
    const content = serializeEntry(d.data, d.body);
    if (!d.before) {
      summary.created++;
      writes.push({ kind: "create", path: d.path, content, title: title(d.data), changed: [] });
      continue;
    }
    const changed = content !== d.before.text;
    if (d.outcome === "refresh") summary[changed ? "updated" : "unchanged"]++;
    else if (d.outcome === "deactivate") summary.deactivated++;
    if (!changed) continue;
    writes.push({
      kind: "update",
      path: d.path,
      content,
      title: title(d.data),
      changed: changedFields(d.before.data, d.data, d.before.body, d.body),
    });
  }
}
