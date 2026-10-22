# Daily Rebuild Workflow

The site is static, and `/cal` (the iCalendar of upcoming events) is built from DevsGoWhere's events feed, so it is only as fresh as the last deploy. This workflow starts a new Cloudflare Pages build every day, so the calendar follows the feed.

It runs at **16:30 UTC (00:30 SGT)**, half an hour after DevsGoWhere's own rebuild at 00:01 SGT. GitHub can start a scheduled run a few minutes late, which that margin covers. You can also run it by hand from the **Actions** tab (**Run workflow**).

## Setup

1. In Cloudflare, open the Pages project (`esg-static`) → **Settings** → **Builds & deployments** → **Deploy hooks** → **Add deploy hook**. Name it (e.g. `daily-rebuild`) and choose the **production** branch (`main`).
2. Copy the hook URL.
3. In the GitHub repository, go to **Settings** → **Secrets and variables** → **Actions** and add a secret named `CF_PAGES_DEPLOY_HOOK` with that URL.

Treat the URL as a secret: anyone who has it can start builds. If it leaks, delete the hook in Cloudflare and add a new one.

Until the secret is set, the workflow succeeds without doing anything and says so in its summary.

## Notes

- The hook builds the branch it was created for, with the project's environment variables (`HOSTNAME`, `PUBLIC_ALLOW_INDEXING`, ...). It doesn't touch `staging` previews, which have no daily rebuild.
- If DevsGoWhere's feed can't be read during the build, the build warns and leaves out `/cal` (see `apps/website/README.md`), so the calendar URL returns 404 until the next good build. Check the build log if a subscribed calendar goes missing.
- The workflow only calls the hook; it doesn't wait for the build or report its result. Look in the Cloudflare dashboard for failed builds.
