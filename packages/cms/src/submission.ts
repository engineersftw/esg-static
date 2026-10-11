/**
 * Community video submissions: a GitHub issue made from .github/ISSUE_TEMPLATE/submit-video.yml
 * becomes a new video entry, linked to its presenters (existing ones matched by name, the others
 * created) and to the community playlist, plus a Markdown report for the pull request.
 *
 * No I/O here: the CLI fetches the video from YouTube and writes the files. Everything that comes
 * from the issue or from YouTube is untrusted text, so the reports escape it.
 */
import { detectProfileLink } from "@esg/content";
import type { Playlist, Presenter, ProfileLink, Video } from "@esg/db-types/content";
import type { YtThumbnails, YtVideo } from "@esg/yt-export/youtube";
import { type Cms } from "./cms.js";

/** The issue form's field labels, which GitHub renders as `### <label>` headings in the issue body. */
export const FORM_FIELDS = {
  url: "YouTube URL",
  presenters: "Presenters",
  event: "Event or group",
  notes: "Anything else",
} as const;

/** The playlist every submission is added to, by slug. */
export const COMMUNITY_PLAYLIST = "community-contributed";
export const SITE_URL = "https://engineers.sg";
const MAX_PRESENTERS = 10;
const MAX_NAME_LENGTH = 100;

/** A submission that can't be added; the message is for the submitter. */
export class SubmissionError extends Error {}

export interface SubmittedPresenter {
  name: string;
  /** The link texts after the name, as written. */
  links: string[];
}

export interface Submission {
  videoId: string;
  presenters: SubmittedPresenter[];
  event: string | null;
  notes: string | null;
}

/** The fields of an issue made from an issue form: heading → value, with GitHub's "_No response_" as empty. */
export function parseIssueForm(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const section of body.replace(/\r\n?/g, "\n").split(/^### /m).slice(1)) {
    const newline = section.indexOf("\n");
    const label = (newline < 0 ? section : section.slice(0, newline)).trim();
    const value = newline < 0 ? "" : section.slice(newline + 1).trim();
    fields.set(label, value === "_No response_" ? "" : value);
  }
  return fields;
}

/**
 * The video ID in a YouTube URL (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, on
 * youtube.com, m.youtube.com or youtube-nocookie.com) or a bare 11-character ID. Null otherwise.
 */
export function youtubeVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    id = first === "watch" ? url.searchParams.get("v") : ["shorts", "live", "embed", "v"].includes(first ?? "") ? second : null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * One presenter per line: the name, then optionally its links, each after a "|"
 * ("Jane Doe | @janedoe | https://www.linkedin.com/in/janedoe"). List bullets are ignored.
 */
export function parsePresenters(text: string): SubmittedPresenter[] {
  const presenters: SubmittedPresenter[] = [];
  for (const line of text.split("\n")) {
    const [first = "", ...rest] = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").split("|");
    const name = first.trim().replace(/\s+/g, " ");
    const links = rest.flatMap((part) => part.trim().split(/\s+/)).filter(Boolean);
    if (!name && !links.length) continue;
    if (!name || name.startsWith("@") || /^https?:\/\//i.test(name) || name.includes("://")) {
      throw new SubmissionError(`Each presenter line should start with the presenter's name, then any links after a "|": "${line.trim()}"`);
    }
    if (name.length > MAX_NAME_LENGTH) throw new SubmissionError(`That presenter name is too long: "${name.slice(0, 40)}…"`);
    if (presenters.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    presenters.push({ name, links });
  }
  if (presenters.length > MAX_PRESENTERS) throw new SubmissionError(`Please list at most ${MAX_PRESENTERS} presenters.`);
  return presenters;
}

/** The submission in an issue body. Throws a SubmissionError the submitter can act on. */
export function parseSubmission(body: string): Submission {
  const fields = parseIssueForm(body);
  const url = fields.get(FORM_FIELDS.url) ?? "";
  if (!url) throw new SubmissionError(`The "${FORM_FIELDS.url}" field is empty.`);
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new SubmissionError(`"${url.slice(0, 200)}" isn't a link to a YouTube video.`);
  return {
    videoId,
    presenters: parsePresenters(fields.get(FORM_FIELDS.presenters) ?? ""),
    event: fields.get(FORM_FIELDS.event)?.slice(0, 200) || null,
    notes: fields.get(FORM_FIELDS.notes)?.slice(0, 2000) || null,
  };
}

export interface PresenterOutcome {
  name: string;
  presenter: Presenter;
  created: boolean;
  /** Other presenters with the same name, for the reviewer to check. */
  otherMatches: Presenter[];
  /** For a new presenter: the links it got. */
  links: ProfileLink[];
  /** Link texts that weren't recognized, or that weren't used because the presenter already exists. */
  unused: string[];
}

export interface SubmissionResult {
  video: Video;
  youtube: YtVideo;
  playlist: Playlist;
  presenters: PresenterOutcome[];
}

/** Throws if the content already has the YouTube video, so it isn't fetched for nothing. */
export function assertNewVideo(cms: Cms, videoId: string): void {
  const existing = cms.search("video", videoId).find((v) => "videoId" in v && v.videoSite === "youtube" && v.videoId === videoId) as Video | undefined;
  if (!existing) return;
  throw new SubmissionError(
    existing.active
      ? `This video is already on Engineers.SG: ${SITE_URL}/video/${existing.slug}`
      : "This video is already in Engineers.SG's records, but hidden from the site. A maintainer will take a look.",
  );
}

const url = (u: string | null | undefined) => u?.trim() || null;
const thumbnail = (t: YtThumbnails, size: keyof YtThumbnails) => url(t[size]?.url);

/** A new video entry made from what the YouTube API returned for it (what yt-export's sync writes). */
export function createVideoFromYouTube(cms: Cms, youtube: YtVideo, active = true): Video {
  const t = youtube.snippet.thumbnails;
  return cms.createVideo({
    videoId: youtube.id,
    title: youtube.snippet.title,
    publishedAt: youtube.snippet.publishedAt,
    thumbnails: { default: thumbnail(t, "default"), medium: thumbnail(t, "medium"), high: thumbnail(t, "high") },
    description: youtube.snippet.description,
    active,
  });
}

/**
 * Add the submitted video to the content: a new video entry, linked to each presenter (an existing
 * one with the same name, else a new one with the submitted links) and to `playlistRef`.
 * `youtube` is what the API returned for the video ID, or undefined if it returned nothing.
 */
export function applySubmission(cms: Cms, submission: Submission, youtube: YtVideo | undefined, playlistRef = COMMUNITY_PLAYLIST): SubmissionResult {
  assertNewVideo(cms, submission.videoId);
  if (!youtube) throw new SubmissionError("YouTube has no public video with that link. It may be private or deleted.");
  if (youtube.status.privacyStatus !== "public") {
    throw new SubmissionError(`The video is ${youtube.status.privacyStatus} on YouTube. Only public videos can be added.`);
  }

  const playlist = cms.find("playlist", playlistRef) as Playlist;
  const video = createVideoFromYouTube(cms, youtube);

  const presenters = submission.presenters.map(({ name, links }): PresenterOutcome => {
    const [match, ...otherMatches] = cms.presentersNamed(name);
    if (match) {
      cms.link(video.id, "presenters", match.id);
      return { name, presenter: match, created: false, otherMatches, links: [], unused: links };
    }
    const found: ProfileLink[] = [];
    const unused: string[] = [];
    for (const text of links) {
      const link = detectProfileLink(text);
      // One link per type, the first given.
      if (link && !found.some((l) => l.type === link.type)) found.push(link);
      else unused.push(text);
    }
    const presenter = cms.createPresenter({ name, links: Object.fromEntries(found.map((l) => [l.type, l.url])) });
    cms.link(video.id, "presenters", presenter.id);
    return { name, presenter, created: true, otherMatches: [], links: presenter.links, unused };
  });

  cms.link(video.id, "playlists", playlist.id);
  return { video, youtube, playlist, presenters };
}

/**
 * Untrusted text made safe for one line of GitHub Markdown: HTML is escaped, Markdown syntax is
 * shown as written, and "@" can't mention anyone.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]()#|~!{}]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "&#64;");
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");

const code = (text: string) => `\`${text.replace(/`/g, "")}\``;

/** The pull request description for an added video. */
export function addedReport(result: SubmissionResult, submission: Submission, issue?: number): string {
  const { video, youtube, playlist } = result;
  const lines = [
    issue ? `Adds the video submitted in #${issue}.` : "Adds a submitted video.",
    "",
    `**[${escapeMarkdown(video.videoTitle)}](https://www.youtube.com/watch?v=${video.videoId})**`,
    `Published ${video.publishedAt.slice(0, 10)}${youtube.snippet.channelTitle ? ` by the YouTube channel ${escapeMarkdown(youtube.snippet.channelTitle)}` : ""}.`,
    "",
    `- Video ${video.id}: ${code(`/video/${video.slug}`)}`,
    `- Added to the playlist ${escapeMarkdown(playlist.playlistTitle)} (${code(`/playlist/${playlist.slug}`)})`,
    "",
    "### Presenters",
    "",
  ];
  if (!result.presenters.length) lines.push("None given. Add them with `pnpm cms assign --video " + video.id + " --presenter <ref>`.");
  for (const p of result.presenters) {
    const page = code(`/presenter/${p.presenter.slug}`);
    const name = `**${escapeMarkdown(p.name)}**`;
    if (p.created) {
      const links = p.links.map((l) => `${l.type} ${code(l.url)}`).join(", ");
      lines.push(`- ${name}: new presenter ${p.presenter.id}, ${page}${links ? `, with links: ${links}` : ", no links"}`);
    } else {
      lines.push(`- ${name}: existing presenter ${p.presenter.id}, ${page}${p.presenter.active ? "" : " (**inactive**, so the site doesn't show it)"}`);
    }
    if (p.otherMatches.length) {
      lines.push(`  - Other presenters with this name: ${p.otherMatches.map((o) => `${o.id} ${code(`/presenter/${o.slug}`)}`).join(", ")}`);
    }
    if (p.unused.length) {
      const why = p.created ? "not recognized as profile links, or a second link of one type" : "not applied, since the presenter already exists";
      lines.push(`  - Links ${why}: ${p.unused.map(escapeMarkdown).join(", ")}`);
    }
  }
  if (submission.event || submission.notes) {
    lines.push("", "### From the submitter", "");
    if (submission.event) {
      lines.push(
        `Event or group: ${escapeMarkdown(submission.event)}. Not linked to an organization: use \`pnpm cms assign --video ${video.id} --organization <ref>\` if there is one.`,
      );
    }
    if (submission.event && submission.notes) lines.push("");
    if (submission.notes) lines.push(quote(submission.notes));
  }
  lines.push(
    "",
    "### Review",
    "",
    "- [ ] It's a tech talk that suits Engineers.SG",
    "- [ ] The presenters are the right people, and no new presenter is an existing one under another name",
    "- [ ] Link an organization or another playlist if the video belongs to one",
    "",
    "The title, description and thumbnails come from YouTube, and the daily YouTube sync keeps them up to date.",
  );
  if (issue) lines.push("", `Closes #${issue}`);
  return lines.join("\n") + "\n";
}

/** The issue comment for a submission that can't be added. */
export function rejectedReport(reason: string): string {
  return [
    "Thanks for the submission! Unfortunately it can't be added as it is:",
    "",
    `> ${escapeMarkdown(reason)}`,
    "",
    "Edit the issue to fix it and it will be checked again.",
  ].join("\n") + "\n";
}
