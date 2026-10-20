/**
 * Community playlist submissions: a GitHub issue made from .github/ISSUE_TEMPLATE/submit-playlist.yml
 * becomes a new playlist entry with the YouTube playlist ID, holding its videos in YouTube's order
 * (existing entries reused, new public ones created), plus a Markdown report for the pull request.
 *
 * No I/O here: the CLI fetches the playlist and its videos from YouTube and writes the files.
 * Everything that comes from the issue or from YouTube is untrusted text, so the reports escape it.
 */
import { normalizeProfileLink } from "@esg/content";
import type { Organization, Playlist, Video } from "@esg/db-types/content";
import type { YtPlaylist, YtPlaylistItem, YtVideo } from "@esg/yt-export/youtube";
import { nameKey, PLAYLIST_CATEGORIES, type Cms } from "./cms.js";
import { createVideoFromYouTube, escapeMarkdown, parseIssueForm, SITE_URL, SubmissionError } from "./submission.js";

/** The issue form's field labels, which GitHub renders as `### <label>` headings in the issue body. */
export const PLAYLIST_FORM_FIELDS = {
  url: "YouTube playlist URL",
  category: "Category",
  group: "Group",
  others: "Others (not in list)",
  date: "Event date",
  website: "Website",
  notes: "Anything else",
} as const;

/** Most videos a submitted playlist may have; a bigger one is left to a maintainer. */
export const MAX_PLAYLIST_VIDEOS = 300;
/** Most videos the report lists one by one. */
const REPORT_VIDEOS = 50;

export interface PlaylistSubmission {
  playlistId: string;
  /** One of `PLAYLIST_CATEGORIES`, or null. */
  category: string | null;
  /** The Group dropdown's value: the name of an organization. */
  group: string | null;
  /** The "Others (not in list)" text: a group that isn't in the dropdown, or anything else about it. */
  others: string | null;
  /** YYYY-MM-DD. */
  date: string | null;
  /** A full http(s) URL. */
  website: string | null;
  notes: string | null;
}

/**
 * The playlist ID in a YouTube URL (any link with `list=`, such as `/playlist?list=` or a video
 * watched in a playlist) or a bare playlist ID. Null otherwise, and for YouTube's generated mixes
 * (`RD…`), which aren't real playlists.
 */
export function youtubePlaylistId(input: string): string | null {
  const text = input.trim();
  let id: string | null;
  if (/^[\w-]+$/.test(text)) id = text;
  else {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return null;
    id = url.searchParams.get("list");
  }
  return id && /^(PL|OL|UU|FL)[\w-]{10,62}$/.test(id) ? id : null;
}

/** The submission in an issue body. Throws a SubmissionError the submitter can act on. */
export function parsePlaylistSubmission(body: string): PlaylistSubmission {
  const fields = parseIssueForm(body);
  const url = fields.get(PLAYLIST_FORM_FIELDS.url) ?? "";
  if (!url) throw new SubmissionError(`The "${PLAYLIST_FORM_FIELDS.url}" field is empty.`);
  const playlistId = youtubePlaylistId(url);
  if (!playlistId) throw new SubmissionError(`"${url.slice(0, 200)}" isn't a link to a YouTube playlist. It should have "list=" in it.`);

  // Anything not in the dropdown (it can be edited by hand) counts as no category.
  const rawCategory = fields.get(PLAYLIST_FORM_FIELDS.category)?.trim() ?? "";
  const category = PLAYLIST_CATEGORIES.find((c) => c.toLowerCase() === rawCategory.toLowerCase()) ?? null;

  const date = fields.get(PLAYLIST_FORM_FIELDS.date)?.trim() || null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
    throw new SubmissionError(`The event date "${date.slice(0, 40)}" should be written as YYYY-MM-DD, like 2024-06-01.`);
  }

  const rawWebsite = fields.get(PLAYLIST_FORM_FIELDS.website)?.trim() || null;
  const website = rawWebsite && normalizeProfileLink("website", rawWebsite);
  if (rawWebsite && !website) throw new SubmissionError(`"${rawWebsite.slice(0, 200)}" isn't a web address.`);

  return {
    playlistId,
    category,
    group: fields.get(PLAYLIST_FORM_FIELDS.group)?.replace(/\s+/g, " ").trim().slice(0, 200) || null,
    others: fields.get(PLAYLIST_FORM_FIELDS.others)?.slice(0, 2000) || null,
    date,
    website: website || null,
    notes: fields.get(PLAYLIST_FORM_FIELDS.notes)?.slice(0, 2000) || null,
  };
}

/** What the YouTube API returned: the playlist (undefined if nothing), its items, and the videos looked up. */
export interface YouTubePlaylistData {
  playlist: YtPlaylist | undefined;
  items: YtPlaylistItem[];
  /** The videos of the items that aren't in the content yet; private and deleted ones are absent. */
  videos: YtVideo[];
}

export interface PlaylistVideoOutcome {
  video: Video;
  created: boolean;
}

export interface PlaylistSubmissionResult {
  playlist: Playlist;
  youtube: YtPlaylist;
  /** The playlist's videos, in its order. */
  videos: PlaylistVideoOutcome[];
  /** Items left out: not public on YouTube (private, deleted or unlisted). */
  skipped: { videoId: string; title: string; reason: string }[];
  /** The active organization named by the submission's group, now linked to the new videos. */
  organization: Organization | null;
  /** Other playlists with the same title, for the reviewer to check. */
  sameTitle: Playlist[];
}

/** Throws if the content already has the YouTube playlist, so it isn't fetched for nothing. */
export function assertNewPlaylist(cms: Cms, playlistId: string): void {
  const existing = cms.search("playlist", playlistId).find((p) => "playlistId" in p && p.playlistId === playlistId) as Playlist | undefined;
  if (!existing) return;
  const path = existing.category?.startsWith("Conference") ? "conference" : "playlist";
  throw new SubmissionError(
    existing.active
      ? `This playlist is already on Engineers.SG: ${SITE_URL}/${path}/${existing.slug}`
      : "This playlist is already in Engineers.SG's records, but hidden from the site. A maintainer will take a look.",
  );
}

/**
 * Throws if a playlist with `count` videos is too big to add. The CLI calls it with YouTube's item
 * count before fetching the items, and with the number of distinct videos before looking them up, so
 * a huge playlist doesn't use up the YouTube quota only to be rejected.
 */
export function assertPlaylistSize(count: number): void {
  if (count > MAX_PLAYLIST_VIDEOS) {
    throw new SubmissionError(`The playlist has ${count} videos, more than the ${MAX_PLAYLIST_VIDEOS} a submission can add. A maintainer will take a look.`);
  }
}

/** The distinct YouTube video IDs of a playlist's items, in their order. */
export const itemVideoIds = (items: YtPlaylistItem[]): string[] => [...new Set(items.map((i) => i.contentDetails.videoId))];

/** The YouTube video IDs of the playlist's items that the content doesn't have yet: the ones to look up. */
export function videosToFetch(cms: Cms, items: YtPlaylistItem[]): string[] {
  return itemVideoIds(items).filter((id) => !findYouTubeVideo(cms, id));
}

function findYouTubeVideo(cms: Cms, videoId: string): Video | undefined {
  return cms.search("video", videoId).find((v) => "videoId" in v && v.videoSite === "youtube" && v.videoId === videoId) as Video | undefined;
}

const thumb = (p: YtPlaylist) => {
  const t = p.snippet.thumbnails;
  return (t.high ?? t.medium ?? t.default)?.url?.trim() || null;
};

/**
 * Add the submitted playlist to the content: a new playlist with the YouTube playlist ID (so the
 * daily sync keeps it up to date), its videos in YouTube's order (existing entries reused, new public
 * ones created), and the new videos linked to the organization the submission names, if it exists.
 */
export function applyPlaylistSubmission(cms: Cms, submission: PlaylistSubmission, youtube: YouTubePlaylistData): PlaylistSubmissionResult {
  assertNewPlaylist(cms, submission.playlistId);
  const yt = youtube.playlist;
  if (!yt) throw new SubmissionError("YouTube has no public playlist with that link. It may be private or deleted.");
  const privacy = yt.status?.privacyStatus ?? "public";
  if (privacy !== "public") throw new SubmissionError(`The playlist is ${privacy} on YouTube. Only public playlists can be added.`);

  const items = [...youtube.items].sort((a, b) => a.snippet.position - b.snippet.position);
  const ids = itemVideoIds(items);
  assertPlaylistSize(ids.length);

  const fetched = new Map(youtube.videos.map((v) => [v.id, v]));
  const planned: { videoId: string; existing?: Video; youtube?: YtVideo }[] = [];
  const skipped: PlaylistSubmissionResult["skipped"] = [];
  for (const videoId of ids) {
    const existing = findYouTubeVideo(cms, videoId);
    if (existing) {
      planned.push({ videoId, existing });
      continue;
    }
    const v = fetched.get(videoId);
    const title = v?.snippet.title ?? items.find((i) => i.contentDetails.videoId === videoId)?.snippet.title ?? videoId;
    if (!v) skipped.push({ videoId, title, reason: "private or deleted" });
    else if (v.status.privacyStatus !== "public") skipped.push({ videoId, title, reason: v.status.privacyStatus });
    else planned.push({ videoId, youtube: v });
  }
  if (!planned.length) throw new SubmissionError("The playlist has no public videos to add.");

  const key = nameKey(yt.snippet.title);
  const sameTitle = cms.search("playlist", "").filter((p) => "playlistTitle" in p && nameKey(p.playlistTitle) === key) as Playlist[];
  const playlist = cms.createPlaylist({
    title: yt.snippet.title,
    category: submission.category,
    playlistId: submission.playlistId,
    publishDate: submission.date ?? yt.snippet.publishedAt.slice(0, 10),
    image: thumb(yt),
    website: submission.website,
    description: yt.snippet.description,
    allowDuplicate: true,
  });

  const organization = (submission.group && cms.organizationsNamed(submission.group).find((o) => o.active)) || null;
  const videos = planned.map(({ existing, youtube: v }): PlaylistVideoOutcome => {
    const video = existing ?? createVideoFromYouTube(cms, v!);
    // Existing videos keep the organizations they have; only the new ones get the submitted group.
    if (!existing && organization) cms.link(video.id, "organizations", organization.id);
    cms.link(video.id, "playlists", playlist.id);
    return { video, created: !existing };
  });

  return { playlist, youtube: yt, videos, skipped, organization, sameTitle };
}

const code = (text: string) => `\`${text.replace(/`/g, "")}\``;
const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");

/** Where the site shows a playlist: conferences and their tracks under /conference. */
export const playlistPath = (p: Playlist) => `/${p.category?.startsWith("Conference") ? "conference" : "playlist"}/${p.slug}`;

/** The pull request description for an added playlist. */
export function playlistAddedReport(result: PlaylistSubmissionResult, submission: PlaylistSubmission, issue?: number): string {
  const { playlist, youtube, videos, skipped } = result;
  const created = videos.filter((v) => v.created);
  const lines = [
    issue ? `Adds the playlist submitted in #${issue}.` : "Adds a submitted playlist.",
    "",
    `**[${escapeMarkdown(playlist.playlistTitle)}](https://www.youtube.com/playlist?list=${playlist.playlistId})**`,
    `Created ${youtube.snippet.publishedAt.slice(0, 10)}${youtube.snippet.channelTitle ? ` by the YouTube channel ${escapeMarkdown(youtube.snippet.channelTitle)}` : ""}.`,
    "",
    `- Playlist ${playlist.id}: ${code(playlistPath(playlist))}`,
    `- Category: ${playlist.category ?? "none"}; date: ${playlist.publishDate ?? "none"}${submission.date ? "" : " (YouTube's creation date)"}${playlist.website ? `; website: ${code(playlist.website)}` : ""}`,
    `- ${videos.length} videos: ${created.length} new, ${videos.length - created.length} already on the site${skipped.length ? `; ${skipped.length} left out` : ""}`,
  ];
  if (result.sameTitle.length) {
    lines.push(`- Other playlists with this title: ${result.sameTitle.map((p) => `${p.id} ${code(playlistPath(p))}`).join(", ")}`);
  }

  lines.push("", "### Videos", "");
  for (const { video, created: isNew } of videos.slice(0, REPORT_VIDEOS)) {
    lines.push(`- ${isNew ? "new" : "existing"} ${video.id}: ${escapeMarkdown(video.videoTitle)}`);
  }
  if (videos.length > REPORT_VIDEOS) lines.push(`- … and ${videos.length - REPORT_VIDEOS} more`);
  if (skipped.length) {
    lines.push("", "Left out, as they aren't public on YouTube:", "");
    for (const s of skipped.slice(0, REPORT_VIDEOS)) lines.push(`- ${code(s.videoId)} (${s.reason}): ${escapeMarkdown(s.title)}`);
    if (skipped.length > REPORT_VIDEOS) lines.push(`- … and ${skipped.length - REPORT_VIDEOS} more`);
  }

  if (submission.group || submission.others || submission.notes) {
    lines.push("", "### From the submitter", "");
    const parts: string[] = [];
    if (submission.group && result.organization) {
      parts.push(`Group: ${escapeMarkdown(submission.group)}. Linked the new videos to organization ${result.organization.id}, ${code(`/organization/${result.organization.slug}`)}.`);
    } else if (submission.group) {
      parts.push(
        `Group: ${escapeMarkdown(submission.group)}. Not linked to an organization: use \`pnpm cms assign --from-playlist ${playlist.id} --organization <ref>\` if there is one.`,
      );
    }
    if (submission.others) parts.push(`Others (not in list):\n${quote(submission.others)}`);
    if (submission.notes) parts.push(`Anything else:\n${quote(submission.notes)}`);
    lines.push(parts.join("\n\n"));
  }

  lines.push(
    "",
    "### Review",
    "",
    "- [ ] The talks suit Engineers.SG",
    "- [ ] The category and date are right (conferences are listed newest first by the date)",
    `- [ ] Assign presenters, e.g. \`pnpm cms assign --video <id> --presenter <ref>\`, and an organization if it isn't linked`,
    "",
    "The title, description and image come from YouTube. The daily YouTube sync keeps them up to date and adds videos added to the playlist later.",
  );
  if (issue) lines.push("", `Closes #${issue}`);
  return lines.join("\n") + "\n";
}
