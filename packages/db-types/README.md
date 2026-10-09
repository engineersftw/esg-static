# @esg/db-types

Shared TypeScript types, with no build step: `exports` points at the `.ts` source, which tsx, Vitest and `tsc` read directly.

```ts
import type { Episode } from "@esg/db-types";
import type { Video, Presenter, ProfileLink } from "@esg/db-types/content";
```

## `@esg/db-types` (`src/db.ts`)

One interface per table in the old Rails database (`Episode`, `Organization`, `Presenter`, `Playlist`, `PlaylistItem`, …), matching the rows in the JSON export (`output/backup/*.json`, described by its `schema.json`). Each type matches a row as dumped, so:

- timestamps are UTC text (`"2015-05-07 15:32:29.127974"`), not `Date`;
- `bigint` and `numeric` columns are strings.

`VideoSite` holds the integer values of `episodes.video_site`. pg-export and yt-export's standalone export use these types.

## `@esg/db-types/content` (`src/content.ts`)

The frontmatter of the site's content files, one interface per collection: `Video`, `Organization`, `Presenter` and `Playlist`, plus `ProfileLink`, `ProfileLinkType` and the `Collection` names. Each entry's description is the Markdown body, not a field.

- The entry ID (`id`) is the file name: a numeric ID for entries from the old site, `yt-<YouTube ID>` or a random ID for newer ones (see `@esg/content`'s `ids.ts`).
- Relations are lists of entry IDs, stored on one side only: a video's `organizations` and `presenters`, a playlist's `videos` and `subPlaylists`.

If you change a content field, update `content.ts`, the zod schema in `apps/website/src/content.config.ts`, and every tool that writes the field (pg-export, yt-export's sync, cms).

```bash
pnpm typecheck
```
