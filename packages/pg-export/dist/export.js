#!/usr/bin/env node
/**
 * Export a (Heroku) Postgres database to one CSV / JSON / NDJSON file per table,
 * plus a schema.json describing tables, columns, keys, indexes, enums, views and sequences.
 *
 * `--format markdown` instead writes the Engineers.SG content as Astro content collections
 * (see markdown.ts), from the database or, with --from-json, from an earlier JSON export.
 *
 * All tables are read inside one REPEATABLE READ, READ ONLY transaction, so the
 * export is a consistent snapshot even while the app keeps writing.
 */
process.env.TZ = "UTC"; // keep any Date parsing deterministic
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import Cursor from "pg-cursor";
import { to as copyTo } from "pg-copy-streams";
import { MARKDOWN_TABLES, toMarkdownFiles } from "./markdown.js";
// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const HELP = `
Usage: pg-export [options]

Connection (first match wins):
  --url <url>           Postgres connection URL
  --app <name>          Heroku app; runs \`heroku config:get <var> -a <name>\`
  --config-var <name>   Config var to read with --app (default: DATABASE_URL)
  DATABASE_URL env var

Output:
  -f, --format <fmt>    csv | json | ndjson | markdown (default: csv)
  -o, --out <dir>       Output directory (default: ./export-<timestamp>)
  -s, --schema <name>   Schema to export; repeatable (default: public)
  -t, --table <name>    Only export these tables; repeatable ("users" or "public.users")
  -x, --exclude <name>  Skip these tables; repeatable
      --schema-only     Write schema.json only, no data files
      --batch-size <n>  Rows per fetch for JSON/NDJSON (default: 5000)
      --no-ssl          Disable SSL (for a local database)
  -h, --help

Markdown (Astro content collections video/, organization/, presenter/; one <id>.md per row):
      --from-json <dir>  Read the tables from a JSON export instead of a database
                         (implies --format markdown)
      --include-emails   Write presenters' email addresses (default: email is null)
`;
const { values: args } = parseArgs({
    options: {
        url: { type: "string" },
        app: { type: "string" },
        "config-var": { type: "string", default: "DATABASE_URL" },
        format: { type: "string", short: "f" },
        out: { type: "string", short: "o" },
        schema: { type: "string", short: "s", multiple: true },
        table: { type: "string", short: "t", multiple: true },
        exclude: { type: "string", short: "x", multiple: true },
        "schema-only": { type: "boolean", default: false },
        "batch-size": { type: "string", default: "5000" },
        "no-ssl": { type: "boolean", default: false },
        "from-json": { type: "string" },
        "include-emails": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
    },
});
if (args.help) {
    console.log(HELP);
    process.exit(0);
}
const format = (args.format ?? (args["from-json"] ? "markdown" : "csv"));
if (!["csv", "json", "ndjson", "markdown"].includes(format))
    fail(`Unknown --format "${format}"`);
if (args["from-json"] && format !== "markdown")
    fail("--from-json only works with --format markdown");
const batchSize = Number(args["batch-size"]);
if (!Number.isInteger(batchSize) || batchSize <= 0)
    fail("--batch-size must be a positive integer");
const schemas = args.schema?.length ? args.schema : ["public"];
const outDir = resolve(args.out ?? `export-${new Date().toISOString().replace(/[:.]/g, "-")}`);
function fail(msg) {
    console.error(`Error: ${msg}`);
    process.exit(1);
}
function getConnectionString() {
    if (args.url)
        return args.url;
    if (args.app) {
        try {
            return execFileSync("heroku", ["config:get", args["config-var"], "-a", args.app], {
                encoding: "utf8",
            }).trim();
        }
        catch {
            fail(`Could not run "heroku config:get" for app "${args.app}". Is the Heroku CLI installed and logged in?`);
        }
    }
    if (process.env.DATABASE_URL)
        return process.env.DATABASE_URL;
    fail("No database URL. Use --url, --app, or set DATABASE_URL.");
}
// ---------------------------------------------------------------------------
// Value handling: keep values lossless in JSON
// ---------------------------------------------------------------------------
// Return date/time types as the raw Postgres text instead of JS Dates (avoids
// timezone shifts and precision loss). int8 and numeric are already strings in pg.
const RAW_TEXT_OIDS = [1082 /* date */, 1083 /* time */, 1114 /* timestamp */, 1184 /* timestamptz */, 1266 /* timetz */];
const typeOverrides = {
    getTypeParser(oid, fmt) {
        if (RAW_TEXT_OIDS.includes(oid))
            return (v) => v;
        return pg.types.getTypeParser(oid, fmt);
    },
};
function toJsonValue(v) {
    if (Buffer.isBuffer(v))
        return "\\x" + v.toString("hex"); // bytea, same form Postgres uses
    return v;
}
function rowToJson(row) {
    const out = {};
    for (const k in row)
        out[k] = toJsonValue(row[k]);
    return JSON.stringify(out);
}
// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------
const q = {
    tables: `
    SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
           c.relispartition AS is_partition,
           obj_description(c.oid, 'pg_class') AS comment,
           c.reltuples::bigint AS estimated_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1)
    ORDER BY 1, 2`,
    columns: `
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name, a.attnum AS position,
           format_type(a.atttypid, a.atttypmod) AS type, t.typname AS udt_name,
           tn.nspname AS udt_schema, NOT a.attnotnull AS nullable,
           pg_get_expr(d.adbin, d.adrelid) AS default,
           NULLIF(a.attidentity, '') AS identity, NULLIF(a.attgenerated, '') AS generated,
           col_description(c.oid, a.attnum) AS comment
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p') AND n.nspname = ANY($1)
    ORDER BY 1, 2, 4`,
    constraints: `
    SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.contype AS type,
           pg_get_constraintdef(con.oid) AS definition,
           ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.ord) AS columns,
           fn.nspname AS ref_schema, fc.relname AS ref_table,
           ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.ord) AS ref_columns,
           con.confupdtype AS on_update, con.confdeltype AS on_delete
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class fc ON fc.oid = con.confrelid
    LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
    WHERE con.contype IN ('p', 'u', 'f', 'c', 'x') AND n.nspname = ANY($1)
    ORDER BY 1, 2, 3`,
    indexes: `
    SELECT n.nspname AS schema, c.relname AS table, ic.relname AS name,
           i.indisunique AS unique, i.indisprimary AS primary,
           pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1)
    ORDER BY 1, 2, 3`,
    enums: `
    SELECT n.nspname AS schema, t.typname AS name,
           array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = ANY($1)
    GROUP BY 1, 2 ORDER BY 1, 2`,
    views: `
    SELECT n.nspname AS schema, c.relname AS name,
           CASE c.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END AS kind,
           pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm') AND n.nspname = ANY($1)
    ORDER BY 1, 2`,
    sequences: `
    SELECT schemaname AS schema, sequencename AS name, data_type::text AS data_type,
           start_value, increment_by, min_value, max_value, last_value, cycle
    FROM pg_sequences WHERE schemaname = ANY($1)
    ORDER BY 1, 2`,
    partitions: `
    SELECT cn.nspname AS schema, c.relname AS name, pn.nspname AS parent_schema, p.relname AS parent
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE c.relispartition AND cn.nspname = ANY($1)`,
};
const FK_ACTIONS = {
    a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT",
};
const key = (schema, name) => `${schema}.${name}`;
const quoteIdent = (s) => `"${s.replace(/"/g, '""')}"`;
const fileBase = (schema, name) => (schema === "public" ? name : `${schema}.${name}`).replace(/[^\w.-]/g, "_");
function matches(filters, schema, name) {
    return !!filters?.some((f) => f === name || f === key(schema, name));
}
async function introspect(client) {
    const run = (sql) => client.query(sql, [schemas]).then((r) => r.rows);
    // One connection = one query at a time (and all inside the same snapshot).
    const tables = await run(q.tables);
    const columns = await run(q.columns);
    const constraints = await run(q.constraints);
    const indexes = await run(q.indexes);
    const enums = await run(q.enums);
    const views = await run(q.views);
    const sequences = await run(q.sequences);
    const partitions = await run(q.partitions);
    const group = (rows) => {
        const m = new Map();
        for (const r of rows) {
            const k = key(r.schema, r.table);
            m.set(k, [...(m.get(k) ?? []), r]);
        }
        return m;
    };
    const colsBy = group(columns);
    const consBy = group(constraints);
    const idxBy = group(indexes);
    const parentOf = new Map(partitions.map((p) => [key(p.schema, p.name), key(p.parent_schema, p.parent)]));
    return {
        tables: tables.map((t) => {
            const k = key(t.schema, t.name);
            const cons = consBy.get(k) ?? [];
            const pk = cons.find((c) => c.type === "p");
            return {
                schema: t.schema,
                name: t.name,
                partitioned: t.kind === "p",
                partitionOf: parentOf.get(k) ?? null,
                comment: t.comment,
                columns: (colsBy.get(k) ?? []).map((c) => ({
                    name: c.name,
                    position: c.position,
                    type: c.type,
                    udtName: c.udt_name,
                    udtSchema: c.udt_schema,
                    nullable: c.nullable,
                    default: c.default,
                    identity: c.identity === "a" ? "ALWAYS" : c.identity === "d" ? "BY DEFAULT" : null,
                    generated: c.generated === "s" ? "STORED" : null,
                    comment: c.comment,
                })),
                primaryKey: pk ? { name: pk.name, columns: pk.columns } : null,
                foreignKeys: cons.filter((c) => c.type === "f").map((c) => ({
                    name: c.name,
                    columns: c.columns,
                    references: { schema: c.ref_schema, table: c.ref_table, columns: c.ref_columns },
                    onUpdate: FK_ACTIONS[c.on_update],
                    onDelete: FK_ACTIONS[c.on_delete],
                })),
                uniqueConstraints: cons.filter((c) => c.type === "u").map((c) => ({ name: c.name, columns: c.columns })),
                checkConstraints: cons.filter((c) => c.type === "c").map((c) => ({ name: c.name, definition: c.definition })),
                exclusionConstraints: cons.filter((c) => c.type === "x").map((c) => ({ name: c.name, definition: c.definition })),
                indexes: (idxBy.get(k) ?? []).map((i) => ({
                    name: i.name, unique: i.unique, primary: i.primary, definition: i.definition,
                })),
                estimatedRows: Number(t.estimated_rows),
            };
        }),
        enums,
        views,
        sequences,
    };
}
// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------
async function exportCsv(client, sql, path) {
    // COPY handles quoting, NULLs, newlines, arrays, bytea etc. natively and is very fast.
    const stream = client.query(copyTo(`COPY (${sql}) TO STDOUT WITH (FORMAT csv, HEADER true)`));
    await pipeline(stream, createWriteStream(path));
    return stream.rowCount;
}
async function exportJson(client, sql, path, ndjson) {
    const out = createWriteStream(path);
    const write = async (s) => {
        if (!out.write(s))
            await once(out, "drain");
    };
    const cursor = client.query(new Cursor(sql, [], { types: typeOverrides }));
    let count = 0;
    try {
        if (!ndjson)
            await write("[");
        for (;;) {
            const rows = await cursor.read(batchSize);
            if (rows.length === 0)
                break;
            for (const row of rows) {
                const line = rowToJson(row);
                if (ndjson)
                    await write(line + "\n");
                else
                    await write((count === 0 ? "\n  " : ",\n  ") + line);
                count++;
            }
        }
        if (!ndjson)
            await write(count ? "\n]\n" : "]\n");
    }
    finally {
        await cursor.close();
        out.end();
        await once(out, "finish");
    }
    return count;
}
// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------
// These tables are small (a few thousand rows), so they are read whole rather than streamed.
async function readMarkdownTables(client) {
    const src = {};
    for (const table of MARKDOWN_TABLES) {
        const sql = `SELECT * FROM ${quoteIdent(schemas[0])}.${quoteIdent(table)} ORDER BY id`;
        src[table] = (await client.query({ text: sql, types: typeOverrides })).rows;
    }
    return src;
}
function readJsonExport(dir) {
    const src = {};
    for (const table of MARKDOWN_TABLES)
        src[table] = JSON.parse(readFileSync(join(dir, `${table}.json`), "utf8"));
    return src;
}
function writeMarkdown(src) {
    const files = toMarkdownFiles(src, { includeEmails: args["include-emails"] });
    const counts = {};
    for (const f of files) {
        const path = join(outDir, f.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, f.content);
        const collection = f.path.split("/")[0];
        counts[collection] = (counts[collection] ?? 0) + 1;
    }
    for (const [collection, n] of Object.entries(counts))
        console.log(`- ${collection}: ${n} files`);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    if (args["from-json"]) {
        writeMarkdown(readJsonExport(resolve(args["from-json"])));
        console.log(`\nDone → ${outDir}`);
        return;
    }
    const url = new URL(getConnectionString());
    const sslmode = url.searchParams.get("sslmode");
    url.searchParams.delete("sslmode"); // we set SSL explicitly below
    const useSsl = !args["no-ssl"] && sslmode !== "disable";
    const client = new pg.Client({
        connectionString: url.toString(),
        // Heroku Postgres requires SSL but uses certificates that don't validate against a public CA.
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        application_name: "pg-export",
    });
    client.on("error", (e) => fail(e.message));
    await client.connect();
    const started = Date.now();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query("SET LOCAL statement_timeout = 0");
        if (format === "markdown") {
            const src = await readMarkdownTables(client);
            await client.query("COMMIT");
            writeMarkdown(src);
            console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s → ${outDir}`);
            return;
        }
        const schema = await introspect(client);
        let tables = schema.tables;
        if (args.table?.length)
            tables = tables.filter((t) => matches(args.table, t.schema, t.name));
        if (args.exclude?.length)
            tables = tables.filter((t) => !matches(args.exclude, t.schema, t.name));
        if (tables.length === 0)
            console.warn(`No tables found in schema(s): ${schemas.join(", ")}`);
        mkdirSync(outDir, { recursive: true });
        const ext = format === "ndjson" ? "ndjson" : format;
        const exported = {};
        if (!args["schema-only"]) {
            for (const t of tables) {
                const k = key(t.schema, t.name);
                // Partitions' rows are already included when their parent is exported.
                if (t.partitionOf && tables.some((p) => key(p.schema, p.name) === t.partitionOf)) {
                    console.log(`- ${k}: skipped (partition of ${t.partitionOf})`);
                    exported[k] = { file: null, rowCount: null };
                    continue;
                }
                const file = `${fileBase(t.schema, t.name)}.${ext}`;
                const cols = t.columns.map((c) => quoteIdent(c.name)).join(", ") || "*";
                const orderBy = t.primaryKey ? ` ORDER BY ${t.primaryKey.columns.map(quoteIdent).join(", ")}` : "";
                const sql = `SELECT ${cols} FROM ${quoteIdent(t.schema)}.${quoteIdent(t.name)}${orderBy}`;
                const t0 = Date.now();
                process.stdout.write(`- ${k} ... `);
                const rows = format === "csv"
                    ? await exportCsv(client, sql, join(outDir, file))
                    : await exportJson(client, sql, join(outDir, file), format === "ndjson");
                console.log(`${rows} rows (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
                exported[k] = { file, rowCount: rows };
            }
        }
        await client.query("COMMIT");
        const schemaDoc = {
            exportedAt: new Date().toISOString(),
            database: url.pathname.replace(/^\//, ""),
            serverVersion: (await client.query("SHOW server_version")).rows[0].server_version,
            format: args["schema-only"] ? null : format,
            schemas,
            tables: tables.map((t) => ({
                ...t,
                file: exported[key(t.schema, t.name)]?.file ?? null,
                rowCount: exported[key(t.schema, t.name)]?.rowCount ?? null,
            })),
            enums: schema.enums,
            views: schema.views,
            sequences: schema.sequences,
        };
        writeFileSync(join(outDir, "schema.json"), JSON.stringify(schemaDoc, null, 2) + "\n");
        console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s → ${outDir}`);
    }
    catch (e) {
        await client.query("ROLLBACK").catch(() => { });
        throw e;
    }
    finally {
        await client.end();
    }
}
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
