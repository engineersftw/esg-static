# heroku-pg-export

Exports a Heroku Postgres database to **one file per table** (CSV, JSON, or NDJSON) plus a `schema.json` describing the schema.

## Setup

```bash
pnpm install         # from the repo root (pnpm workspace)
pnpm build           # or skip and use `pnpm export ...` (runs via tsx)
```

## Usage

```bash
# Using the Heroku CLI to fetch DATABASE_URL
node dist/export.js --app my-heroku-app

# Or pass the URL directly / via env
DATABASE_URL=postgres://... node dist/export.js -f json -o ./output/backup

# Several schemas, only some tables
node dist/export.js --app my-app -s public -s billing -t users -t billing.invoices

# Schema only
node dist/export.js --app my-app --schema-only
```

| Option | Description |
|---|---|
| `--url`, `--app`, `--config-var` | Connection source (falls back to `DATABASE_URL`) |
| `-f, --format` | `csv` (default), `json`, `ndjson` |
| `-o, --out` | Output directory (default `./export-<timestamp>`) |
| `-s, --schema` | Schema(s) to export (default `public`) |
| `-t, --table` / `-x, --exclude` | Include / exclude tables (`name` or `schema.name`) |
| `--schema-only` | Only write `schema.json` |
| `--batch-size` | Rows per fetch for JSON/NDJSON (default 5000) |
| `--no-ssl` | For a local database |

## Markdown (Engineers.SG content)

```bash
pnpm export -f markdown --app my-app -o ../../output/content         # from the database
node dist/export.js --from-json ../../output/backup -o ../../output/content   # from a JSON export
```

`-f markdown` writes Astro content collections instead of table dumps: `video/<id>.md`, `organization/<id>.md`, `presenter/<id>.md` and `playlist/<id>.md`. It reads `episodes`, `organizations`, `presenters`, `playlists`, `playlist_categories`, `playlist_items`, `sub_playlists`, `video_organizations` and `video_presenters` (in the first `--schema`) in the same snapshot transaction. `--from-json <dir>` reads those tables from an earlier `-f json` export and needs no database.

Frontmatter types are in `@esg/db-types/content`. Relations are ID lists (`organizations`/`presenters`/`playlists` on a video; `videos`, newest first, on an organization or presenter; `videos` in playlist order and `subPlaylists` on a playlist) for Astro's `reference()`, and each description becomes the Markdown body. Presenter emails are written as `null` unless you pass `--include-emails`. Existing files in the output directory are overwritten but never deleted.

## Output

```
export-2026-09-30T.../
  schema.json
  users.csv
  posts.csv
  billing.invoices.csv     # non-public schemas are prefixed
```

`schema.json` contains, per table: columns (type, nullability, default, identity/generated, comments), primary key, foreign keys (with ON UPDATE/DELETE), unique/check/exclusion constraints, index definitions, partition info, the output file name and exported row count. It also lists enums, views/materialized views (with SQL), and sequences (with current values).

## Notes

- **Consistent snapshot:** everything runs in one `REPEATABLE READ READ ONLY` transaction, so tables are exported as of the same moment even while the app is writing.
- **Streaming:** CSV uses Postgres `COPY ... TO STDOUT` (fast, correct escaping); JSON uses a server-side cursor. Large tables won't blow up memory.
- **Lossless values in JSON:** `bigint` and `numeric` are strings (no precision loss), dates/timestamps are the raw Postgres text in UTC, `bytea` is `\x…` hex, `json/jsonb` are nested objects, arrays are JSON arrays.
- Rows are ordered by primary key when one exists.
- Partitions are skipped when their parent table is exported (the parent already contains their rows).
- For big production DBs, consider pointing `--url` at a Heroku follower database to keep load off the primary.
