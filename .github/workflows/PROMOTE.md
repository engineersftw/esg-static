# Promote to production

`promote.yml` merges `staging` into `main` (a merge commit, never a rebase or force-push), and `main` is what goes to production.

1. Every push to `staging` runs CI. When that run **passes**, a `Promote to production` run starts and stops at the `production` environment, waiting for approval.
2. A maintainer opens the run (Actions tab, or the "Review pending deployments" link in the notification), checks the commit and approves. Only the environment's required reviewers can; anyone else cannot start the merge.
3. The job merges **the commit CI tested** (not a newer staging head) into `main` with `git merge --no-ff` and pushes. If `main` already has the commit, it does nothing.

A failed CI run starts no promotion. A merge conflict (someone pushed to `main` directly) fails the job: merge `main` into `staging` and push, and the next run promotes.

Approving an older run after a newer commit is already in `main` is harmless, and so is rejecting one; unapproved runs expire after 30 days. To promote the current head of staging without one of those runs, use **Run workflow** on the `staging` branch (it asks for the same approval).

Pushes made with the workflow's `GITHUB_TOKEN` don't trigger other workflows, so CI doesn't run again on `main` for the merge (the same commit passed on `staging`). The Cloudflare Pages build comes from Cloudflare's GitHub app and does run.

## Setup (once)

Settings > Environments > `production`:

- **Required reviewers:** the maintainers who may promote.
- **Deployment branches:** `staging` only.

The `main` ruleset must keep allowing the merge push (it only blocks deletion and force-pushes).
