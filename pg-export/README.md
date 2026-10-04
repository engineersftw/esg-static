# heroku-pg-export

Exports a Heroku Postgres database to **one file per table** (CSV, JSON, or NDJSON) plus a `schema.json` describing the schema.

## Setup

```bash
npm install
npm run build        # or skip and use `npm run export -- ...` (runs via tsx)
```

## Usage

```bash
# Using the Heroku CLI to fetch DATABASE_URL
node dist/export.js --app my-heroku-app

# Or pass the URL directly / via env
DATABASE_URL=postgres://... node dist/export.js -f json -o ./backup

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
