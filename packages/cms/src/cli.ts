#!/usr/bin/env node
/**
 * Command line editor for the Astro content collections (apps/website/content): create presenters and
 * organizations, edit their links, link videos to presenters, organizations and playlists (writing
 * both sides of each link), and add videos and playlists submitted through the GitHub issue forms.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PROFILE_LINK_TYPES, readEntries, VIDEO_LINKS, writeEntryFiles, type VideoLinkField } from "@esg/content";
import { Collection, type Organization, type Presenter, type ProfileLinkType } from "@esg/db-types/content";
import { YouTubeClient } from "@esg/yt-export/youtube";
import { Cms, CmsError, expandVideoRefs, PLAYLIST_CATEGORIES, titleOf, type Change } from "./cms.js";
import { applyPlaylistSubmission, assertNewPlaylist, assertPlaylistSize, itemVideoIds, parsePlaylistSubmission, playlistAddedReport, playlistPath, videosToFetch } from "./playlistSubmission.js";
import { addedReport, applySubmission, assertNewVideo, COMMUNITY_PLAYLIST, createVideoFromYouTube, groupOptionProblems, parseSubmission, rejectedReport, SubmissionError, withGroupOptions, youtubeVideoId } from "./submission.js";

const HELP = `
Usage: cms <command> [options]

Commands:
  presenter create --name <name> [options]
                        Create a presenter (ID and slug are assigned)
      --byline <text>   Job title or affiliation
      --x, --website, --linkedin, --instagram, --tiktok
                        Its links (see links below)
      --image <url>     Photo URL
      --email <email>   Not shown on the site
      --bio <text>      Biography (the Markdown body)
      --slug <slug>     Instead of one made from the name
      --inactive        Create it hidden from the site
      --allow-duplicate Create it even if a presenter has the same name
      --video <refs>    Also assign it to these videos (repeated, comma-separated or
                        an ID range, as for assign)

  organization create --name <name> [options]
                        Create an organization (ID and slug are assigned)
      --x, --website, --linkedin, --instagram, --tiktok
                        Its links (see links below)
      --logo <url>      Logo URL
      --contact <name>  Contact person, shown on its page
      --description <text>
                        Description (the Markdown body)
      --slug, --inactive, --allow-duplicate, --video
                        As for presenter create
      --form <file>     An issue form whose Group dropdown lists the active organizations; it
                        is updated with the new one. Repeatable. Default: the repo's
                        submit-video and submit-playlist forms when --content is also the
                        default, otherwise none

  playlist create --title <title> [options]
                        Create a playlist (ID and slug are assigned); videos are added with
                        --video or assign. Without --playlist-id the YouTube sync leaves it alone
      --category <name> ${PLAYLIST_CATEGORIES.join(", ")}
      --date <YYYY-MM-DD>
                        Event date; conferences are listed newest first by it
      --playlist-id <id>
                        The YouTube playlist ID
      --image <url>     Cover image URL
      --website <url>, --hashtag <tag>
      --description <text>
                        Description (the Markdown body)
      --slug, --inactive, --allow-duplicate, --video
                        As for presenter create

  playlist submission <issue-body-file>
                        Add the playlist a "Submit a playlist" issue names: fetch it and its
                        videos from YouTube (needs YOUTUBE_API_KEY), create the playlist with
                        its YouTube ID, reuse the videos already on the site and create the
                        new public ones, and report what was done
      --issue, --report As for submission
                        Rejections work as for submission; the step outputs are status,
                        title, playlist and videos (how many)

  video add <youtube-id-or-url> [options]
                        Add a YouTube video: its title, description, date and thumbnails are
                        fetched from the YouTube Data API (needs YOUTUBE_API_KEY). A public
                        video is shown; an unlisted one is added hidden (active: false)
      --presenter <ref>, --organization <ref>, --playlist <ref>
                        Also link it to these (repeatable)
      --inactive        Add it hidden from the site

  links <presenter|organization> <ref> [options]
                        Show an entry's links, or change them: a link option replaces the
                        link of its type where it is, or adds it at the end
      --x <h>           X handle (with or without @) or profile URL; --twitter also works
      --website <url>   A personal or group site
      --linkedin <url>  LinkedIn profile URL
      --instagram <h>   Instagram handle or profile URL
      --tiktok <h>      TikTok handle or profile URL
      --remove <type>   Remove the link of this type (${PROFILE_LINK_TYPES.join(", ")}); repeatable

  assign --video <refs> [--presenter <ref>] [--organization <ref>] [--playlist <ref>]
                        Link each video to each presenter, organization and playlist;
                        every option is repeatable
      --video <refs>    Video refs, repeated or comma-separated; an ID range like
                        4609-4618 means every ID in it
      --from-playlist <ref>
                        Every video of this playlist; repeatable, and can be combined
                        with --video
  unassign …            Same options; removes the links

  submission <issue-body-file>
                        Add the video a "Submit a video" issue names: fetch it from YouTube
                        (needs YOUTUBE_API_KEY), link it to its presenters (matched by name,
                        or created) and to the community playlist, and report what was done
      --issue <n>       The issue number, for the report ("Closes #n")
      --report <file>   Write the report (Markdown) here as well as printing it
      --playlist <ref>  Instead of ${COMMUNITY_PLAYLIST}
                        A submission that can't be added (bad link, already on the site,
                        not public) is reported and exits 0 with status "rejected"; in GitHub
                        Actions, status, title and video are also step outputs

  form sync             Rewrite the Group options of the submit-video and submit-playlist issue
                        forms to the active organizations (what organization create does for a
                        new one); takes --form as there

  find <video|presenter|organization|playlist> <text>
                        List entries whose ID, slug, title or YouTube ID contains the text
  check                 Report links to entries that don't exist, IDs that differ only in
                        case, leftover reverse link lists, and Group options in the issue forms
                        that are out of step with the organizations; exits 1 if there are any

A <ref> is an entry ID, a slug, a site URL or path (/video/<slug>), and for videos a YouTube
video ID or URL, for playlists a YouTube playlist ID.

Options:
      --content <dir>   Content directory (default: apps/website/content)
      --dry-run         Show what would change, write nothing
  -h, --help
`;

const DEFAULT_CONTENT = fileURLToPath(new URL("../../../apps/website/content", import.meta.url));
/** The issue forms with a Group dropdown of the organizations. */
const DEFAULT_FORMS = ["submit-video.yml", "submit-playlist.yml"].map((f) => fileURLToPath(new URL(`../../../.github/ISSUE_TEMPLATE/${f}`, import.meta.url)));
/** Most matches `find` lists. */
const FIND_LIMIT = 30;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    content: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    form: { type: "string", multiple: true, default: [] },
    help: { type: "boolean", short: "h", default: false },
    // presenter create
    name: { type: "string" },
    byline: { type: "string" },
    x: { type: "string" },
    twitter: { type: "string" },
    website: { type: "string" },
    linkedin: { type: "string" },
    instagram: { type: "string" },
    tiktok: { type: "string" },
    // links
    remove: { type: "string", multiple: true, default: [] },
    image: { type: "string" },
    email: { type: "string" },
    bio: { type: "string" },
    // organization create
    logo: { type: "string" },
    contact: { type: "string" },
    description: { type: "string" },
    slug: { type: "string" },
    inactive: { type: "boolean", default: false },
    "allow-duplicate": { type: "boolean", default: false },
    // assign / unassign
    video: { type: "string", multiple: true, default: [] },
    presenter: { type: "string", multiple: true, default: [] },
    organization: { type: "string", multiple: true, default: [] },
    playlist: { type: "string", multiple: true, default: [] },
    "from-playlist": { type: "string", multiple: true, default: [] },
    // playlist create
    title: { type: "string" },
    category: { type: "string" },
    date: { type: "string" },
    "playlist-id": { type: "string" },
    hashtag: { type: "string" },
    // submission
    issue: { type: "string" },
    report: { type: "string" },
  },
});

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// pnpm runs scripts in the package directory; resolve paths against where the command was typed.
const contentDir = args.content ? resolve(process.env.INIT_CWD ?? process.cwd(), args.content) : DEFAULT_CONTENT;

function load(): Cms {
  const cms = new Cms({
    video: readEntries(contentDir, "video"),
    organization: readEntries(contentDir, "organization"),
    presenter: readEntries(contentDir, "presenter"),
    playlist: readEntries(contentDir, "playlist"),
  });
  if (!cms.search("video", "").length) fail(`no content in ${contentDir}`);
  return cms;
}

function save(cms: Cms) {
  for (const w of cms.warnings) console.warn(`  ! ${w}`);
  const changes: Change[] = cms.changes();
  for (const c of changes) console.log(`  ${c.kind === "create" ? "+" : "~"} ${c.path}  ${c.title}`);
  if (!args["dry-run"]) writeEntryFiles(contentDir, changes);
  console.log(`${args["dry-run"] ? "Dry run: would write" : "Wrote"} ${changes.length} files → ${contentDir}`);
}

function presenterCreate(cms: Cms) {
  if (!args.name) fail("presenter create needs --name");
  const p = cms.createPresenter({
    name: args.name,
    byline: args.byline,
    links: linkArgs(),
    imageUrl: args.image,
    email: args.email,
    bio: args.bio,
    slug: args.slug,
    active: !args.inactive,
    allowDuplicate: args["allow-duplicate"],
  });
  for (const v of expandVideoRefs(args.video)) cms.link(v, "presenters", p.id);
  console.log(`Presenter ${p.id}: ${p.presenterName} → /presenter/${p.slug}`);
  save(cms);
}

function organizationCreate(cms: Cms) {
  if (!args.name) fail("organization create needs --name");
  const o = cms.createOrganization({
    name: args.name,
    links: linkArgs(),
    logoImage: args.logo,
    contactPerson: args.contact,
    description: args.description,
    slug: args.slug,
    active: !args.inactive,
    allowDuplicate: args["allow-duplicate"],
  });
  for (const v of expandVideoRefs(args.video)) cms.link(v, "organizations", o.id);
  console.log(`Organization ${o.id}: ${o.orgTitle} → /organization/${o.slug}`);
  save(cms);
  updateSubmissionForm(cms);
}

/** The submission forms to keep in step with the organizations: the --form files, else the repo's when --content is the default too. */
function formFiles(): string[] {
  return args.form.length ? args.form.map((f) => resolve(process.env.INIT_CWD ?? process.cwd(), f)) : args.content ? [] : DEFAULT_FORMS;
}

function formSync(cms: Cms) {
  if (!formFiles().length) fail("form sync needs --form <file> when --content is not the default");
  updateSubmissionForm(cms);
}

/** Rewrite the Group options of the submission forms to the active organizations, for the forms that are known. */
function updateSubmissionForm(cms: Cms) {
  for (const file of formFiles()) {
    const before = readFileSync(file, "utf8");
    const after = withGroupOptions(before, cms.organizationNames());
    if (after === before) continue;
    if (!args["dry-run"]) writeFileSync(file, after);
    console.log(`${args["dry-run"] ? "Dry run: would update" : "Updated"} the Group options in ${file}`);
  }
}

/** What the YouTube API returns for a video ID (undefined if it has nothing); fails without YOUTUBE_API_KEY. */
async function fetchYouTubeVideo(videoId: string, command: string) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) fail(`${command} needs YOUTUBE_API_KEY to fetch the video from YouTube`);
  const [video] = await new YouTubeClient(key).getVideos([videoId]);
  return video;
}

async function videoAdd(cms: Cms) {
  const input = positionals[2];
  if (!input) fail("video add needs a YouTube video ID or URL");
  const videoId = youtubeVideoId(input);
  if (!videoId) fail(`"${input}" is not a YouTube video ID or URL`);
  const dup = cms.search("video", videoId).find((v) => "videoId" in v && v.videoSite === "youtube" && v.videoId === videoId);
  if (dup) fail(`video ${dup.id} (${dup.slug}) is already YouTube video ${videoId}`);
  // Fail early on bad link targets, before calling YouTube.
  for (const [field, refs] of LINK_OPTIONS) for (const ref of refs) cms.find(VIDEO_LINKS[field], ref);
  const youtube = await fetchYouTubeVideo(videoId, "video add");
  if (!youtube) fail(`YouTube has no public or unlisted video ${videoId}; it may be private or deleted`);
  const hidden = args.inactive || youtube.status.privacyStatus !== "public";
  if (hidden && !args.inactive) console.warn(`  ! the video is ${youtube.status.privacyStatus} on YouTube, so it is added inactive`);
  const video = createVideoFromYouTube(cms, youtube, !hidden);
  for (const [field, refs] of LINK_OPTIONS) for (const ref of refs) cms.link(video.id, field, ref);
  console.log(`Video ${video.id}: ${video.videoTitle} → /video/${video.slug}`);
  save(cms);
}

function playlistCreate(cms: Cms) {
  if (!args.title) fail("playlist create needs --title");
  const p = cms.createPlaylist({
    title: args.title,
    category: args.category,
    playlistId: args["playlist-id"],
    publishDate: args.date,
    image: args.image,
    website: args.website,
    hashtag: args.hashtag,
    description: args.description,
    slug: args.slug,
    active: !args.inactive,
    allowDuplicate: args["allow-duplicate"],
  });
  for (const v of expandVideoRefs(args.video)) cms.link(v, "playlists", p.id);
  console.log(`Playlist ${p.id}: ${p.playlistTitle} → /${p.category?.startsWith("Conference") ? "conference" : "playlist"}/${p.slug}`);
  save(cms);
}

/** The link options given, by type. */
function linkArgs(): Partial<Record<ProfileLinkType, string>> {
  return { x: args.x ?? args.twitter, website: args.website, linkedin: args.linkedin, instagram: args.instagram, tiktok: args.tiktok };
}

function links(cms: Cms) {
  const [collection, ref] = positionals.slice(1);
  if (collection !== "presenter" && collection !== "organization") fail("links needs a collection: presenter or organization");
  if (!ref) fail(`links needs a ${collection} ID, slug or URL`);
  for (const type of args.remove) {
    if (!PROFILE_LINK_TYPES.includes(type as ProfileLinkType)) fail(`unknown link type "${type}"; use ${PROFILE_LINK_TYPES.join(", ")}`);
  }
  const edits = { set: linkArgs(), remove: args.remove as ProfileLinkType[] };
  const entry = cms.find(collection, ref) as Presenter | Organization;
  const editing = args.remove.length > 0 || Object.values(edits.set).some((v) => v?.trim());
  const shown = editing ? cms.editLinks(collection, ref, edits) : entry.links;
  console.log(`${collection} ${entry.id}: ${titleOf(entry)}`);
  for (const l of shown) console.log(`  ${l.type.padEnd(9)} ${l.url}`);
  if (!shown.length) console.log("  (no links)");
  if (editing) save(cms);
}

const LINK_OPTIONS: [VideoLinkField, string[]][] = [
  ["presenters", args.presenter],
  ["organizations", args.organization],
  ["playlists", args.playlist],
];

function assign(cms: Cms, remove: boolean) {
  const verb = remove ? "unassign" : "assign";
  const videos = [...new Set([...expandVideoRefs(args.video), ...args["from-playlist"].flatMap((p) => cms.playlistVideos(p))])];
  if (!videos.length) fail(`${verb} needs at least one --video or --from-playlist`);
  if (!LINK_OPTIONS.some(([, refs]) => refs.length)) fail(`${verb} needs a --presenter, --organization or --playlist`);
  for (const videoRef of videos) {
    for (const [field, refs] of LINK_OPTIONS) {
      for (const ref of refs) {
        const changed = remove ? cms.unlink(videoRef, field, ref) : cms.link(videoRef, field, ref);
        const video = cms.find("video", videoRef);
        const other = cms.find(VIDEO_LINKS[field], ref);
        const what = `video ${video.id} (${titleOf(video)}) ${remove ? "from" : "to"} ${field.slice(0, -1)} ${other.id} (${titleOf(other)})`;
        console.log(`${changed ? (remove ? "Unassigned" : "Assigned") : remove ? "Not assigned:" : "Already assigned:"} ${what}`);
      }
    }
  }
  save(cms);
}

function find(cms: Cms) {
  const [collection, ...words] = positionals.slice(1);
  if (!Object.values(Collection).includes(collection as Collection)) fail(`find needs a collection: ${Object.values(Collection).join(", ")}`);
  const text = words.join(" ");
  if (!text) fail("find needs some text to look for");
  const found = cms.search(collection as Collection, text);
  for (const d of found.slice(0, FIND_LIMIT)) {
    const extra = "videoId" in d ? `  ${d.publishedAt.slice(0, 10)}` : "";
    console.log(`${d.id.padStart(5)}  ${titleOf(d)}  [${d.slug}]${extra}${d.active ? "" : "  (inactive)"}`);
  }
  if (found.length > FIND_LIMIT) console.log(`… and ${found.length - FIND_LIMIT} more; narrow the search`);
  if (!found.length) console.log("No matches.");
}

function check(cms: Cms) {
  const problems = cms.problems();
  for (const form of formFiles()) problems.push(...groupOptionProblems(readFileSync(form, "utf8"), cms.organizationNames(), basename(form)));
  for (const p of problems) console.log(`  ! ${p}`);
  if (!problems.length) {
    console.log("No problems found.");
    return;
  }
  console.log(`${problems.length} problems`);
  process.exitCode = 1;
}

/** Set a step output when running in GitHub Actions; a random delimiter keeps any value to one output. */
function output(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `EOF_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/** The --issue number, if given. */
function issueArg(): number | undefined {
  const issue = args.issue ? Number(args.issue) : undefined;
  if (issue !== undefined && !Number.isInteger(issue)) fail(`--issue must be a number, not "${args.issue}"`);
  return issue;
}

/** Print the report, and write it to --report too. */
function report(text: string) {
  console.log(text);
  if (args.report) writeFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), args.report), text);
}

const readIssueBody = (file: string) => readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8");

async function submission(cms: Cms) {
  const [, file] = positionals;
  if (!file) fail("submission needs the file holding the issue body");
  const issue = issueArg();
  const playlist = args.playlist.at(-1) ?? COMMUNITY_PLAYLIST;
  cms.find("playlist", playlist); // fail early on a bad --playlist

  try {
    const sub = parseSubmission(readIssueBody(file));
    assertNewVideo(cms, sub.videoId);
    const video = await fetchYouTubeVideo(sub.videoId, "submission");
    const result = applySubmission(cms, sub, video, playlist);
    report(addedReport(result, sub, issue));
    save(cms);
    output("status", "added");
    output("title", result.video.videoTitle.replace(/\s+/g, " "));
    output("video", result.video.id);
  } catch (e) {
    if (!(e instanceof SubmissionError)) throw e;
    report(rejectedReport(e.message));
    output("status", "rejected");
  }
}

async function playlistSubmission(cms: Cms) {
  const file = positionals[2];
  if (!file) fail("playlist submission needs the file holding the issue body");
  const issue = issueArg();

  try {
    const sub = parsePlaylistSubmission(readIssueBody(file));
    assertNewPlaylist(cms, sub.playlistId);
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) fail("playlist submission needs YOUTUBE_API_KEY to fetch the playlist from YouTube");
    const client = new YouTubeClient(key);
    const [playlist] = await client.getPlaylists([sub.playlistId]);
    // Reject a huge playlist before paging through its items, and again (the count can be stale)
    // before looking up its videos.
    if (playlist?.contentDetails) assertPlaylistSize(playlist.contentDetails.itemCount);
    const items = playlist ? await client.getPlaylistItems(sub.playlistId) : [];
    assertPlaylistSize(itemVideoIds(items).length);
    const videos = items.length ? await client.getVideos(videosToFetch(cms, items)) : [];
    const result = applyPlaylistSubmission(cms, sub, { playlist, items, videos });
    report(playlistAddedReport(result, sub, issue));
    console.log(`Playlist ${result.playlist.id}: ${result.playlist.playlistTitle} → ${playlistPath(result.playlist)} (${client.quotaUsed} YouTube quota units)`);
    save(cms);
    output("status", "added");
    output("title", result.playlist.playlistTitle.replace(/\s+/g, " "));
    output("playlist", result.playlist.id);
    output("videos", String(result.videos.length));
  } catch (e) {
    if (!(e instanceof SubmissionError)) throw e;
    report(rejectedReport(e.message));
    output("status", "rejected");
  }
}

async function main() {
  const [command, sub] = positionals;
  if (args.help || !command) {
    console.log(HELP);
    return;
  }
  const cms = load();
  switch (command) {
    case "presenter":
      if (sub !== "create") fail(`unknown presenter command "${sub ?? ""}"; try presenter create`);
      return presenterCreate(cms);
    case "organization":
      if (sub !== "create") fail(`unknown organization command "${sub ?? ""}"; try organization create`);
      return organizationCreate(cms);
    case "playlist":
      if (sub === "submission") return playlistSubmission(cms);
      if (sub !== "create") fail(`unknown playlist command "${sub ?? ""}"; try playlist create or playlist submission`);
      return playlistCreate(cms);
    case "video":
      if (sub !== "add") fail(`unknown video command "${sub ?? ""}"; try video add`);
      return videoAdd(cms);
    case "form":
      if (sub !== "sync") fail(`unknown form command "${sub ?? ""}"; try form sync`);
      return formSync(cms);
    case "links":
      return links(cms);
    case "assign":
      return assign(cms, false);
    case "unassign":
      return assign(cms, true);
    case "find":
      return find(cms);
    case "check":
      return check(cms);
    case "submission":
      return submission(cms);
    default:
      fail(`unknown command "${command}"; see --help`);
  }
}

try {
  await main();
} catch (e) {
  if (e instanceof CmsError) fail(e.message);
  throw e;
}
