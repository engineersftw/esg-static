#!/usr/bin/env node
/**
 * Export a YouTube channel's playlists and videos to episodes.json, playlists.json and
 * playlist_items.json, shaped like types/db.ts and formatted like backup/.
 *
 * Raw API responses are saved to <out>/raw.json so the transform can be re-run with
 * --from-raw without spending API quota.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { transform, type RawExport } from "./transform.js";
import { YouTubeClient, type YtPlaylistItem } from "./youtube.js";

const HELP = `
Usage: yt-export --channel <handle|id> [options]

  --channel <c>         Channel handle (@engineerssg) or ID (UC…)
  --playlist <id>       Extra playlist to include (e.g. owned by another channel); repeatable
  --key <key>           YouTube Data API key (default: YOUTUBE_API_KEY env var)
  -o, --out <dir>       Output directory (default: ./yt-export-<timestamp>)
      --from-raw <file> Skip the API; re-run the transform on a saved raw.json
                        (output defaults to the raw file's directory)
  -h, --help
`;

const { values: args } = parseArgs({
  options: {
    channel: { type: "string" },
    playlist: { type: "string", multiple: true },
    key: { type: "string" },
    out: { type: "string", short: "o" },
    "from-raw": { type: "string" },
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

async function fetchRaw(client: YouTubeClient, channelArg: string, extraIds: string[]): Promise<RawExport> {
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
    ...new Set([...Object.values(playlistItems).flat(), ...uploads].map((item) => item.contentDetails.videoId)),
  ];
  const videos = await client.getVideos(videoIds);
  console.log(`- ${videos.length} of ${videoIds.length} videos available`);

  return { fetchedAt, channel, playlists, playlistItems, videos };
}

async function main() {
  let raw: RawExport;
  let outDir: string;
  let quotaUsed: number | null = null;

  if (args["from-raw"]) {
    const rawPath = resolve(args["from-raw"]);
    raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawExport;
    outDir = resolve(args.out ?? dirname(rawPath));
  } else {
    if (!args.channel) fail("--channel is required (or use --from-raw)");
    const key = args.key ?? process.env.YOUTUBE_API_KEY;
    if (!key) fail("No API key. Use --key or set YOUTUBE_API_KEY.");
    outDir = resolve(args.out ?? `yt-export-${new Date().toISOString().replace(/[:.]/g, "-")}`);

    const client = new YouTubeClient(key);
    raw = await fetchRaw(client, args.channel, args.playlist ?? []);
    quotaUsed = client.quotaUsed;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "raw.json"), JSON.stringify(raw) + "\n");
  }

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
