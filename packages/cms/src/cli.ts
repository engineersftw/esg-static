#!/usr/bin/env node
/**
 * Command line editor for the Astro content collections (apps/website/content): create presenters and
 * link videos to presenters, organizations and playlists, writing both sides of each link.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readEntries, VIDEO_LINKS, writeEntryFiles, type VideoLinkField } from "@esg/content";
import { Collection } from "@esg/db-types/content";
import { Cms, CmsError, titleOf, type Change } from "./cms.js";

const HELP = `
Usage: cms <command> [options]

Commands:
  presenter create --name <name> [options]
                        Create a presenter (ID and slug are assigned)
      --byline <text>   Job title or affiliation
      --twitter <h>     Twitter/X handle, with or without @
      --website <url>   A personal site
      --linkedin <url>  LinkedIn profile URL
      --image <url>     Photo URL
      --email <email>   Not shown on the site
      --bio <text>      Biography (the Markdown body)
      --slug <slug>     Instead of one made from the name
      --inactive        Create it hidden from the site
      --allow-duplicate Create it even if a presenter has the same name
      --video <ref>     Also assign it to this video; repeatable

  assign --video <ref> [--presenter <ref>] [--organization <ref>] [--playlist <ref>]
                        Link each video to each presenter, organization and playlist;
                        every option is repeatable
  unassign …            Same options; removes the links

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
    twitter: { type: "string" },
    website: { type: "string" },
    linkedin: { type: "string" },
    image: { type: "string" },
    email: { type: "string" },
    bio: { type: "string" },
    slug: { type: "string" },
    inactive: { type: "boolean", default: false },
    "allow-duplicate": { type: "boolean", default: false },
    // assign / unassign
    video: { type: "string", multiple: true, default: [] },
    presenter: { type: "string", multiple: true, default: [] },
    organization: { type: "string", multiple: true, default: [] },
    playlist: { type: "string", multiple: true, default: [] },
    // check
    fix: { type: "boolean", default: false },
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
    twitter: args.twitter,
    website: args.website,
    linkedin: args.linkedin,
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

function main() {
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
    case "assign":
      return assign(cms, false);
    case "unassign":
      return assign(cms, true);
    case "find":
      return find(cms);
    case "check":
      return check(cms);
    default:
      fail(`unknown command "${command}"; see --help`);
  }
}

try {
  main();
} catch (e) {
  if (e instanceof CmsError) fail(e.message);
  throw e;
}
