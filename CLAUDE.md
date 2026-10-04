# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This is the rebuild of Engineers.SG. The repo holds the new Astro site (`apps/website`), the data from the existing site (a Rails app on Heroku Postgres, with ActiveAdmin and Devise, going by its tables) and the tools used to export it.

It is a pnpm workspace (`pnpm-workspace.yaml` → `apps/*` and `packages/*`, pnpm 10, Node 22.12+ for Astro 7). Shared compiler options live in `tsconfig.base.json`, which each package's `tsconfig.json` extends.

- `output/` (git-ignored): generated data. `output/backup/` is below; yt-export runs also land here (e.g. `-o ../../output/yt-export-<timestamp>`).
- `apps/website/` (`esg-website`): the Astro site, described under "apps/website" below.
- `packages/pg-export/` (`@esg/pg-export`): a TypeScript CLI that dumps a Postgres database to one file per table plus a `schema.json`, or writes the Engineers.SG content as Markdown for Astro content collections.
- `output/backup/`: a JSON export of the production database made with that tool on 2026-10-03 (Postgres 17.9).
- `packages/db-types/` (`@esg/db-types`): row types for every table in `output/backup/schema.json`, in `src/db.ts`, and the frontmatter types of the Astro content collections in `src/content.ts` (`@esg/db-types/content`: `Video`, `Organization`, `Presenter`, `Playlist`). Each row type matches a row in the JSON dump, so timestamps are UTC text, not `Date`. It ships TypeScript source with no build step (`exports` points at the `.ts` files), so consumers must run through tsx/Vitest or type-check with `tsc`.
- `packages/yt-export/` (`@esg/yt-export`): a CLI that builds `episodes`/`playlists`/`playlist_items` rows (typed by `@esg/db-types`) from the YouTube Data API.

From the repo root:

```bash
pnpm install
pnpm test          # every package's test script
pnpm typecheck     # every package's typecheck script
pnpm build         # website (astro build) and pg-export
pnpm --filter @esg/yt-export <script>   # run one package's script from the root
```

## apps/website

An Astro 7 static site (MDX, sitemap and RSS integrations, `astro-embed` for the YouTube player) that was started from the Astro blog template. Run these from inside `apps/website/`:

```bash
pnpm dev                 # astro dev, http://localhost:4321
pnpm build               # astro build → dist/
pnpm preview
pnpm deploy              # wrangler pages deploy ./dist --project-name esg-remake (Cloudflare Pages)
pnpm deploy:production   # same, with --branch production
```

There are no tests. `HOSTNAME` sets the site URL in `astro.config.mjs` (default `http://localhost:4321`), and `.env`/`.env.production` are git-ignored. A full build makes about 17k pages in roughly 12 seconds.

- **Data:** `src/content.config.ts` defines four content collections, `video`, `organization`, `presenter` and `playlist`. Each is a glob loader over `apps/website/content/<collection>/*.md`, the Markdown written by `pg-export -f markdown` (regenerate with `pnpm --filter @esg/pg-export export --from-json ../../output/backup -o ../../apps/website/content`). The zod schemas mirror `@esg/db-types/content`. `generateId` keeps the file name (the database ID) as the entry ID, because by default the glob loader would use the frontmatter `slug`.
- **References:** relations are `reference()` ID lists. Pages resolve them with `getEntries()`: a video's `organizations`/`presenters`, and an organization's or presenter's `videos`. Descriptions are the entry `body`, shown as plain text with `white-space: pre-line` rather than rendered as Markdown.
- `src/helpers/collections.ts`: the one place that filters `active`. The files keep inactive entries (with `active: false`), but the site leaves them out entirely: no pages, no listings, no references.
  - Videos: `getActiveVideos()` is what every route that builds a page per video uses (`/video/[slug]`, `/v/[id]`, `[name]--[id]`), so an inactive video's URLs, including the old Rails ones, 404. `getListedVideos()` is the same, newest first (the glob loader has no order), and `listed()` drops inactive videos from resolved references.
  - Playlists: `getConferences()` skips inactive ones, `listedPlaylists()` drops them from resolved `subPlaylists`, and `getConferencePages()` doesn't follow into them.
  - Organizations and presenters: `getActiveOrganizations()` / `getActivePresenters()` feed all five routes of each (list, `[slug]`, `[id]`, `[name]--[id]`), so an inactive one has no page or list entry. `listedOrganizations()` / `listedPresenters()` drop them from a video's resolved links.
  - Don't call `getCollection()` directly in a page without the `active` filter: use these helpers.
  - The organization and presenter lists sort by trimmed title/name.
- **Conferences:** `/conferences/list/[page]` lists playlists with `category: "Conference"`, newest first by `publishDate` (`getConferences()`). `/conference/[slug]/[page]` is one playlist with its videos (25 per page) and links to its sub-playlists. `getConferencePages()` also builds pages for those sub-playlists (the "Conference Track" playlists), each linking back to its parent. The pages are adapted from the organization pages.
- **Routes** (all static, from `getStaticPaths`; the video, organization and presenter lists show 50 per page, and an organization's or presenter's videos 25): `/videos/[page]`, `/video/[slug]`, `/conferences/list/[page]`, `/conference/[slug]/[page]`, `/organizations/list/[page]`, `/organization/[slug]/[page]`, `/presenters/list/[page]`, `/presenter/[slug]/[page]`, plus `index` and `about`. The `index.astro` files under `/conference/[slug]`, `/organization/[slug]`, `/presenter/[slug]`, `/videos`, `/conferences`, `/organizations` and `/presenters` are thin entry points for the first page. `/v/[id]`, `/organization/[id]` and `/presenter/[id]` are old id-based URLs, with extra redirects in `astro.config.mjs`. The old Rails `<name>--<id>` URLs (`/organization/`, `/presenter/`, `/video/`) are static redirect pages from `[name]--[id].astro`, with `<name>` built by `parameterize()` (Rails' `String#parameterize`, in `src/helpers/url_helpers.ts`) from the current title. A legacy link made before a rename, such as `/organization/sg-hack-tell--184`, therefore 404s. Cloudflare's `_redirects` file is capped at 2,000 static rules, too few for about 5.2k entries, which is why these are pages.
- **Shared bits:** `src/consts.ts` (`SITE_TITLE`, `SITE_DESCRIPTION`, still the template placeholder text), `src/helpers/url_helpers.ts` (`toSlug`), and `src/components/` (`BaseHead`, `Header`, `Footer`, `HeaderLink`, `FormattedDate`, and `Pagination`, used by every paginated page). Styles are scoped per page plus `src/styles/global.css`.
- `tsconfig.json` extends `astro/tsconfigs/strict` and the root `tsconfig.base.json`.

Known problems as of this scan:
- `check_query.js` is a leftover scratch script (`pnpm check_query`) that queries Supabase, but `@supabase/supabase-js` is not a dependency and it needs `SUPABASE_URL`/`SUPABASE_KEY`. It does show the old table relationships (`episodes` ← `video_organizations`/`video_presenters`).
- `project.json` is a leftover Nx config, and the README is the unchanged Astro blog template text. Neither is used.
- Template leftovers are still in use: `about.astro` uses the `BlogPost.astro` layout, and `BaseHead` defaults its image to `/blog-placeholder-1.jpg`.

## yt-export

Run these commands from inside `packages/yt-export/`. There is no build step: the tool runs through tsx, and `tsc` is only used for type-checking.

```bash
pnpm test                                 # vitest run
pnpm exec vitest run -t "playlist_items"  # run tests matching a name
pnpm typecheck
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --playlist <PL…> -o out
pnpm export --from-raw out/raw.json       # re-run the transform only, no API calls
# Sync into the Astro content (see below); --dry-run first to see what would change
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run
pnpm export --from-raw out/raw.json --content ../../apps/website/content   # no API calls
```

- `src/youtube.ts` is a thin `fetch` client that authenticates with an API key, so it only sees public and unlisted content. Each list call costs 1 quota unit.
- `src/export.ts` runs the fetch: channel → its playlists plus any `--playlist` extras → each playlist's items → the uploads playlist (to catch videos that are in no playlist) → `videos.list` in batches of 50. It saves everything to `raw.json`.
- `src/transform.ts` is pure and holds every mapping rule; the unit tests cover it. It produces a standalone export, not a merge with `output/backup/`:
  - IDs start at 1, ordered oldest first by `publishedAt`.
  - Private and deleted videos are dropped, and unlisted ones get `active: false`.
  - `sort_order` is the YouTube position, so it can have gaps.
  - `slug` is generated from the title, and the curated fields (`website`, `hashtag`, `playlist_category_id`) are null.
- `--content <dir>` switches to syncing into the Astro content collections instead of writing the JSON tables (`--dry-run` writes nothing, `-o` is then only needed to keep `raw.json`). `src/sync.ts` is the pure planner, `src/content.ts` reads and writes the `.md` files (byte-identical to pg-export's format, so unchanged files are never rewritten), and `src/sync.test.ts` covers the rules:
  - It also fetches the playlists and videos the content already references, since many aren't on the channel (about 1,000 of the 4k videos), so their entries get refreshed too.
  - Entries are matched on `videoId` (YouTube entries only, not Vimeo) and `playlistId`. A match gets its title, description (the body) and thumbnails (playlists: `image`) refreshed. A missing YouTube thumbnail keeps the existing one. Everything else (slug, `active`, `publishDate`, `category`, `website`, organizations, presenters, …) is kept.
  - No match creates a file with the next free ID (after the highest existing one, oldest first) and a slug that is unique in the collection. New videos are `active` only if public, with empty `organizations`/`presenters`. New playlists are `active` only if public, get YouTube's creation date as `publishDate`, and have null `category`/`website`/`hashtag`. Playlists with no available videos are skipped.
  - Membership is additive: videos YouTube lists in a playlist are appended to the playlist's `videos` and the playlist is added to the video's `playlists`. Nothing is removed, so curated order and links survive.
  - Nothing is ever deleted: entries YouTube no longer returns (private or deleted) are counted in the summary and left as they are.
  - `--exclude-video <youtube-id>` (repeatable) leaves a video out entirely: it isn't created, an existing file isn't updated or reported missing, and it isn't added to playlists (a new playlist left with no videos is skipped). Use YouTube IDs, since new entries have no ID yet. An ID that matches nothing gets a warning.
- Row types and `VideoSite` come from `@esg/db-types` (a `workspace:*` dependency). Relative imports use the `.js` extension (NodeNext), which tsx and Vitest resolve to the `.ts` file.

## pg-export

Run these commands from inside `packages/pg-export/`:

```bash
pnpm build                        # tsc → dist/export.js
pnpm export --help                # run the TS source directly via tsx, no build step
node dist/export.js --app <heroku-app> -f json -o ../../output/backup   # how output/backup/ was produced
DATABASE_URL=postgres://... node dist/export.js --no-ssl -f json   # local DB
pnpm export --from-json ../../output/backup -o ../../output/content   # Markdown content collections from the JSON dump
pnpm test                         # vitest run (markdown.ts only)
pnpm typecheck                    # includes the tests (tsconfig.test.json); the build excludes them
```

There is no linter.

The CLI and the table export live in `src/export.ts`, which is ESM with NodeNext resolution and needs Node 18.3 or newer. Design points to keep:
- Everything (introspection and the data reads) runs in **one** `REPEATABLE READ READ ONLY` transaction on a single connection, so queries run one after another and all see the same snapshot. Keep new queries inside that transaction.
- CSV goes through `COPY ... TO STDOUT` (pg-copy-streams). JSON and NDJSON use a server-side cursor (pg-cursor) that reads `--batch-size` rows at a time, so large tables are streamed rather than held in memory.
- JSON output is meant to be lossless. Date and time OIDs are returned as raw Postgres text in UTC (`typeOverrides`), `bigint`/`numeric` stay as strings, and `bytea` becomes `\x…` hex.
- Heroku needs SSL with `rejectUnauthorized: false`. Any `sslmode` in the URL is stripped and SSL is set explicitly.

`-f markdown` (or `--from-json <dir>`, which implies it) is the Engineers.SG-specific mode. `src/markdown.ts` is pure and holds every mapping rule, and the unit tests cover it:
- It writes one file per row at `video/<id>.md`, `organization/<id>.md`, `presenter/<id>.md` and `playlist/<id>.md`, with frontmatter typed by `@esg/db-types/content`. The description (or `biography`) is the Markdown body, with line endings normalized.
- Entry IDs are the database IDs as strings. Relations are ID lists for Astro's `reference()`: a video's `organizations`/`presenters`/`playlists` follow join-row order, an organization's or presenter's `videos` are newest first, a playlist's `videos` follow `playlist_items.sort_order` (ties by item ID), and its `subPlaylists` follow `sub_playlists.sequence`. A playlist's `category` is the `playlist_categories` title. Join rows with nulls or dangling IDs are dropped.
- Every frontmatter value is written as JSON, which is valid YAML, so timestamps and IDs stay strings. `publishedAt` is ISO 8601 UTC.
- Slugs are generated from the title or name (organizations and playlists keep their existing `slug`) and are unique per collection, with `-2`, `-3`, ... on collisions in ID order, falling back to `<collection>-<id>` for titles with no ASCII.
- Blank strings become null. Inactive videos, playlists, organizations and presenters are kept with `active: false` (a null `active` counts as true); the site filters them. Presenter emails are null unless `--include-emails` is passed.
- The nine tables it needs (`MARKDOWN_TABLES`) are read whole (not streamed) inside the same snapshot transaction.
- The site must load these with `glob({ ..., generateId: ({ entry }) => entry.replace(/\.md$/, "") })`. By default the glob loader uses the frontmatter `slug` as the entry ID, which breaks every reference.

## output/backup/ data model

`output/backup/schema.json` is the authoritative description of the dump: columns, PKs, FKs, indexes, sequences with their current values, and per-table `file`/`rowCount`. Each `<table>.json` file is an array of row objects ordered by PK.

Core content:
- `episodes` (~4k rows) are videos. `video_id` is the external (YouTube) ID, `video_site` is an integer enum, and there are thumbnail URLs `image1..3` plus `view_count`.
- `presenters` and `organizations` link to episodes through the join tables `video_presenters` and `video_organizations`. `video_links` holds extra URLs per episode.
- `playlists` (keyed by an external `playlist_id`, with a `slug`) belong to `playlist_categories` (Conference, Meetup, Tutorial, Training, Shows, Conference Track). `playlist_items` orders episodes within a playlist. `sub_playlists` nests playlists, ordered by `sequence`.
- `tags` and `taggings` are polymorphic tags from acts-as-taggable-on (barely used). `featured_videos` and `active_admin_comments` are empty.
- `users` holds admin accounts: Devise columns (`encrypted_password`, sign-in IPs) plus OAuth `provider`/`uid`.

Only `video_links`, `video_presenters` and `video_organizations` have real FK constraints. Columns such as `playlist_items.*_id`, `playlists.playlist_category_id`, `sub_playlists.*` and `featured_videos.episode_id` are implicit Rails references with no FK, so check referential integrity before importing into a schema that enforces it.

Timestamps are `timestamp without time zone` values stored in UTC.

## Caution

`output/backup/` contains personal data (`users.json` holds password hashes and IPs, and `presenters.json` holds emails). Nothing is committed yet. Ask before committing `output/backup/`, and keep it out of anything published.
