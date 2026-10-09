# Engineers.SG Static Site

The rebuild of [Engineers.SG](https://engineers.sg), the archive of Singapore tech meetup and conference talks. The old site was a Rails app on Heroku Postgres. The new one is a static Astro site on Cloudflare Pages.

This repo holds the new site and the tools that moved the old site's data into it and keep it up to date. Each one has its own README, linked below:

| Package | Path | What it does |
|---|---|---|
| `@esg/static-website` | [`apps/website`](apps/website/README.md) | The Astro site, built from Markdown content files |
| `@esg/pg-export` | [`packages/pg-export`](packages/pg-export/README.md) | Dumps a Postgres database to JSON, CSV or NDJSON, or writes the Engineers.SG data as the site's Markdown content |
| `@esg/yt-export` | [`packages/yt-export`](packages/yt-export/README.md) | Pulls videos and playlists from the YouTube Data API and syncs them into the site's content |
| `@esg/cms` | [`packages/cms`](packages/cms/README.md) | Command-line editor for the content: create presenters and organizations, edit their links, link videos to presenters, organizations and playlists, add community-submitted videos |
| `@esg/content` | [`packages/content`](packages/content/README.md) | Shared code for the content files: reading and writing them, entry IDs, slugs, links and profile links |
| `@esg/db-types` | [`packages/db-types`](packages/db-types/README.md) | Shared TypeScript types: the old database's rows, and the frontmatter of the content files |

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

The old database was exported once to `output/backup/`. `pg-export` turned that into the site's Markdown content, which is committed in `apps/website/content/`. From here on, `yt-export` keeps the content up to date with the YouTube channel (daily, through a GitHub Action), `cms` is used to curate it (presenters, organizations, playlists) and adds the videos people submit through a GitHub issue form, and the site is built from the content alone. Nothing talks to a database at build or run time.

## Getting started

You need Node 24 (`.nvmrc` pins 24.21.0, the current LTS) and pnpm 10. `apps/website/.nvmrc` pins the same version for the Cloudflare Pages build, which only looks in the site's root directory, so keep the two in step.

```bash
nvm use
pnpm install        # installs every package (pnpm workspace)

pnpm test           # every package's tests
pnpm typecheck      # every package's type-check (the website's is `astro check`)
pnpm lint           # ESLint over the whole repo (pnpm lint:fix to autofix)
pnpm content        # check the content: links to missing entries, case clashes, leftover reverse lists
pnpm build          # builds the website and pg-export
pnpm cms --help     # the content editor
```

ESLint is configured once for the whole repo in `eslint.config.js`. The packages compile with TypeScript 7, but the root and the website pin TypeScript `~6.0` because typescript-eslint and `astro check` don't support 7 yet; leave those pins until they do.

To run a script in one package from the root, use `pnpm --filter <name> <script>`, e.g. `pnpm --filter @esg/yt-export test`. Or `cd` into the package and run `pnpm <script>`.

## apps/website

The public site: about 7k static pages covering videos, conferences, playlists, organizations and presenters, with a hamburger menu on mobile. Every page has its own title, description and preview image for sharing, and organizations or presenters with no image (or a broken image URL) get a placeholder. Two small Cloudflare Pages Functions (`apps/website/functions/`) redirect the old site's URLs and power the video search at `/search`.

```bash
cd apps/website
cp env.example .env      # HOSTNAME, PUBLIC_GTM_ID
pnpm dev                 # http://localhost:4321
pnpm build               # → dist/
HOSTNAME=https://engineers.sg PUBLIC_GTM_ID=GTM-XXXXXXX pnpm build && pnpm deploy:production
```

See **[apps/website/README.md](apps/website/README.md)** for the content format, routes, old-URL redirects, helpers, environment variables and deployment.

## packages/yt-export

Syncs the YouTube channel into the site's content: it refreshes the title, description and thumbnails of existing videos and playlists, and adds new ones (`video/yt-<YouTube ID>.md`). Nothing is ever deleted, and curated fields are kept. It can also write a standalone JSON export shaped like the old database. The daily GitHub Action runs it (see [Automation](#automation)).

```bash
cd packages/yt-export
pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run   # YOUTUBE_API_KEY from .env
```

New videos arrive with no organizations or presenters; link them with [`cms`](#packagescms). Options, matching rules and API quota: **[packages/yt-export/README.md](packages/yt-export/README.md)**.

## packages/cms

The command-line editor for the content, run from the repo root: create presenters, organizations and playlists, edit their links, link videos to them, check the content, and add the videos people submit through the issue form.

```bash
pnpm cms find presenter yeo
pnpm cms assign --video 4609-4618 --presenter jane-doe --organization 42 --dry-run
pnpm cms check          # same as pnpm content
pnpm cms --help
```

Every command, refs, IDs and the submission flow: **[packages/cms/README.md](packages/cms/README.md)**.

## packages/content

Shared code behind yt-export and cms: reading and writing the content files (byte-identical to pg-export's output, so unchanged files are never rewritten), entry IDs (numeric for the old site's entries, `yt-<YouTube ID>` or random for new ones), one-sided links, slugs and profile links. See **[packages/content/README.md](packages/content/README.md)**.

## packages/pg-export

A general-purpose Postgres export CLI (one file per table plus `schema.json`, in one consistent snapshot), with an Engineers.SG-specific Markdown mode that produced the site's content from the old database. It was used once to make `output/backup/` and the first `apps/website/content/`.

```bash
cd packages/pg-export
node dist/export.js --app <heroku-app> -f json -o ../../output/backup
```

The Markdown mode **overwrites** files in its output directory, so never point it at `apps/website/content` unless you mean to start over. Options and output format: **[packages/pg-export/README.md](packages/pg-export/README.md)**.

## packages/db-types

Shared TypeScript types, with no build step: `@esg/db-types` for the old database's rows and `@esg/db-types/content` for the content files' frontmatter. If you change a content field, update `content.ts`, the zod schema in `apps/website/src/content.config.ts`, and the tools that write it. See **[packages/db-types/README.md](packages/db-types/README.md)**.

## Automation

GitHub Actions in `.github/workflows/`:

- **CI** (`ci.yml`): runs `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm content` (`pnpm cms check`) as four separate checks on every pull request and push to `main`, after a `pnpm install --frozen-lockfile`. Commit `pnpm-lock.yaml` with any dependency change, or the install fails.
- **Sync YouTube** (`sync-youtube.yml`): runs yt-export against the channel daily at 02:00 UTC (10:00 Singapore time), or on demand from the Actions tab. If the content changed, it opens or updates a pull request from the `youtube-sync` branch, and can post a Telegram notification. It needs the `YOUTUBE_API_KEY` secret (and optionally `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`). Setup is in [SYNC_YOUTUBE.md](.github/workflows/SYNC_YOUTUBE.md).
- **Video submission** (`video-submission.yml`): runs when someone opens or edits an issue made from the **Submit a video** form (`.github/ISSUE_TEMPLATE/submit-video.yml`, labelled `video-submission`). It runs `pnpm cms submission` on the issue, opens or updates a pull request from `video-submission/issue-<n>` that adds the video to the Community Contributed playlist and closes the issue, and comments on the issue with the result. It uses the same secrets as the sync. Setup and caveats are in [VIDEO_SUBMISSION.md](.github/workflows/VIDEO_SUBMISSION.md).

## Repo layout

```
apps/website/          the Astro site (content/ holds the data)
packages/cms/          content editor CLI
packages/content/      shared content file read/write, slugs and links
packages/db-types/     shared types
packages/pg-export/    Postgres export / Markdown generator
packages/yt-export/    YouTube sync
docs/                  design notes, e.g. content-id-migration.md (why IDs and links work as they do)
output/                generated data, git-ignored (backup/, yt-export runs, scratch exports)
.github/workflows/     CI, the daily YouTube sync and video submissions
eslint.config.js       ESLint config for the whole repo
tsconfig.base.json     compiler options every package extends
CLAUDE.md              detailed notes for AI coding agents (also handy for humans)
```

## Personal data

`output/backup/` is a dump of the production database. It includes admin password hashes and IP addresses (`users.json`) and presenter email addresses (`presenters.json`). It is git-ignored: keep it that way, and don't publish anything from it.

The site's content is public. pg-export writes presenter emails as `null` unless you pass `--include-emails`, so don't pass it when writing into `apps/website/content`.
