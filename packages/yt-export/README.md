# @esg/yt-export

Pulls a YouTube channel's playlists and videos from the YouTube Data API, and either syncs them into the site's content (`apps/website/content`) or writes them as standalone JSON rows shaped like the old database.

It authenticates with an API key, so it only sees public and unlisted content. Every list call costs 1 unit of API quota; a full sync of the Engineers.SG channel uses about 300. Get a key from the Google Cloud console (YouTube Data API v3).

The CLI loads the repo's root `.env` (`YOUTUBE_API_KEY=...`) wherever it runs from. A variable already set in the shell wins.

## Usage

Run these from `packages/yt-export/`. There is no build step: the CLI runs through tsx.

```bash
# Sync into the site's content; always do a dry run first
pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run
pnpm export --channel @engineerssg --content ../../apps/website/content -o ../../output/yt

# Also fetch a playlist owned by another channel
pnpm export --channel @engineerssg --playlist PLYDCh9vbt8_LFv-UIoxkhZRB-PCcv9lGO --content ../../apps/website/content --dry-run

# Re-run from the saved API responses, with no API calls
pnpm export --from-raw ../../output/yt/raw.json --content ../../apps/website/content

# Standalone JSON export (episodes.json, playlists.json, playlist_items.json)
pnpm export --channel @engineerssg -o ../../output/yt-export

pnpm export --help
```

| Option | Description |
|---|---|
| `--channel <c>` | Channel handle (`@engineerssg`) or ID (`UC…`) |
| `--playlist <id>` | An extra playlist to include, e.g. one owned by another channel; repeatable |
| `--key <key>` | API key (default: `YOUTUBE_API_KEY`) |
| `-o, --out <dir>` | Output directory. With `--content`, `raw.json` is only saved if this is given |
| `--from-raw <file>` | Skip the API and re-run on a saved `raw.json` |
| `--content <dir>` | Sync into this content directory instead of writing JSON |
| `--exclude-video <id>` | With `--content`: leave this YouTube video out entirely; repeatable |
| `--deactivate-missing` | With `--content`: set `active: false` on entries YouTube was asked about and didn't return (private or deleted) |
| `--dry-run` | With `--content`: show what would change and write nothing |

The daily GitHub Action (`.github/workflows/sync-youtube.yml`, see `SYNC_YOUTUBE.md` there) runs the sync and opens a pull request when the content changes.

## What the sync does

- **Matching:** existing entries are matched on `videoId` (YouTube videos only, not Vimeo) and `playlistId`. It also fetches the videos and playlists the content already references, since many aren't on the channel.
- **Existing entries:** the title, description (the Markdown body) and thumbnails (a playlist's `image`) are refreshed. A thumbnail YouTube no longer returns is kept. Everything else (slug, `active`, dates, category, organizations, presenters) is left alone.
- **New entries:** a video with no file gets `video/yt-<YouTube ID>.md`, and a playlist `playlist/yt-<playlist ID>.md`, each with a slug unique in its collection. New videos are active only if public, with no organizations or presenters; link those with `pnpm cms`. A new playlist with no available videos is skipped. The sync refuses to create an ID that differs from an existing one only in case, since those files would overwrite each other on macOS and Windows.
- **Playlist membership** is additive and stored on the playlist: videos YouTube lists in a playlist are appended to its `videos`. Nothing is removed, so curated order survives.
- **Nothing is deleted.** `raw.json` records which IDs were requested, so an existing entry YouTube didn't return is reported as *not returned* (private or deleted) or *not fetched* (never asked about). Only `--deactivate-missing` acts on the first kind.
- Files are written byte-for-byte in pg-export's format, so unchanged entries are never rewritten.

The standalone JSON export doesn't merge with anything: IDs start at 1 (oldest first), private and deleted videos are dropped, and unlisted ones get `active: false`.

## Code

| File | What it holds |
|---|---|
| `src/export.ts` | The CLI: fetching, `raw.json`, summaries |
| `src/youtube.ts` | A thin `fetch` client for the API (also exported as `@esg/yt-export/youtube`, which `@esg/cms` uses) |
| `src/sync.ts` | The pure sync planner (`planSync`) |
| `src/transform.ts` | The pure standalone-export transform |

```bash
pnpm test        # Vitest: sync.test.ts and transform.test.ts
pnpm typecheck
```
