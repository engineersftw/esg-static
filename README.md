# Engineers.SG Static Site

The rebuild of [Engineers.SG](https://engineers.sg), the archive of Singapore tech meetup and conference talks. The old site was a Rails app on Heroku Postgres. The new one is a static Astro site on Cloudflare Pages.

This repo holds the new site and the tools that moved the old site's data into it:

| Package | Path | What it does |
|---|---|---|
| `@esg/static-website` | [`apps/website`](apps/website) | The Astro site, built from Markdown content files |
| `@esg/pg-export` | [`packages/pg-export`](packages/pg-export) | Dumps a Postgres database to JSON, CSV or NDJSON, or writes the Engineers.SG data as the site's Markdown content |
| `@esg/yt-export` | [`packages/yt-export`](packages/yt-export) | Pulls videos and playlists from the YouTube Data API and syncs them into the site's content |
| `@esg/cms` | [`packages/cms`](packages/cms) | Command-line editor for the content: create presenters, link videos to presenters, organizations and playlists |
| `@esg/content` | [`packages/content`](packages/content) | Shared code for reading, writing, slugging and linking the content files |
| `@esg/db-types` | [`packages/db-types`](packages/db-types) | Shared TypeScript types: the old database's rows, and the frontmatter of the content files |

## How the pieces fit

```
old Rails DB (Heroku Postgres)
   │  pg-export -f json                       YouTube channel
   ▼                                              │
output/backup/*.json  ── pg-export -f markdown ─┐ │ yt-export --content
                                                ▼ ▼
                           apps/website/content/{video,organization,presenter,playlist}/<id>.md
                                                │
                                                │ astro build
                                                ▼
                                    apps/website/dist/  ──  wrangler  ──▶  Cloudflare Pages
```

The old database was exported once to `output/backup/`. `pg-export` turned that into the site's Markdown content, which is committed in `apps/website/content/`. From here on, `yt-export` keeps the content up to date with the YouTube channel (daily, through a GitHub Action), `cms` is used to curate it (presenters, organizations, playlists), and the site is built from the content alone. Nothing talks to a database at build or run time.

## Getting started

You need Node 24 (`.nvmrc` pins 24.21.0, the current LTS) and pnpm 10. `apps/website/.nvmrc` pins the same version for the Cloudflare Pages build, which only looks in the site's root directory, so keep the two in step.

```bash
nvm use
pnpm install        # installs every package (pnpm workspace)

pnpm test           # every package's tests
pnpm typecheck      # every package's type-check (the website's is `astro check`)
pnpm lint           # ESLint over the whole repo (pnpm lint:fix to autofix)
pnpm build          # builds the website and pg-export
pnpm cms --help     # the content editor
```

ESLint is configured once for the whole repo in `eslint.config.js`. The packages compile with TypeScript 7, but the root and the website pin TypeScript `~6.0` because typescript-eslint and `astro check` don't support 7 yet; leave those pins until they do.

To run a script in one package from the root, use `pnpm --filter <name> <script>`, e.g. `pnpm --filter @esg/yt-export test`. Or `cd` into the package and run `pnpm <script>`.

## apps/website

The public site: about 7k static pages covering videos, conferences, playlists, organizations and presenters, with a hamburger menu on mobile. Every page has its own title, description and preview image for sharing, and organizations or presenters with no image (or a broken image URL) get a placeholder. A small Cloudflare Pages Function (`apps/website/functions/`) redirects the old site's URLs.

```bash
cd apps/website
cp env.example .env      # HOSTNAME, PUBLIC_GTM_ID
pnpm dev                 # http://localhost:4321
pnpm build               # → dist/
HOSTNAME=https://engineers.sg PUBLIC_GTM_ID=GTM-XXXXXXX pnpm build && pnpm deploy:production
```

See **[apps/website/README.md](apps/website/README.md)** for the content format, routes, old-URL redirects, helpers, environment variables and deployment.

## packages/yt-export

Fetches a YouTube channel's playlists and videos with an API key, so it only sees public and unlisted content. It works in two modes:

- **Sync into the site's content** (the usual one): it updates the title, description and thumbnails of existing entries, and adds new videos and playlists. Nothing is ever deleted, and curated fields (slugs, organizations, presenters, categories) are kept.
- **Standalone export:** it writes `episodes.json`, `playlists.json` and `playlist_items.json` rows shaped like the old database (typed by `@esg/db-types`).

```bash
cd packages/yt-export

# Sync into the site; always do a dry run first
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content -o ../../output/yt

# Re-run from the saved API responses, with no API calls
pnpm export --from-raw ../../output/yt/raw.json --content ../../apps/website/content

# Standalone JSON export
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg -o ../../output/yt-export

pnpm export --help      # all options
pnpm test
```

Useful sync options:

- `--deactivate-missing` sets `active: false` on videos and playlists that YouTube was asked about and didn't return (now private or deleted), so the site stops showing them.
- `--exclude-video <youtube-id>` leaves a video out of the sync entirely. You can repeat it.
- `--playlist <id>` also fetches a playlist owned by another channel. You can repeat it.

New videos arrive with no organizations or presenters; link them with [`cms`](#packagescms). Every list call costs 1 unit of YouTube API quota. Get an API key from the Google Cloud console (YouTube Data API v3).

## packages/cms

A command-line editor for the content, run from the repo root with `pnpm cms`. Every link is written on both sides (the video's `presenters`/`organizations`/`playlists` and the other entry's `videos`), and only changed files are rewritten, in the same format as pg-export, so they diff cleanly.

```bash
pnpm cms find presenter yeo                  # look up entries: find <video|presenter|organization|playlist> <text>
pnpm cms presenter create --name "Jane Doe" --x @jane --linkedin https://linkedin.com/in/jane --instagram jane.doe --video 4517 --dry-run
pnpm cms assign --video 4517 --presenter jane-doe --organization 111 --playlist pyconsg-2019
pnpm cms unassign --video 4517 --playlist 1
pnpm cms check [--fix]                       # find (and complete) links stored on one side only
pnpm cms --help                              # all options
```

A `<ref>` can be an entry ID, a slug, a site URL or path (`/video/<slug>`), and for videos a YouTube video ID or URL, for playlists a YouTube playlist ID. An ambiguous or unknown ref fails the whole command before anything is written. `--dry-run` shows what would change, and `--content <dir>` points it at another content directory (default `apps/website/content`).

Presenters and organizations have a `links` list of `{ "type", "url" }` entries, shown in that order with an icon each. The types are `x`, `website`, `linkedin`, `instagram` and `tiktok`, and `presenter create` has a flag for each (`--x` or `--twitter`, `--website`, `--linkedin`, `--instagram`, `--tiktok`) that takes a handle or URL.

## packages/content

The shared code behind yt-export and cms: reading and writing the content `.md` files (byte-identical to pg-export's output, so unchanged files are never rewritten), `slugify` and unique slug allocation, and the helpers that keep two-sided links in sync. Like db-types, it ships TypeScript source with no build step.

## packages/pg-export

A general-purpose Postgres export CLI, made to export Heroku Postgres. It reads everything in one read-only, consistent snapshot transaction and streams large tables. It also has an Engineers.SG-specific Markdown mode that produces the site's content.

```bash
cd packages/pg-export

# Table dumps: one file per table plus schema.json (this is how output/backup/ was made)
node dist/export.js --app <heroku-app> -f json -o ../../output/backup
DATABASE_URL=postgres://... pnpm export --no-ssl -f csv -o ../../output/local

# Markdown content for the site, from the JSON dump (no database needed) or a live database
pnpm export --from-json ../../output/backup -o ../../apps/website/content
pnpm export -f markdown --app <heroku-app> -o ../../apps/website/content

pnpm export --help      # all options
pnpm build              # tsc → dist/ (committed)
pnpm test
```

The Markdown mode **overwrites** files in the output directory. Running it into `apps/website/content` replaces any edits made since, including the yt-export syncs, so point it somewhere else unless you mean to start over. More detail is in [packages/pg-export/README.md](packages/pg-export/README.md).

## packages/db-types

Types only, with no build step: its `exports` point at the `.ts` source, which tsx, Vitest and `tsc` read directly.

- `@esg/db-types`: one interface per table in the old database (`Episode`, `Organization`, `Presenter`, `Playlist`, …), matching the rows in `output/backup/*.json`. Timestamps are UTC text, not `Date`.
- `@esg/db-types/content`: the frontmatter of the site's content files (`Video`, `Organization`, `Presenter`, `Playlist`).

```ts
import type { Episode } from "@esg/db-types";
import type { Video } from "@esg/db-types/content";
```

If you change a content field, update `content.ts`, the zod schema in `apps/website/src/content.config.ts`, and the tool that writes the field.

## Automation

GitHub Actions in `.github/workflows/`:

- **CI** (`ci.yml`): runs `pnpm lint`, `pnpm typecheck` and `pnpm test` as three separate checks on every pull request and push to `main`, after a `pnpm install --frozen-lockfile`. Commit `pnpm-lock.yaml` with any dependency change, or the install fails.
- **Sync YouTube** (`sync-youtube.yml`): runs yt-export against the channel daily at 02:00 UTC (10:00 Singapore time), or on demand from the Actions tab. If the content changed, it opens or updates a pull request from the `youtube-sync` branch, and can post a Telegram notification. It needs the `YOUTUBE_API_KEY` secret (and optionally `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`). Setup is in [SYNC_YOUTUBE.md](.github/workflows/SYNC_YOUTUBE.md).

## Repo layout

```
apps/website/          the Astro site (content/ holds the data)
packages/cms/          content editor CLI
packages/content/      shared content file read/write, slugs and links
packages/db-types/     shared types
packages/pg-export/    Postgres export / Markdown generator
packages/yt-export/    YouTube sync
output/                generated data, git-ignored (backup/, yt-export runs, scratch exports)
.github/workflows/     CI and the daily YouTube sync
eslint.config.js       ESLint config for the whole repo
tsconfig.base.json     compiler options every package extends
CLAUDE.md              detailed notes for AI coding agents (also handy for humans)
```

## Personal data

`output/backup/` is a dump of the production database. It includes admin password hashes and IP addresses (`users.json`) and presenter email addresses (`presenters.json`). It is git-ignored: keep it that way, and don't publish anything from it.

The site's content is public. pg-export writes presenter emails as `null` unless you pass `--include-emails`, so don't pass it when writing into `apps/website/content`.
