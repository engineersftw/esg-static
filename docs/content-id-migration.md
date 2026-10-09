# Content ID Migration

Content entries were named by sequential numbers carried over from Postgres, and every link was written on both sides. Two contributors running `pnpm cms` or the YouTube sync on separate branches picked the same "next" ID and edited the same files. This plan gives new entries IDs that can't collide, and stores each link on one side only.

## Status

Done. Drafted on 2026-10-09 from `main` at `fab572a`, and carried out the same day:

- [#37](https://github.com/engineersftw/esg-static/pull/37): step 1 (the site derives the reverse links).
- [#38](https://github.com/engineersftw/esg-static/pull/38): steps 2–5 (ID helpers, tools, content migration, docs).

Where the work differed from the plan:

- `pg-export -f markdown` was updated to write the one-sided format instead of being marked as legacy, so a re-export matches the current content.
- `cms check` also reports leftover reverse lists (`playlists` on a video, `videos` on a presenter or organization), which a branch made before the migration could bring back. CI runs it as a fourth check, `content` (`pnpm content`).
- `Cms` takes an optional `randomId` function, so tests can use predictable IDs.
- `slugAllocator` slugifies its fallback, since a fallback built from a YouTube ID can contain capitals and underscores.
- Union merge for playlists (step 5, optional) was not done.

The rules as they stand now are in `CLAUDE.md` under "Entry IDs and links".

## The problem

Two separate things caused conflicts.

### 1. Sequential IDs

A new entry took the highest existing ID plus one. Two branches made at the same time both created `video/4653.md` (or `presenter/1761.md`) for different things. Git reports an add/add conflict at best. At worst, someone resolves it by keeping one side, and the other entry is lost or its links point at the wrong thing.

| Where | What assumed numbers |
|---|---|
| `cms/src/cms.ts` | `nextId()` (max + 1) for videos, presenters, organizations and playlists; `Number(id)` tie-breaks in `presentersNamed` and `changes()` |
| `yt-export/src/sync.ts` | `maxId()`; new videos and playlists numbered after the highest, oldest first; `playlists` sorted with `Number(a) - Number(b)` |
| `website/src/helpers/collections.ts` | Newest-first sorts broke ties with `Number(b.id) - Number(a.id)`, which gives `NaN` for a non-numeric ID |
| `website/functions/_middleware.ts` | Old Rails URLs match `\d+`. This is correct and stays: only legacy entries have Rails URLs. |
| `.github/workflows/video-submission.yml` | Two open submissions both took the next ID, so their PRs conflicted |

### 2. Links stored on both sides

Linking a video to a presenter wrote the video's `presenters` *and* the presenter's `videos`. So adding one talk by Dave Cheney also edited `presenter/853.md`, and a second branch adding another of his talks edited the same line. Each list is one JSON line, so any two additions conflicted. Unique IDs alone don't fix this.

## Target design

### IDs for new entries

| Collection | New ID | Example | Why |
|---|---|---|---|
| Video | `yt-` + YouTube video ID | `video/yt-eJLVT157BSs.md` | Natural key. Two branches adding the same talk create the same file, so git shows the duplicate instead of making two entries. |
| Playlist | `yt-` + YouTube playlist ID, or a random ID when there is none | `playlist/yt-PLYDCh9vbt8_LFv-UIoxkhZRB-PCcv9lGO.md` | Same as videos. Hand-made playlists (like Community Contributed) get a random ID. |
| Presenter | Random: 10 characters, lowercase letters and digits, starting with a letter | `presenter/k3v9qz2m7d.md` | Names change and collide. A slug as the ID would mean renaming the file and rewriting every reference on each rename. |
| Organization | Random, as for presenters | `organization/r8b2xw4h0p.md` | Same as presenters (e.g. the SingaDev rename). |

- **Existing entries keep their numbers.** `/v/601`, `/presenter/7` and the other Rails URLs resolve through those numbers, and nothing gains from renumbering.
- A new ID never looks like a number (it starts with a letter or `yt-`), so legacy and new IDs can't be confused. The legacy redirect map only needs the numeric ones.
- URLs don't change. Pages already use slugs (`/video/<slug>`), so IDs stay internal.
- The frontmatter `id` keeps matching the file name.

### Which side owns each link

| Relation | Stored on | Removed from | Derived at build time |
|---|---|---|---|
| Video ↔ presenter | video `presenters` (display order) | presenter `videos` | A presenter's videos, newest first by `publishedAt` |
| Video ↔ organization | video `organizations` | organization `videos` | An organization's videos, newest first |
| Video ↔ playlist | playlist `videos` (curated order) | video `playlists` | A video's playlists (only the search index reads them) |
| Playlist → sub-playlist | playlist `subPlaylists` | — | Already one-sided; no change |

**What a contribution touches afterwards:** adding a talk by existing presenters creates one new video file and nothing else. Adding new presenters creates their files too. Adding the talk to a playlist edits that one playlist file. `cms check --fix` and `reconcileLinks` are no longer needed, because there is no second side to fall out of step.

## Steps

The order keeps the site building at every step. Steps 1 and 2 change no content, and the site output should stay the same until the new-ID entries appear.

### 1. The site derives the reverse links (PR A, #37)

- In `collections.ts`, build the reverse lists once per build: videos by presenter, videos by organization (both newest first), and playlists by video. Use only active entries, as before.
- Make the presenter and organization pages use those lists instead of `presenter.data.videos` / `organization.data.videos`. Make `search-index.json.ts` use them instead of `video.data.playlists`.
- Replace the `Number(id)` tie-breaks with a comparison that also works for text IDs (numeric IDs first, by number, then text IDs in order).
- Limit `legacy-redirects.json` to numeric IDs, so new entries don't grow the Functions bundle.

**Check:** build before and after and diff `dist/`. It should be identical, since both sides held the same links. Any difference is a one-sided link to fix first.

*Result:* identical except for two ordering changes. On the Open Government Products page, 23 videos with the same timestamp now sort by ID like other lists. In `search-index.json`, 57 videos list the same playlists in a different order.

### 2. Shared ID helpers (PR B, #38)

- Add to `@esg/content`: `videoEntryId(site, externalId)` (`yt-…`), `playlistEntryId(playlistId)`, `randomEntryId()` (from `crypto`) and `isLegacyId()`, with tests.
- *Done as planned, plus `compareIds`, `caseClashes` and `unusedId`. The site keeps its own small copy of `compareIds`.*

### 3. The tools write new IDs and one side only (PR B, #38)

- **`cms`:** `createVideo` uses `yt-<id>`. `prepareNew` uses a random ID (retrying on the rare clash) and `createPlaylist` uses the playlist rule. Remove `nextId`. `link` and `unlink` change only the owning side. `presentersNamed` counts videos from the video files. `check` becomes a check for links to missing entries, plus IDs that differ only in case. Drop `--fix`.
- **`yt-export` sync:** name new entries by YouTube ID and remove `maxId` and the "oldest first" numbering. Keep appending to a playlist's `videos`. Stop writing `video.playlists` and drop `reconcileLinks`. The standalone JSON export (`transform.ts`) is unaffected.
- **Submissions:** nothing beyond `Cms`. Concurrent submissions no longer conflict, so drop that caveat from `VIDEO_SUBMISSION.md`.
- **Tests:** keep the numeric fixtures (legacy entries still exist) and add cases with new IDs.

### 4. Migrate the content (PR B, #38)

1. Run the old `pnpm cms check --fix` once first, so any link held on one side only is copied to both and none are lost.
2. A one-off script removes `videos` from every presenter and organization, and `playlists` from every video. *(5,867 files: 1,563 presenters, 148 organizations, 4,156 videos.)*
3. Remove those fields from the zod schemas in `content.config.ts` and from `@esg/db-types/content`.
4. Existing files keep their names; no file is renamed.

**Check:** `dist/` identical again; `pnpm cms check` clean; a dry-run YouTube sync reports 0 new and 0 updated.

*Result:* all three held. The sync dry run reported 4,072 videos unchanged.

### 5. Docs and leftovers (PR B, #38)

- Update `CLAUDE.md`, the READMEs, `SYNC_YOUTUBE.md` and `VIDEO_SUBMISSION.md` for the ID rules and the one-sided links.
- `pg-export -f markdown` writes the old two-sided format. Mark that mode as legacy rather than update it. *(Updated instead; see Status.)*
- Optional: write playlist `videos` one ID per line, and consider `merge=union` for `playlist/*.md` in `.gitattributes`. *(Not done.)*

## Conflicts that remain

- **The same talk added on two branches:** both create `video/yt-….md`. Git reports it, which is what you want: it's a real duplicate.
- **Two branches adding to the same playlist:** both edit that playlist's `videos`. It's rare and quick to resolve. Writing one ID per line makes the conflict obvious, and `merge=union` would keep both additions automatically. The cost is that a clash in any other field of that file also keeps both lines, so the build has to catch it; leave union merge out unless it becomes a nuisance.
- **Two people editing the same entry** (a title, links): ordinary conflicts, as with any file.

## Risks

- **YouTube IDs are case-sensitive; macOS and Windows file systems aren't.** Two video IDs that differ only in case would map to the same file on a Mac. With about 4,000 videos the chance is tiny, but `cms check` and the sync refuse to create one, so it can't happen silently. Random IDs use lowercase only, so they're not affected.
- **Losing links in the migration:** handled by running `check --fix` before stripping, and by the `dist/` diff.
- **Order changes on presenter and organization pages:** the lists were already newest first by `publishedAt`. Only ties could move, and the shared sort fixes those.
- **Vimeo videos:** the few existing ones keep numeric IDs. A new one would be `vimeo-<id>`.
- **One big content diff:** about 6,000 files changed in step 4. Content PRs opened before it should be merged first or rebuilt after it; `cms check` (the `content` CI check) catches any reverse lists they bring back.

## Decisions

1. **Video and playlist IDs:** `yt-<YouTube ID>`. The alternative was random IDs everywhere, which are more uniform but lose the free duplicate detection.
2. **Presenter and organization IDs:** 10-character random IDs. The alternative was the slug, which is readable in file listings but has to change on every rename.
3. **One-sided links:** yes. Without them, new IDs only fix file-name clashes, and adding talks by the same presenter still conflicts.
4. **Union merge for playlists:** not for now; revisit if playlist conflicts become common.
