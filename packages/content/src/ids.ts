/**
 * Entry IDs, which are also the file names (`<collection>/<id>.md`). Entries from the Rails site
 * keep their database IDs ("4442"). Newer ones get IDs that two contributors working on separate
 * branches can't both pick for different things:
 *
 * - a video: its site and external ID, `yt-<YouTube ID>` (or `vimeo-<ID>`), so the same talk added
 *   twice makes the same file and git reports it;
 * - a playlist: `yt-<YouTube playlist ID>`, or a random ID when it has no YouTube playlist;
 * - a presenter or organization: a random ID, since names change and repeat.
 *
 * A new ID never looks like a number, so it can't be mistaken for a Rails ID.
 */
import { randomInt } from "node:crypto";
import type { Video } from "@esg/db-types/content";

/** True for an ID from the Rails site: digits only. */
export const isLegacyId = (id: string) => /^\d+$/.test(id);

/** Entry IDs in order: legacy IDs by number, then the others as text. */
export function compareIds(a: string, b: string): number {
  const [legacyA, legacyB] = [isLegacyId(a), isLegacyId(b)];
  if (legacyA && legacyB) return Number(a) - Number(b);
  if (legacyA !== legacyB) return legacyA ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

const VIDEO_PREFIX: Record<Video["videoSite"], string> = { youtube: "yt", vimeo: "vimeo" };

/** The ID of a new video entry: `yt-<YouTube ID>` or `vimeo-<Vimeo ID>`. */
export const videoEntryId = (site: Video["videoSite"], externalId: string) => `${VIDEO_PREFIX[site]}-${externalId}`;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const CHARS = `${LETTERS}0123456789`;

/** A random ID: 10 lowercase letters and digits, starting with a letter ("k3v9qz2m7d"). */
export function randomEntryId(): string {
  let id = LETTERS[randomInt(LETTERS.length)];
  while (id.length < 10) id += CHARS[randomInt(CHARS.length)];
  return id;
}

/** The ID of a new playlist entry: `yt-<YouTube playlist ID>`, or a random ID without one. */
export const playlistEntryId = (playlistId: string | null | undefined) =>
  playlistId ? `yt-${playlistId}` : randomEntryId();

/**
 * Groups of IDs that differ only in case. YouTube IDs are case-sensitive but the file systems of
 * macOS and Windows aren't, so two such files would overwrite each other there.
 */
export function caseClashes(ids: Iterable<string>): string[][] {
  const byKey = new Map<string, string[]>();
  for (const id of ids) {
    const key = id.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

/**
 * A new ID from `make` that no entry in `taken` has, ignoring case. `make` is retried a few times,
 * which only matters for random IDs; a fixed ID that is taken throws.
 */
export function unusedId(make: () => string, taken: Iterable<string>, what: string): string {
  const used = new Set([...taken].map((id) => id.toLowerCase()));
  for (let i = 0; i < 5; i++) {
    const id = make();
    if (!used.has(id.toLowerCase())) return id;
  }
  throw new Error(`there is already ${what}`);
}
