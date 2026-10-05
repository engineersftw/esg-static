/**
 * Read and write the Astro content collection files that pg-export produces
 * (`<collection>/<id>.md`): frontmatter with one `key: <JSON value>` line per field, then the
 * description as the Markdown body. Serialization matches pg-export byte for byte, so an entry that
 * is parsed and serialized unchanged produces identical text.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Collection } from "@esg/db-types/content";

export interface Entry<T extends object = Record<string, unknown>> {
  /** File name without `.md`: the database ID, also the collection entry ID. */
  id: string;
  /** Relative to the content directory, e.g. "video/4442.md". */
  path: string;
  data: T;
  body: string;
  /** The file as it was read, to detect whether a rewrite changes anything. */
  text: string;
}

/** Normalize line endings and trim; "" for null. */
export function toBody(text: string | null): string {
  return (text ?? "").replace(/\r\n?/g, "\n").trim();
}

export function serializeEntry(data: object, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const text = toBody(body);
  return `---\n${lines.join("\n")}\n---\n${text ? `\n${text}\n` : ""}`;
}

export function parseEntry<T extends object = Record<string, unknown>>(path: string, text: string): Entry<T> {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${path}: missing frontmatter`);
  const data: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) throw new Error(`${path}: unexpected frontmatter line "${line}"`);
    try {
      data[line.slice(0, i)] = JSON.parse(line.slice(i + 2));
    } catch {
      throw new Error(`${path}: frontmatter value is not JSON: "${line}"`);
    }
  }
  return {
    id: path.replace(/^.*\//, "").replace(/\.md$/, ""),
    path,
    data: data as T,
    body: toBody(m[2]),
    text,
  };
}

/** Every entry of one collection, in file name order; an absent collection directory is empty. */
export function readEntries<T extends object = Record<string, unknown>>(contentDir: string, collection: Collection): Entry<T>[] {
  let files: string[];
  try {
    files = readdirSync(join(contentDir, collection));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return files
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const path = `${collection}/${f}`;
      return parseEntry<T>(path, readFileSync(join(contentDir, path), "utf8"));
    });
}

export function writeEntryFiles(contentDir: string, files: { path: string; content: string }[]) {
  for (const f of files) {
    const target = join(contentDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
}
