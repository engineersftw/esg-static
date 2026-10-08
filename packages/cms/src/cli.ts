#!/usr/bin/env node
/**
 * Command line editor for the Astro content collections (apps/website/content): create presenters and
 * organizations, edit their links, link videos to presenters, organizations and playlists (writing
 * both sides of each link), and add videos submitted through the GitHub issue form.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PROFILE_LINK_TYPES, readEntries, VIDEO_LINKS, writeEntryFiles, type VideoLinkField } from "@esg/content";
import { Collection, type Organization, type Presenter, type ProfileLinkType } from "@esg/db-types/content";
import { YouTubeClient } from "@esg/yt-export/youtube";
import { Cms, CmsError, PLAYLIST_CATEGORIES, titleOf, type Change } from "./cms.js";
import { addedReport, applySubmission, assertNewVideo, COMMUNITY_PLAYLIST, parseSubmission, rejectedReport, SubmissionError } from "./submission.js";

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
      --video <ref>     Also assign it to this video; repeatable

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

  links <presenter|organization> <ref> [options]
                        Show an entry's links, or change them: a link option replaces the
                        link of its type where it is, or adds it at the end
      --x <h>           X handle (with or without @) or profile URL; --twitter also works
      --website <url>   A personal or group site
      --linkedin <url>  LinkedIn profile URL
      --instagram <h>   Instagram handle or profile URL
      --tiktok <h>      TikTok handle or profile URL
      --remove <type>   Remove the link of this type (${PROFILE_LINK_TYPES.join(", ")}); repeatable

  assign --video <ref> [--presenter <ref>] [--organization <ref>] [--playlist <ref>]
                        Link each video to each presenter, organization and playlist;
                        every option is repeatable
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

  find <video|presenter|organization|playlist> <text>
                        List entries whose ID, slug, title or YouTube ID contains the text
  check [--fix]         Report links stored on one side only; --fix completes them

A <ref> is an entry ID, a slug, a site URL or path (/video/<slug>), and for videos a YouTube
video ID or URL, for playlists a YouTube playlist ID.

Options:
      --content <dir>   Content directory (default: apps/website/content)
      --dry-run         Show what would change, write nothing
  -h, --help
`;

const DEFAULT_CONTENT = fileURLToPath(new URL("../../../apps/website/content", import.meta.url));
/** Most matches `find` lists. */
const FIND_LIMIT = 30;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    content: { type: "string" },
    "dry-run": { type: "boolean", default: false },
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
    // playlist create
    title: { type: "string" },
    category: { type: "string" },
    date: { type: "string" },
    "playlist-id": { type: "string" },
    hashtag: { type: "string" },
    // check
    fix: { type: "boolean", default: false },
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
  for (const v of args.video) cms.link(v, "presenters", p.id);
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
  for (const v of args.video) cms.link(v, "organizations", o.id);
  console.log(`Organization ${o.id}: ${o.orgTitle} → /organization/${o.slug}`);
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
  for (const v of args.video) cms.link(v, "playlists", p.id);
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
  if (!args.video.length) fail(`${verb} needs at least one --video`);
  if (!LINK_OPTIONS.some(([, refs]) => refs.length)) fail(`${verb} needs a --presenter, --organization or --playlist`);
  for (const videoRef of args.video) {
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
  const counts = cms.reconcile();
  for (const [field, n] of Object.entries(counts)) console.log(`${field}: ${n ? `${n} entries with one-sided links` : "all links two-way"}`);
  if (!Object.values(counts).some(Boolean)) return;
  if (args.fix) save(cms);
  else console.log("Run with --fix to complete them.");
}

/** Set a step output when running in GitHub Actions; a random delimiter keeps any value to one output. */
function output(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `EOF_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function submission(cms: Cms) {
  const [, file] = positionals;
  if (!file) fail("submission needs the file holding the issue body");
  const issue = args.issue ? Number(args.issue) : undefined;
  if (issue !== undefined && !Number.isInteger(issue)) fail(`--issue must be a number, not "${args.issue}"`);
  const playlist = args.playlist.at(-1) ?? COMMUNITY_PLAYLIST;
  cms.find("playlist", playlist); // fail early on a bad --playlist

  const report = (text: string) => {
    console.log(text);
    if (args.report) writeFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), args.report), text);
  };
  try {
    const sub = parseSubmission(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8"));
    assertNewVideo(cms, sub.videoId);
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) fail("submission needs YOUTUBE_API_KEY to fetch the video");
    const [video] = await new YouTubeClient(key).getVideos([sub.videoId]);
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
      if (sub !== "create") fail(`unknown playlist command "${sub ?? ""}"; try playlist create`);
      return playlistCreate(cms);
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
