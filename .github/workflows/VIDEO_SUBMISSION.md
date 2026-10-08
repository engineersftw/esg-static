# Video Submission Workflow

Anyone with a GitHub account can suggest a YouTube talk for the site's [Community Contributed](https://engineers.sg/playlist/community-contributed) playlist. The flow:

1. They open an issue with the **Submit a video** form (`.github/ISSUE_TEMPLATE/submit-video.yml`, which labels it `video-submission`). The form asks for the YouTube URL, the presenters (one per line, each optionally followed by `| link | link`), the event or group, and notes. The playlist page links to the form: `https://github.com/engineersftw/esg-static/issues/new?template=submit-video.yml`.
2. `video-submission.yml` runs `pnpm cms submission` on the issue body. It:
   - fetches the video from the YouTube Data API (1 quota unit);
   - creates `video/<id>.md` with the fields the daily sync writes, so the sync keeps its title, description and thumbnails up to date afterwards;
   - links each presenter whose name matches an existing presenter (ignoring case, spacing and accents; if several match, the active one with the most videos), and creates the others with the links given (the type is worked out from each link; an `@handle` is X);
   - adds the video to the `community-contributed` playlist.
3. It opens a pull request from `video-submission/issue-<n>` that closes the issue. The description lists what was matched or created, the submitter's event and notes, and a review checklist. It then comments on the issue with the PR link.
4. A maintainer reviews it: checks it's a suitable talk, that matched presenters are the right people and new ones aren't existing presenters under another name, and links an organization (`pnpm cms assign --video <id> --organization <ref>`) on the PR branch if there is one. Merging closes the issue.

Editing the issue runs it again from `main` and updates the same pull request, replacing anything pushed to its branch since. A submission that can't be added (not a YouTube link, a video already on the site, private, unlisted or deleted) gets a comment explaining why, and the submitter can edit the issue to fix it. If the run itself fails (e.g. a YouTube API error), the issue gets a comment with the run link.

## Setup

1. Create the `video-submission` label in the repository (**Issues → Labels → New label**). The issue form can only apply a label that exists, and the workflow only runs for issues that have it.
2. The `YOUTUBE_API_KEY` secret is the one the YouTube sync uses (see [SYNC_YOUTUBE.md](SYNC_YOUTUBE.md)). `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, if set, also announce new submission PRs.
3. Under **Settings → Actions → General → Workflow permissions**, allow GitHub Actions to create pull requests (the sync needs this too).

## Things to know

- Pull requests opened with the workflow's `GITHUB_TOKEN` don't trigger other workflows, so the `lint`/`typecheck`/`test` CI checks don't run on them until someone pushes to the branch. The Cloudflare Pages preview builds anyway, since it comes from Cloudflare's GitHub app. The same is true of the YouTube sync PRs.
- Each submission takes the next free video (and presenter) ID on `main`, so two submissions open at the same time get the same IDs, and the second PR has a merge conflict once the first is merged. Edit the second issue (any change, even to the title) to rebuild its PR from the new `main`.
- The issue body is untrusted. The workflow only passes it to the shell as a file, and the report escapes everything that came from the issue or from YouTube (Markdown, HTML and `@` mentions).
- Locally: save an issue body to a file and run `YOUTUBE_API_KEY=... pnpm cms submission body.md --dry-run`.
