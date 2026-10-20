# Playlist Submission Workflow

Anyone with a GitHub account can suggest a whole public YouTube playlist, such as a conference or a meetup series. It works like the [video submission](VIDEO_SUBMISSION.md) workflow:

1. They open an issue with the **Submit a playlist** form (`.github/ISSUE_TEMPLATE/submit-playlist.yml`, which labels it `playlist-submission`). The form asks for the playlist URL, and optionally the category (Conference, Meetup, Tutorial, Training or Shows), the conference, meetup or group (free text), the event date, a website and notes. The site's [Contribute page](https://engineers.sg/contribute) links to it: `https://github.com/engineersftw/esg-static/issues/new?template=submit-playlist.yml`.
2. `playlist-submission.yml` runs `pnpm cms playlist submission` on the issue body. It:
   - rejects a playlist already in the content before calling YouTube;
   - fetches the playlist, its items and the videos not yet in the content from the YouTube Data API (about 1 quota unit per 50 videos, twice, plus one);
   - rejects a playlist that is missing, not public, has no public videos, or has more than 300 videos (`MAX_PLAYLIST_VIDEOS`; a maintainer handles those);
   - creates `playlist/yt-<playlist ID>.md` with the YouTube playlist ID, the title, description and image from YouTube, the category, website, and the event date (or the playlist's creation date);
   - fills its `videos` in YouTube's order: videos already on the site are reused as they are, new public ones are created like the sync creates them, and private, deleted or unlisted ones are left out (listed in the report);
   - links the new videos (not the existing ones) to the active organization whose name matches the group, ignoring case, spacing and accents.
3. It opens a pull request from `playlist-submission/issue-<n>` that closes the issue, comments on the issue with the link, and posts to Telegram (with the number of videos).
4. A maintainer reviews it: checks the talks suit the site and the category and date are right, assigns presenters (`pnpm cms assign --video <id> --presenter <ref>`) and, if the group wasn't matched, an organization (`pnpm cms assign --from-playlist <playlist> --organization <ref>`) on the PR branch, and nests a track under its conference if needed. Merging closes the issue.

Because the playlist keeps its YouTube ID, the daily sync refreshes its title, description and image afterwards and appends videos added to it on YouTube later.

Editing the issue runs it again and updates the same pull request, replacing anything pushed to its branch since, as for video submissions. A rejected submission gets a comment explaining why; a failed run (e.g. a YouTube API error) gets a comment with the run link.

## Setup

1. Create the `playlist-submission` label (**Issues → Labels → New label**). The form can only apply a label that exists, and the workflow only runs for issues that have it.
2. The secrets are the video submission's: `YOUTUBE_API_KEY`, and optionally `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. GitHub Actions must be allowed to create pull requests (see [VIDEO_SUBMISSION.md](VIDEO_SUBMISSION.md)).

## Things to know

- As with video submissions, PRs opened with `GITHUB_TOKEN` don't trigger CI until someone pushes to the branch, and the issue body only reaches the shell as a file.
- Two submissions of the same playlist create the same file, so the second PR conflicts: that's the duplicate to close. A playlist submission and a video submission (or the sync) that add the same new video conflict the same way.
- Locally: save an issue body to a file and run `YOUTUBE_API_KEY=... pnpm cms playlist submission body.md --dry-run`.
