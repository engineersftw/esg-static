# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

There is no application here yet. The repo holds the data from the existing Engineers.SG site (a Rails app on Heroku Postgres, with ActiveAdmin and Devise, going by its tables) and the tools used to export it.

It is a pnpm workspace (`pnpm-workspace.yaml` → `packages/*`, pnpm 10, Node 20+). Shared compiler options live in `tsconfig.base.json`, which each package's `tsconfig.json` extends.

- `output/` (git-ignored): generated data. `output/backup/` is below; yt-export runs also land here (e.g. `-o ../../output/yt-export-<timestamp>`).
- `packages/pg-export/` (`@esg/pg-export`): a standalone TypeScript CLI that dumps a Postgres database to one file per table plus a `schema.json`.
- `output/backup/`: a JSON export of the production database made with that tool on 2026-10-03 (Postgres 17.9).
- `packages/db-types/` (`@esg/db-types`): row types for every table in `output/backup/schema.json`, in `src/db.ts`. Each type matches a row in the JSON dump, so timestamps are UTC text, not `Date`. It ships TypeScript source with no build step (`exports` points at `src/db.ts`), so consumers must run through tsx/Vitest or type-check with `tsc`.
- `packages/yt-export/` (`@esg/yt-export`): a CLI that builds `episodes`/`playlists`/`playlist_items` rows (typed by `@esg/db-types`) from the YouTube Data API.

From the repo root:

```bash
pnpm install
pnpm test          # every package's test script
pnpm typecheck     # every package's typecheck script
pnpm build         # pg-export only
pnpm --filter @esg/yt-export <script>   # run one package's script from the root
```

## yt-export

Run these commands from inside `packages/yt-export/`. There is no build step: the tool runs through tsx, and `tsc` is only used for type-checking.

```bash
pnpm test                                 # vitest run
pnpm exec vitest run -t "playlist_items"  # run tests matching a name
pnpm typecheck
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --playlist <PL…> -o out
pnpm export --from-raw out/raw.json       # re-run the transform only, no API calls
```

- `src/youtube.ts` is a thin `fetch` client that authenticates with an API key, so it only sees public and unlisted content. Each list call costs 1 quota unit.
- `src/export.ts` runs the fetch: channel → its playlists plus any `--playlist` extras → each playlist's items → the uploads playlist (to catch videos that are in no playlist) → `videos.list` in batches of 50. It saves everything to `raw.json`.
- `src/transform.ts` is pure and holds every mapping rule; the unit tests cover it. It produces a standalone export, not a merge with `output/backup/`:
  - IDs start at 1, ordered oldest first by `publishedAt`.
  - Private and deleted videos are dropped, and unlisted ones get `active: false`.
  - `sort_order` is the YouTube position, so it can have gaps.
  - `slug` is generated from the title, and the curated fields (`website`, `hashtag`, `playlist_category_id`) are null.
- Row types and `VideoSite` come from `@esg/db-types` (a `workspace:*` dependency). Relative imports use the `.js` extension (NodeNext), which tsx and Vitest resolve to the `.ts` file.

## pg-export

Run these commands from inside `packages/pg-export/`:

```bash
pnpm build                        # tsc → dist/export.js
pnpm export --help                # run the TS source directly via tsx, no build step
node dist/export.js --app <heroku-app> -f json -o ../../output/backup   # how output/backup/ was produced
DATABASE_URL=postgres://... node dist/export.js --no-ssl -f json   # local DB
```

There are no tests and no linter. Type-check with `pnpm typecheck`.

All of the logic lives in `src/export.ts`, which is ESM with NodeNext resolution and needs Node 18.3 or newer. Design points to keep:
- Everything (introspection and the data reads) runs in **one** `REPEATABLE READ READ ONLY` transaction on a single connection, so queries run one after another and all see the same snapshot. Keep new queries inside that transaction.
- CSV goes through `COPY ... TO STDOUT` (pg-copy-streams). JSON and NDJSON use a server-side cursor (pg-cursor) that reads `--batch-size` rows at a time, so large tables are streamed rather than held in memory.
- JSON output is meant to be lossless. Date and time OIDs are returned as raw Postgres text in UTC (`typeOverrides`), `bigint`/`numeric` stay as strings, and `bytea` becomes `\x…` hex.
- Heroku needs SSL with `rejectUnauthorized: false`. Any `sslmode` in the URL is stripped and SSL is set explicitly.

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
