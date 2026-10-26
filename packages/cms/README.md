# @esg/cms

A command-line editor for the site's content (`apps/website/content`): create presenters, organizations and playlists, edit presenters' and organizations' links, link videos to presenters, organizations and playlists, check the content, and add the videos people submit through the **Submit a video** issue form.

Run it from the repo root with `pnpm cms <command>` (or `pnpm cms` inside this package). It runs through tsx, with no build step.

## Commands

```bash
pnpm cms find presenter yeo                  # look up entries: find <video|presenter|organization|playlist> <text>

pnpm cms presenter create --name "Jane Doe" --x @jane --linkedin https://linkedin.com/in/jane --video 4517 --dry-run
pnpm cms organization create --name "Tech Circle" --website techcircle.sg --contact "Jane Doe" --video 4588 --dry-run
pnpm cms playlist create --title "PyCon SG 2026" --category Conference --date 2026-06-01 --video 4588 --dry-run

pnpm cms assign --video 4517 --presenter jane-doe --organization 111 --playlist pyconsg-2019
pnpm cms assign --video 4609-4618,4620 --from-playlist gophercon-singapore-2025 --organization 42
pnpm cms unassign --video 4517 --playlist 1

pnpm cms links presenter jane-doe            # show a presenter's or organization's links
pnpm cms links organization 42 --instagram @golangsg --remove x

pnpm cms check                               # also `pnpm content`; CI runs it
YOUTUBE_API_KEY=... pnpm cms video add dQw4w9WgXcQ --presenter jane-doe --playlist pyconsg-2019 --dry-run
YOUTUBE_API_KEY=... pnpm cms submission issue-body.md --issue 12 --report report.md --dry-run
YOUTUBE_API_KEY=... pnpm cms playlist submission issue-body.md --issue 13 --report report.md --dry-run

pnpm cms --help                              # every option
```

Commands that write take `--dry-run` (show what would change, write nothing), and every command takes `--content <dir>` (default `apps/website/content`; a relative path resolves against where you ran `pnpm`).

- **Refs:** a `<ref>` is an entry ID, a slug, a site URL or path (`/video/<slug>`), and for videos a YouTube video ID or URL, for playlists a YouTube playlist ID. An ambiguous or unknown ref fails the whole command before anything is written.
- **Many videos:** `--video` can be repeated, comma-separated, or an ID range (`4609-4618`), and `--from-playlist <ref>` takes every video in a playlist. The `create` commands' `--video` accepts the same forms.
- **Links** are `{ "type", "url" }` entries of type `x`, `website`, `linkedin`, `instagram` or `tiktok`, with a flag each (`--x` or `--twitter`, `--website`, `--linkedin`, `--instagram`, `--tiktok`) that takes a handle or URL. `links` replaces a type's link where it is or adds it at the end, and `--remove <type>` deletes one.
- **Playlist categories** are Conference, Conference Track, Meetup, Tutorial, Training and Shows (any case). `--date` (YYYY-MM-DD) is the event date, which sorts conferences. `--website` takes a URL or bare domain and is stored as a full URL (`pycon.sg` → `https://pycon.sg`), since the site rejects one without a scheme.
- **Submission form:** `organization create` also rewrites the Group options of both submission forms, `.github/ISSUE_TEMPLATE/submit-video.yml` and `submit-playlist.yml`, to the active organizations, sorted (`--form <file>`, repeatable, picks other forms; with a custom `--content` and no `--form` it leaves the form alone, and `--dry-run` writes nothing). `pnpm cms form sync` does the same rewrite on its own, and `check` (so CI) reports Group options that differ from the active organizations, which is how a rename, a deactivation or a hand-added organization gets noticed.
- **Names:** `presenter create` and `organization create` refuse a name another entry already has, ignoring case, spacing and accents, unless you pass `--allow-duplicate`.

## How it writes

- **IDs:** new presenters, organizations and hand-made playlists get a random 10-character ID (`presenter/k3v9qz2m7d.md`). A playlist made with `--playlist-id` is `playlist/yt-<id>.md`, and a submitted video `video/yt-<YouTube ID>.md`. These can't clash with another contributor's new entries on another branch. Entries from the old site keep their numeric IDs.
- **Links are stored on one side only:** `assign` adds to a video's `presenters` and `organizations`, and to a playlist's `videos`. Presenters' and organizations' files aren't touched, so adding a talk doesn't edit them. Linking to an inactive entry warns, since the site won't show it.
- **Only changed files are written,** in the same format as every other tool (`@esg/content`), so they diff cleanly.

## check

`pnpm cms check` (or `pnpm content` from the root) reports:

- links to entries that don't exist;
- IDs that differ only in case, which overwrite each other on macOS and Windows;
- leftover reverse lists (`playlists` on a video, `videos` on a presenter or organization) from before links were stored on one side, which an old branch can bring back.

It exits 1 if it finds any, so CI fails.

## submission

`submission <issue-body-file>` is what the video submission workflow (`.github/workflows/video-submission.yml`, see `VIDEO_SUBMISSION.md` there) runs on an issue made from the **Submit a video** form. It:

1. reads the YouTube URL, presenters (one per line, each optionally followed by `| link | link`), the group (a dropdown of organization names) and "Others (not in list)" from the form;
2. rejects a video already in the content before calling YouTube, then fetches it (needs `YOUTUBE_API_KEY`) and rejects one that is missing or not public;
3. creates the video entry with the same fields the YouTube sync writes, so the sync keeps it up to date;
4. links each presenter to an existing presenter with the same name (active first, then most videos; others with the name are listed for the reviewer), or creates one with the given links (the type is worked out from each link; `@handle` is X);
5. links the active organization named by the group, if there is one (matched by name, ignoring case and accents);
6. adds the video to the `community-contributed` playlist (or `--playlist <ref>`);
7. prints a Markdown report for the pull request (`--report <file>` also writes it), escaping everything from the issue and YouTube.

A submission it can't add is reported with the reason and exits 0 with step output `status=rejected`. In GitHub Actions, success sets `status=added`, `title` and `video`.

## playlist submission

`playlist submission <issue-body-file>` is what the playlist submission workflow (`.github/workflows/playlist-submission.yml`, see `PLAYLIST_SUBMISSION.md` there) runs on an issue made from the **Submit a playlist** form. It:

1. reads the playlist URL (any YouTube link with `list=`, or a bare ID; generated mixes are refused), the category, the group (a dropdown of organization names, as in the video form), "Others (not in list)", the event date (YYYY-MM-DD), the website and notes;
2. rejects a playlist already in the content before calling YouTube, then fetches the playlist, its items and the videos not yet in the content (needs `YOUTUBE_API_KEY`), and rejects one that is missing, not public, has no public videos or more than 300;
3. creates the playlist with its YouTube ID (`yt-<playlist ID>`), so the daily sync keeps it up to date, with the event date or else YouTube's creation date;
4. fills its `videos` in YouTube's order, reusing videos already on the site and creating the new public ones; private, deleted and unlisted ones are left out and listed;
5. links the new videos to the active organization named by the group, if there is one; existing videos keep their organizations;
6. prints the report (`--report <file>` also writes it), escaping everything from the issue and YouTube.

Rejections work as for `submission`. In GitHub Actions, success sets `status=added`, `title`, `playlist` and `videos` (how many). Presenters aren't part of the form; the reviewer assigns them.

## Code

| File | What it holds |
|---|---|
| `src/cli.ts` | Argument parsing and I/O |
| `src/cms.ts` | The `Cms` class: pure edits on an in-memory copy; `changes()` returns the files to write |
| `src/submission.ts` | Parsing the issue form, applying a submission, the reports |
| `src/playlistSubmission.ts` | The same for playlist submissions |
| `src/testContent.ts` | Test fixtures |

```bash
pnpm test        # Vitest: cms.test.ts, submission.test.ts and playlistSubmission.test.ts
pnpm typecheck
```
