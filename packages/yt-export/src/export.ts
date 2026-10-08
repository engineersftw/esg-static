#!/usr/bin/env node
/**
 * Export a YouTube channel's playlists and videos, in one of two modes:
 *
 * - default: write episodes.json, playlists.json and playlist_items.json, shaped like
 *   @esg/db-types and formatted like backup/.
 * - --content <dir>: sync the videos and playlists into the Astro content collections
 *   (video/<id>.md, playlist/<id>.md): refresh title, description and thumbnails of the entries that
 *   exist and create the ones that don't. The playlists and videos already in the content are
 *   fetched too, even if they are not on the channel.
 *
 * Raw API responses are saved to <out>/raw.json so either step can be re-run with --from-raw
 * without spending API quota.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { readEntries, writeEntryFiles } from "@esg/content";
import { planSync, type CollectionSummary, type ExistingContent } from "./sync.js";
import { transform, type RawExport } from "./transform.js";
import { YouTubeClient, type YtPlaylistItem } from "./youtube.js";

// The repo's .env (YOUTUBE_API_KEY, ...), wherever the command runs; variables already set win.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const HELP = `
Usage: yt-export --channel <handle|id> [options]

  --channel <c>         Channel handle (@engineerssg) or ID (UC…)
  --playlist <id>       Extra playlist to include (e.g. owned by another channel); repeatable
  --key <key>           YouTube Data API key (default: YOUTUBE_API_KEY env var)
  -o, --out <dir>       Output directory (default: ./yt-export-<timestamp>; with --content,
                        raw.json is only saved if this is given)
      --from-raw <file> Skip the API; re-run on a saved raw.json
                        (output defaults to the raw file's directory)
      --content <dir>   Sync into this Astro content directory (e.g. apps/website/content)
                        instead of writing the JSON tables
      --exclude-video <id>
                        With --content: leave this YouTube video ID out of the sync (not created,
                        not updated, not added to playlists); repeatable
      --deactivate-missing
                        With --content: set active: false on videos and playlists YouTube was
                        asked about and did not return (private or deleted), so the site stops
                        publishing them. Ones never fetched are left alone.
      --dry-run         With --content: show what would change, write nothing
  -h, --help
`;

const { values: args } = parseArgs({
  options: {
    channel: { type: "string" },
    playlist: { type: "string", multiple: true },
    key: { type: "string" },
    out: { type: "string", short: "o" },
    "from-raw": { type: "string" },
    content: { type: "string" },
    "exclude-video": { type: "string", multiple: true },
    "deactivate-missing": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

/** Same layout as backup/*.json: one row per line inside a JSON array. */
function writeRows(path: string, rows: object[]) {
  const body = rows.length ? `[\n  ${rows.map((r) => JSON.stringify(r)).join(",\n  ")}\n]\n` : "[]\n";
  writeFileSync(path, body);
}

async function fetchRaw(
  client: YouTubeClient,
  channelArg: string,
  extraIds: string[],
  extraVideoIds: string[] = [],
): Promise<RawExport> {
  const fetchedAt = new Date().toISOString();
  const channel = await client.getChannel(channelArg);
  console.log(`Channel: ${channel.snippet.title} (${channel.id})`);

  const playlists = await client.getChannelPlaylists(channel.id);
  console.log(`- ${playlists.length} channel playlists`);

  const missingExtras = [...new Set(extraIds)].filter((id) => !playlists.some((p) => p.id === id));
  if (missingExtras.length) {
    const extras = await client.getPlaylists(missingExtras);
    for (const id of missingExtras) {
      if (!extras.some((p) => p.id === id)) console.warn(`  ! playlist ${id} not found (private or deleted?)`);
    }
    playlists.push(...extras);
    console.log(`- ${extras.length} extra playlists`);
  }

  const playlistItems: Record<string, YtPlaylistItem[]> = {};
  for (const [i, p] of playlists.entries()) {
    playlistItems[p.id] = await client.getPlaylistItems(p.id);
    console.log(`  [${i + 1}/${playlists.length}] ${p.snippet.title}: ${playlistItems[p.id].length} items`);
  }

  // The uploads playlist catches videos that aren't in any playlist.
  const uploads = await client.getPlaylistItems(channel.contentDetails.relatedPlaylists.uploads);
  console.log(`- ${uploads.length} uploads`);

  const videoIds = [
    ...new Set([
      ...[...Object.values(playlistItems).flat(), ...uploads].map((item) => item.contentDetails.videoId),
      ...extraVideoIds,
    ]),
  ];
  const videos = await client.getVideos(videoIds);
  console.log(`- ${videos.length} of ${videoIds.length} videos available`);

  const requested = { videos: videoIds, playlists: [...new Set([...playlists.map((p) => p.id), ...missingExtras])] };
  return { fetchedAt, channel, playlists, playlistItems, videos, requested };
}

/** Most new files listed per collection in the sync summary. */
const LIST_LIMIT = 10;

function printSummary(label: string, c: CollectionSummary, collection: string, deactivating: boolean) {
  console.log(`${label}: ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged`);
  if (c.notFetched) console.log(`  ${c.notFetched} not fetched, so their state on YouTube is unknown (run with --channel and an API key)`);
  if (c.notOnYouTube.length) {
    const published = c.notOnYouTube.filter((m) => m.active);
    console.log(`  ${c.notOnYouTube.length} not returned by YouTube (private or deleted), ${published.length} of them published`);
    for (const m of published.slice(0, LIST_LIMIT)) {
      console.log(`  ! ${collection}/${m.entry}.md  ${m.title}  (${m.youtubeId})${deactivating ? "  → active: false" : ""}`);
    }
    if (published.length > LIST_LIMIT) console.log(`  ! … and ${published.length - LIST_LIMIT} more`);
    if (published.length && !deactivating) console.log("  (--deactivate-missing hides them)");
  }
  if (c.linked) console.log(`  ${c.linked} more written only to complete one-sided playlist links`);
  if (c.skipped.length) console.log(`  skipped (no available videos): ${c.skipped.join(", ")}`);
  if (c.excluded.length) console.log(`  excluded: ${c.excluded.join(", ")}`);
}

/** Sync into the Astro content directory; returns the number of files written (0 on a dry run). */
function syncContent(
  raw: RawExport,
  existing: ExistingContent,
  contentDir: string,
  dryRun: boolean,
  excludeVideos: string[],
  deactivateMissing: boolean,
) {
  const plan = planSync(raw, existing, { excludeVideos, deactivateMissing });
  for (const id of excludeVideos.filter((id) => !plan.videos.excluded.includes(id))) {
    console.warn(`  ! --exclude-video ${id} matches no fetched video or entry`);
  }

  const changes: Record<string, number> = {};
  for (const w of plan.writes) {
    const collection = w.path.split("/")[0];
    for (const field of w.kind === "create" ? ["(new)"] : w.changed) {
      const key = `${collection}.${field}`;
      changes[key] = (changes[key] ?? 0) + 1;
    }
  }

  printSummary("Videos", plan.videos, "video", deactivateMissing);
  printSummary("Playlists", plan.playlists, "playlist", deactivateMissing);
  for (const [key, n] of Object.entries(changes).sort()) console.log(`  ${key}: ${n}`);
  for (const collection of ["playlist", "video"]) {
    const created = plan.writes.filter((w) => w.kind === "create" && w.path.startsWith(`${collection}/`));
    for (const w of created.slice(0, LIST_LIMIT)) console.log(`  + ${w.path}  ${w.title}`);
    if (created.length > LIST_LIMIT) console.log(`  + … and ${created.length - LIST_LIMIT} more ${collection} files`);
  }

  if (!dryRun) writeEntryFiles(contentDir, plan.writes);
  console.log(`\n${dryRun ? "Dry run: would write" : "Wrote"} ${plan.writes.length} files → ${contentDir}`);
}

async function main() {
  let raw: RawExport;
  let outDir: string | null;
  let quotaUsed: number | null = null;

  const contentDir = args.content ? resolve(args.content) : null;
  if (args["dry-run"] && !contentDir) fail("--dry-run needs --content");
  if (args["exclude-video"]?.length && !contentDir) fail("--exclude-video needs --content");
  if (args["deactivate-missing"] && !contentDir) fail("--deactivate-missing needs --content");
  const existing: ExistingContent | null = contentDir
    ? {
        videos: readEntries(contentDir, "video"),
        playlists: readEntries(contentDir, "playlist"),
      }
    : null;
  if (existing) console.log(`Content: ${existing.videos.length} videos, ${existing.playlists.length} playlists in ${contentDir}`);

  if (args["from-raw"]) {
    const rawPath = resolve(args["from-raw"]);
    raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawExport;
    outDir = resolve(args.out ?? dirname(rawPath));
  } else {
    if (!args.channel) fail("--channel is required (or use --from-raw)");
    const key = args.key ?? process.env.YOUTUBE_API_KEY;
    if (!key) fail("No API key. Use --key or set YOUTUBE_API_KEY.");
    outDir = args.out || !contentDir ? resolve(args.out ?? `yt-export-${new Date().toISOString().replace(/[:.]/g, "-")}`) : null;

    const client = new YouTubeClient(key);
    // Refresh what the content already has, even if it isn't on the channel.
    const contentPlaylists = existing?.playlists.flatMap((e) => (e.data.playlistId ? [e.data.playlistId] : [])) ?? [];
    const contentVideos = existing?.videos.flatMap((e) => (e.data.videoSite === "youtube" ? [e.data.videoId] : [])) ?? [];
    raw = await fetchRaw(client, args.channel, [...(args.playlist ?? []), ...contentPlaylists], contentVideos);
    quotaUsed = client.quotaUsed;
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "raw.json"), JSON.stringify(raw) + "\n");
    }
  }

  if (contentDir && existing) {
    syncContent(raw, existing, contentDir, args["dry-run"], args["exclude-video"] ?? [], args["deactivate-missing"]);
    if (quotaUsed !== null) console.log(`${quotaUsed} quota units used${outDir ? `; raw.json → ${outDir}` : ""}`);
    return;
  }

  outDir = outDir!;
  const exportedAt = new Date();
  const data = transform(raw, exportedAt);
  mkdirSync(outDir, { recursive: true });
  writeRows(join(outDir, "episodes.json"), data.episodes);
  writeRows(join(outDir, "playlists.json"), data.playlists);
  writeRows(join(outDir, "playlist_items.json"), data.playlist_items);
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        fetchedAt: raw.fetchedAt,
        channel: { id: raw.channel.id, title: raw.channel.snippet.title, handle: raw.channel.snippet.customUrl ?? null },
        counts: {
          episodes: data.episodes.length,
          playlists: data.playlists.length,
          playlist_items: data.playlist_items.length,
        },
        quotaUsed,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `\n${data.episodes.length} episodes, ${data.playlists.length} playlists, ${data.playlist_items.length} playlist items` +
      `${quotaUsed !== null ? ` (${quotaUsed} quota units)` : ""} → ${outDir}`,
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
