# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This is the rebuild of Engineers.SG. The repo holds the new Astro site (`apps/website`), the data from the existing site (a Rails app on Heroku Postgres, with ActiveAdmin and Devise, going by its tables) and the tools used to export it.

It is a pnpm workspace (`pnpm-workspace.yaml` → `apps/*` and `packages/*`, pnpm 10, Node 22.12+ for Astro 7). Shared compiler options live in `tsconfig.base.json`, which each package's `tsconfig.json` extends.

ESLint is configured once for the whole repo in the root `eslint.config.js` (flat config: `@eslint/js` and typescript-eslint recommended, plus eslint-plugin-astro for the site; Cloudflare `functions/` get Workers globals instead of Node's). The packages compile with TypeScript 7, which has no JavaScript API, so typescript-eslint uses the TypeScript 6.0 installed at the root; that is why the root `typescript` is pinned to `~6.0` while each package depends on `typescript@^7`. Keep it that way until typescript-eslint supports TypeScript 7. The website likewise depends on `typescript@~6.0`, because `astro check` (`@astrojs/check`) supports TypeScript 5 and 6 only. Rules are syntax-only, not type-aware, so they don't depend on the TypeScript version matching.

- `output/` (git-ignored): generated data. `output/backup/` is below; yt-export runs also land here (e.g. `-o ../../output/yt-export-<timestamp>`).
- `apps/website/` (`esg-website`): the Astro site, described under "apps/website" below.
- `packages/pg-export/` (`@esg/pg-export`): a TypeScript CLI that dumps a Postgres database to one file per table plus a `schema.json`, or writes the Engineers.SG content as Markdown for Astro content collections.
- `output/backup/`: a JSON export of the production database made with that tool on 2026-10-03 (Postgres 17.9).
- `packages/db-types/` (`@esg/db-types`): row types for every table in `output/backup/schema.json`, in `src/db.ts`, and the frontmatter types of the Astro content collections in `src/content.ts` (`@esg/db-types/content`: `Video`, `Organization`, `Presenter`, `Playlist`). Each row type matches a row in the JSON dump, so timestamps are UTC text, not `Date`. It ships TypeScript source with no build step (`exports` points at the `.ts` files), so consumers must run through tsx/Vitest or type-check with `tsc`.
- `packages/yt-export/` (`@esg/yt-export`): a CLI that builds `episodes`/`playlists`/`playlist_items` rows (typed by `@esg/db-types`) from the YouTube Data API.
- `packages/content/` (`@esg/content`): shared code for the content `.md` files: reading and writing them (`files.ts`, byte-identical to pg-export's format), `slugify`/`slugAllocator` (`slug.ts`), and the two-sided link helpers (`links.ts`). TypeScript source with no build step, like `@esg/db-types`.
- `packages/cms/` (`@esg/cms`): a CLI that edits the content: create presenters, and assign videos to presenters, organizations and playlists.

From the repo root:

```bash
pnpm install
pnpm test          # every package's test script
pnpm typecheck     # every package's typecheck script
pnpm lint          # ESLint over the whole repo (pnpm lint:fix to autofix)
pnpm build         # website (astro build) and pg-export
pnpm --filter @esg/yt-export <script>   # run one package's script from the root
pnpm cms --help    # the content editor (see "cms" below)
```

`.github/workflows/ci.yml` runs `pnpm lint`, `pnpm typecheck` and `pnpm test` as three checks (`lint`, `typecheck`, `test`) on every pull request and push to `main`, after a `--frozen-lockfile` install, so a stale `pnpm-lock.yaml` fails too. `.github/workflows/sync-youtube.yml` is the daily yt-export sync (see `SYNC_YOUTUBE.md` next to it).

## apps/website

An Astro 7 static site (MDX, sitemap and RSS integrations, `astro-embed` for the YouTube player) that was started from the Astro blog template. Run these from inside `apps/website/`:

```bash
pnpm dev                 # astro dev, http://localhost:4321
pnpm build               # astro build → dist/
pnpm preview
pnpm run deploy          # wrangler pages deploy ./dist --project-name esg-remake (Cloudflare Pages)
pnpm deploy:production   # same, with --branch production
```

The Cloudflare Pages project builds from GitHub, with root directory `apps/website` and output directory `dist`. The root directory matters: Cloudflare only finds `functions/` (the legacy redirects) in the root directory. Wrangler likewise compiles `functions/` from its working directory, so deploy by hand from `apps/website`. `pnpm deploy` is a pnpm built-in, so use `pnpm run deploy` for the preview script. `HOSTNAME` and `PUBLIC_GTM_ID` are build-time variables, so they belong in the Pages project's environment settings.

There are no tests. `pnpm typecheck` runs `astro check` (it is part of the root `pnpm typecheck` and CI). Pages with `getStaticPaths` declare it as `export const getStaticPaths = (async (…) => {…}) satisfies GetStaticPaths` with `type Props = InferGetStaticPropsType<typeof getStaticPaths>`, so `Astro.props` is typed. `HOSTNAME` sets the site URL in `astro.config.mjs` (default `http://localhost:4321`), and `.env`/`.env.production` are git-ignored. A full build makes about 7k pages (7.1k files) in roughly 10 seconds. Cloudflare Pages allows at most 20,000 files per deployment, so don't add routes that make a page per entry just to redirect.

- **Data:** `src/content.config.ts` defines four content collections, `video`, `organization`, `presenter` and `playlist`. Each is a glob loader over `apps/website/content/<collection>/*.md`, the Markdown written by `pg-export -f markdown` (regenerate with `pnpm --filter @esg/pg-export export --from-json ../../output/backup -o ../../apps/website/content`). The zod schemas mirror `@esg/db-types/content`. `generateId` keeps the file name (the database ID) as the entry ID, because by default the glob loader would use the frontmatter `slug`.
- **References:** relations are `reference()` ID lists. Pages resolve them with `getEntries()`: a video's `organizations`/`presenters`, and an organization's or presenter's `videos`. Descriptions are the entry `body`, shown as plain text with `white-space: pre-line` rather than rendered as Markdown.
- `src/helpers/collections.ts`: the one place that filters `active`. The files keep inactive entries (with `active: false`), but the site leaves them out entirely: no pages, no listings, no references.
  - Videos: `getActiveVideos()` is what every route that builds a page per video uses (`/video/[slug]`, `legacy-redirects.json`, and `/feed` through `getListedVideos()`), so an inactive video's URLs, including the old Rails ones, 404. `getListedVideos()` is the same, newest first (the glob loader has no order), and `listed()` drops inactive videos from resolved references.
  - Playlists: `getConferences()` skips inactive ones, `listedPlaylists()` drops them from resolved `subPlaylists`, `getConferencePages()` doesn't follow into them, and `getPlaylistPages()` only returns active ones.
  - Organizations and presenters: `getActiveOrganizations()` / `getActivePresenters()` feed every route of each (list, `[slug]`, and `legacy-redirects.json`), so an inactive one has no page, list entry or legacy redirect. `listedOrganizations()` / `listedPresenters()` drop them from a video's resolved links.
  - Don't call `getCollection()` directly in a page without the `active` filter: use these helpers.
  - The organization and presenter lists sort by trimmed title/name.
- **Conferences and playlists:** `/conferences/list/[page]` lists playlists with `category: "Conference"`, newest first by `publishDate` (`getConferences()`). `/conference/[slug]/[page]` is one playlist with its videos (25 per page) and links to its sub-playlists. `getConferencePages()` also builds pages for those sub-playlists (the "Conference Track" playlists), each linking back to its parent. Every other active playlist (meetups, uncategorised) gets the same page at `/playlist/[slug]/[page]` (`getPlaylistPages()`). `/playlist/<slug>` of a conference or track redirects to its `/conference` page, so each playlist has one canonical page. Both routes render `src/components/PlaylistPage.astro`, which is adapted from the organization page; `basePath` sets the prefix of the parent and sub-playlist links.
- **Routes** (all static, from `getStaticPaths`; the video, organization and presenter lists show 50 per page, and an organization's or presenter's videos 25): `/videos/[page]`, `/video/[slug]`, `/conferences/list/[page]`, `/conference/[slug]/[page]`, `/playlist/[slug]/[page]`, `/organizations/list/[page]`, `/organization/[slug]/[page]`, `/presenters/list/[page]`, `/presenter/[slug]/[page]`, plus `index`, `about`, `/feed` and `404`. The `index.astro` files under `/conference/[slug]`, `/organization/[slug]`, `/presenter/[slug]`, `/videos`, `/conferences`, `/organizations` and `/presenters` are thin entry points for the first page. `/episodes` → `/videos` is the only redirect in `astro.config.mjs`. Internal links always use slug URLs (`/video/<slug>`, `/organization/<slug>`, `/presenter/<slug>`), never the ID forms.
- **Old Rails URLs** are a Cloudflare Pages Function, `functions/_middleware.ts`, not pages. Static redirect pages for them (about 21k files) took the deployment past Cloudflare's 20,000-file limit.
  - It sends a 301 for `/v/:id`, `/:id`, `/episodes/:id`, `/video/<anything>--:id`, `/organization/:id`, `/organizations/:id`, `/org/:id`, `/o/:id`, `/organization/<anything>--:id`, `/organizations/<slug>`, `/presenter/:id`, `/presenters/:id`, `/s/:id` and `/presenter/<anything>--:id` to the slug URL, keeping the query string. Only the ID matters in `name--id` (as in Rails), so links made before a rename work.
  - The ID → slug map is `src/pages/legacy-redirects.json.ts` (active entries only), built to `dist/legacy-redirects.json` and **imported by the function**. Wrangler bundles it when it builds the function, so always run `astro build` before `wrangler pages deploy`/`dev`. A path that doesn't match, or names an unknown or inactive ID, falls through to the static site (and so the 404 page).
  - `public/_routes.json` includes `/*` (needed for the top-level `/:id` shortcut) and excludes paths that can never match (assets, lists, conference and playlist pages, the feed). The excludes only save function invocations: a path missing from them still works. Function requests count against the Workers quota (100k/day on the free plan), while static asset requests are free.
  - Test locally with `pnpm build && pnpm exec wrangler pages dev ./dist` (port 8788). `pnpm preview` doesn't run functions. `.wrangler/` is its git-ignored local state.
- **404:** `src/pages/404.astro`. Without it, Cloudflare Pages serves the home page with a 200 for every missing path.
- **Feed:** `src/pages/feed.ts` is the old Rails `/feed` URL, now RSS 2.0 (`@astrojs/rss`), with the 50 newest active videos. It is a file with no extension, so `public/_headers` sets its Cloudflare content type. Its links come from `site`, so builds for deploy need `HOSTNAME`, or they point at localhost.
- **Analytics:** Google Tag Manager is in `src/components/GoogleTagManager.astro`, which renders only when `PUBLIC_GTM_ID` (e.g. `GTM-ABC1234`) is set at build time, so dev and preview builds stay untracked. A malformed ID fails the build. `BaseHead` renders the loader script after the charset and viewport tags, and `Header` renders the `<noscript>` iframe. That works because every page's `<body>` starts with `<Header />`, so keep it that way on new pages.
- **Shared bits:** `src/consts.ts` (`SITE_TITLE`, `SITE_DESCRIPTION`, still the template placeholder text), `src/helpers/url_helpers.ts` (`toSlug`), and `src/components/` (`BaseHead`, `Header`, `Footer`, `HeaderLink`, `FormattedDate`, `Pagination`, used by every paginated page, and `EntityImage`, which every organization logo and presenter photo goes through: it shows `public/placeholder-{organization,presenter}.svg` when the URL is null or fails to load, via an inline `onerror`, since many old Twitter image URLs now 404). Styles are scoped per page plus `src/styles/global.css`.
- `tsconfig.json` extends the root `tsconfig.base.json` and then `astro/tsconfigs/strict`. Keep that order: the later one wins, and the base's `NodeNext` module settings would otherwise replace Astro's `Bundler` resolution (making every extensionless relative import an error).

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
  - After that, every playlist↔video link in the whole content is made two-way (`reconcileLinks`), including links made by hand on one side and entries that weren't fetched (counted as `linked` in the summary). Excluded videos are left alone.
  - Nothing is ever deleted. `raw.json` records which IDs were requested (`requested`), so an existing entry is either *not returned* (asked about, absent: private or deleted on YouTube) or *not fetched* (never asked, state unknown). The summary lists the published ones among the not-returned, and `--deactivate-missing` sets `active: false` on those (never on not-fetched ones), so a private video isn't shown. Older `raw.json` files lack `requested`: then a video counts as asked about if it is in a fetched playlist (a private one shows up there as "Private video").
  - Only a run with `--channel` and an API key fetches the content's own videos and playlists. A `raw.json` from a run without `--content` leaves most of them "not fetched", so check the summary before trusting it.
  - `--exclude-video <youtube-id>` (repeatable) leaves a video out entirely: it isn't created, an existing file isn't updated or reported missing, and it isn't added to playlists (a new playlist left with no videos is skipped). Use YouTube IDs, since new entries have no ID yet. An ID that matches nothing gets a warning.
- The `.md` reading and writing and `slugify` come from `@esg/content`. Row types and `VideoSite` come from `@esg/db-types` (a `workspace:*` dependency). Relative imports use the `.js` extension (NodeNext), which tsx and Vitest resolve to the `.ts` file.

## cms

Run it from the repo root with `pnpm cms <command>` (or `pnpm cms` inside `packages/cms/`). It runs through tsx; `pnpm test` and `pnpm typecheck` work as in yt-export.

```bash
pnpm cms find presenter yeo                  # look up IDs: find <video|presenter|organization|playlist> <text>
pnpm cms presenter create --name "Jane Doe" --twitter @jane --video 4517 --dry-run
pnpm cms assign --video 4517 --presenter jane-doe --organization 111 --playlist pyconsg-2019
pnpm cms unassign --video 4517 --playlist 1
pnpm cms check [--fix]                       # one-sided links in any relation
```

- `src/cms.ts` is pure (the `Cms` class works on an in-memory copy, and `changes()` returns the files to write), and `src/cms.test.ts` covers it. `src/cli.ts` does the argument parsing and I/O. `--content` defaults to `apps/website/content`; relative paths resolve against where `pnpm` was run (`INIT_CWD`).
- A `<ref>` is an entry ID, slug, site URL or path, a YouTube video ID or URL (videos) or a YouTube playlist ID (playlists). An ambiguous or unknown ref fails the whole command before anything is written.
- Every link is written on both sides: the video's `presenters`/`organizations`/`playlists` get the ID appended, a playlist's `videos` gets the video appended, and an organization's or presenter's `videos` gets it inserted newest first by `publishedAt`. Linking to an inactive entry warns, since the site won't show it.
- `presenter create` takes the next free ID and a unique slug from the name (or `--slug`), strips `@` from `--twitter`, and refuses a name another presenter already has unless `--allow-duplicate`.
- Only changed files are written, in the same format as pg-export, so they diff cleanly.

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
