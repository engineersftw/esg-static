# @esg/content

Shared code for the site's content files (`apps/website/content/<collection>/<id>.md`), used by `@esg/yt-export` and `@esg/cms`. It ships TypeScript source with no build step (`exports` points at `src/index.ts`), so consumers run it through tsx or Vitest, or type-check it with `tsc`.

```ts
import { readEntries, writeEntryFiles, videoEntryId, slugAllocator } from "@esg/content";
```

## What's in it

### Files (`files.ts`)

`readEntries`, `parseEntry`, `serializeEntry`, `writeEntryFiles` and `toBody`. A file is frontmatter with one `key: <JSON value>` line per field, then the description as the Markdown body. Serialization matches pg-export byte for byte, so an entry that is read and written back unchanged produces identical text, and tools never rewrite files they didn't change.

### Entry IDs (`ids.ts`)

The file name is the entry ID.

| Entries | ID | Helper |
|---|---|---|
| From the old Rails site | The database ID: `601` | `isLegacyId` |
| New videos | `yt-<YouTube ID>` (`vimeo-<ID>` for Vimeo) | `videoEntryId` |
| New playlists | `yt-<playlist ID>`, or a random ID without one | `playlistEntryId` |
| New presenters and organizations | A random ID: 10 lowercase letters and digits, starting with a letter | `randomEntryId` |

New IDs can't clash with another contributor's on another branch, and never look like numbers, so the old site's URLs (which use the numeric IDs) stay unambiguous. Also here:

- `compareIds` orders numeric IDs by number, then the rest as text. Use it instead of `Number(id)` to break ties.
- `caseClashes` finds IDs that differ only in case (YouTube IDs are case-sensitive; the file systems of macOS and Windows aren't).
- `unusedId` makes an ID that isn't taken, retrying a random one.

### Links (`links.ts`)

Each link is stored on one side only: a video lists its `organizations` and `presenters`, and a playlist lists its `videos` and `subPlaylists`. Whoever needs the other direction (an organization's videos, a video's playlists) works it out. `VIDEO_LINKS` maps a video's link kinds to collections, and `append`/`without` change an ID list without mutating it.

### Slugs (`slug.ts`)

`slugify` (the same rules as pg-export) and `slugAllocator`, which keeps slugs unique within a collection with `-2`, `-3`, … and slugifies the fallback used for titles with no ASCII.

### Profile links (`profileLinks.ts`)

Presenters' and organizations' `links` are `{ type, url }` entries with a full URL. `normalizeProfileLink(type, value)` turns a handle (with or without `@`) or a URL into the stored URL, or null if it isn't a link of that type. `detectProfileLink(value)` works out the type from the value alone, and `profileLinks` normalizes several at once.

## Tests

```bash
pnpm test        # Vitest
pnpm typecheck
```
