# Engineers.SG website

The new [Engineers.SG](https://engineers.sg) site: a static [Astro](https://docs.astro.build) site that lists the community's recorded talks by video, conference, playlist, organization and presenter. It replaces the old Rails app, and is deployed to Cloudflare Pages.

There is no database or server. Every page is built ahead of time from Markdown files in [`content/`](content/), and the old site's URLs are kept working with static redirect pages.

## Getting started

You need Node 22.12 or newer (the repo's `.nvmrc` pins 22.23.3) and pnpm 10. This app is one package of a pnpm workspace, so install from the **repository root**:

```bash
nvm use            # picks up .nvmrc
pnpm install       # from the repo root
cd apps/website
cp env.example .env
pnpm dev           # http://localhost:4321
```

## Commands

Run these from `apps/website/`:

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server at http://localhost:4321, reloading on changes |
| `pnpm build` | Builds the static site into `dist/` (about 22k pages, roughly 15 seconds) |
| `pnpm preview` | Serves `dist/` locally |
| `pnpm deploy` | Uploads `dist/` to Cloudflare Pages as a preview deployment |
| `pnpm deploy:production` | Uploads `dist/` to the production branch |
| `pnpm astro …` | The Astro CLI, e.g. `pnpm astro sync` to regenerate content types |

There are no tests for the site. The tools that produce its data have their own (`pnpm test` at the repo root).

## Environment variables

Both are read at **build time**, from `.env` locally or `.env.production` for production builds (both git-ignored). See [`env.example`](env.example).

| Variable | Used for |
|---|---|
| `HOSTNAME` | The site's public URL (e.g. `https://engineers.sg`). It is used for canonical URLs, the sitemap and the `/feed` links. If it isn't set, they point at `http://localhost:4321`, so **always set it for a deploy build.** |
| `PUBLIC_GTM_ID` | Google Tag Manager container ID (`GTM-…`). If it isn't set, no tracking code is added, which is what you want for dev and preview builds. A malformed ID fails the build. |

## Deploying

`pnpm deploy` uploads whatever is in `dist/`, so build with the production settings first:

```bash
HOSTNAME=https://engineers.sg PUBLIC_GTM_ID=GTM-XXXXXXX pnpm build
pnpm deploy:production
```

Wrangler needs a Cloudflare login the first time (`pnpm exec wrangler login`).

## How the site is put together

```
apps/website/
  content/              The data: one Markdown file per entry (see below)
    video/<id>.md
    organization/<id>.md
    presenter/<id>.md
    playlist/<id>.md
  public/               Static files, plus _headers for Cloudflare
  src/
    content.config.ts   The four content collections and their schemas
    helpers/
      collections.ts    Queries every page uses (active filtering, sorting)
      url_helpers.ts    parameterize() for the old Rails URLs
    components/         Header, Footer, BaseHead, Pagination, PlaylistPage, GoogleTagManager, ...
    pages/              One file per route (see "Routes")
    styles/global.css
  astro.config.mjs      Site URL, integrations and simple redirects
```

### Content

Each file in `content/` has YAML frontmatter and a Markdown body. The body is the description, which is shown as plain text with its line breaks kept. For example, `content/video/4442.md`:

```markdown
---
id: "4442"
videoId: "r_GiEIe_oZk"
videoTitle: "Making a HDMI ISA graphics card by improving the Graphics Gremlin - Hackware v7.9"
publishedAt: "2023-11-03T06:41:58Z"
slug: "making-a-hdmi-isa-graphics-card-by-improving-the-graphics-gremlin-hackware-v7-9"
organizations: ["111"]
presenters: ["68"]
playlists: ["1"]
active: true
videoSite: "youtube"
...
---

Speaker: Yeo Kheng Meng
```

Things to know:

- **IDs are the file names.** They are the old database IDs, and they are also the entry IDs in Astro. Relations such as `organizations`, `presenters`, `videos` and `subPlaylists` are lists of those IDs, declared with `reference()` in `src/content.config.ts`. Use `getEntries()` to turn them into entries.
- **`generateId` is required.** The glob loaders use the file name as the entry ID. Without that, Astro uses the frontmatter `slug` as the ID and every reference breaks.
- **The schemas mirror shared types.** The frontmatter types live in `@esg/db-types/content` (`packages/db-types/src/content.ts`). If you add a field, change both.
- **Inactive entries stay in the files** with `active: false`, but the site leaves them out entirely: they get no page, no list entry and no link. See the next section.

### Always use the helpers in `src/helpers/collections.ts`

Don't call `getCollection()` directly in a page. The helpers apply the `active` filter and the sort orders, which the glob loader doesn't:

| Helper | Returns |
|---|---|
| `getActiveVideos()` / `getListedVideos()` | Active videos / the same, newest first |
| `getActiveOrganizations()` / `getActivePresenters()` | Active organizations / presenters |
| `getConferences()` | Active "Conference" playlists, newest first |
| `getConferencePages()` | Conferences plus their sub-playlists (tracks), each with its parent |
| `getPlaylistPages()` | Every other active playlist, each with its parent |
| `listed()`, `listedOrganizations()`, `listedPresenters()`, `listedPlaylists()` | Drop inactive entries from resolved references |

### Routes

Paginated pages use the shared `Pagination` component.

| URL | Page |
|---|---|
| `/` | Latest videos |
| `/videos`, `/videos/[page]` | All videos, 50 per page |
| `/video/[slug]` | One video, with its organizations and presenters |
| `/conferences`, `/conferences/list/[page]` | Conference playlists |
| `/conference/[slug]`, `/conference/[slug]/[page]` | One conference or track: its videos (25 per page) and tracks |
| `/playlist/[slug]`, `/playlist/[slug]/[page]` | Any other playlist, on the same `PlaylistPage` component. The `/playlist/` URL of a conference redirects to its `/conference/` page |
| `/organizations`, `/organizations/list/[page]` | Organizations, A–Z |
| `/organization/[slug]`, `/organization/[slug]/[page]` | One organization and its videos |
| `/presenters`, `/presenters/list/[page]` | Presenters, A–Z |
| `/presenter/[slug]`, `/presenter/[slug]/[page]` | One presenter and their videos |
| `/feed` | RSS feed of the 50 newest videos (`public/_headers` sets its content type) |
| `/about` | About page |

### Old Rails URLs

Links to the old site are kept working with redirects. Each is either a static page (`Astro.redirect`, which writes a meta-refresh page) or an entry in `redirects` in `astro.config.mjs`:

- `/v/:id`, `/:id` (e.g. `/601`), `/episodes/:id` and `/video/<name>--<id>` go to the video.
- `/organization/:id`, `/organizations/:id-or-slug`, `/org/:id`, `/o/:id` and `/organization/<name>--<id>` go to the organization.
- `/presenter/:id`, `/presenters/:id`, `/s/:id` and `/presenter/<name>--<id>` go to the presenter.
- `/episodes` goes to `/videos`.

The `<name>--<id>` pages are generated from the **current** title using `parameterize()`, which copies Rails' `String#parameterize`. A link made before a title changed (e.g. `/organization/sg-hack-tell--184`) therefore 404s.

They are pages rather than Cloudflare `_redirects` rules because `_redirects` allows only 2,000 rules, and there are about 5,000 of these URLs.

### Adding a page

- Start each page's `<head>` with `<BaseHead … />`. It loads the global styles, the meta tags and the GTM script.
- Start each page's `<body>` with `<Header />`. It also renders the GTM `<noscript>` fallback, which has to come first in the body.
- Get data through the helpers above, and pass paginated pages to `<Pagination page={page} />`. Its numbered links assume the page number is the last part of the URL.
- If the new URL replaces an old Rails one, add a redirect (see above).

## Updating the content

Don't edit hundreds of files by hand: two tools in this repo regenerate `content/`.

**From YouTube** (the usual way to add new videos and playlists). `packages/yt-export` syncs the channel into `content/`. It updates titles, descriptions and thumbnails of existing entries, adds new ones, and never deletes anything:

```bash
cd packages/yt-export
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run   # see what would change
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content
```

New videos come in with no organizations or presenters, so link those up by hand in the frontmatter. See the yt-export section of the repo's `CLAUDE.md` for the matching rules, and for `--deactivate-missing` and `--exclude-video`.

**From the old database.** `packages/pg-export` regenerates every file from the Rails database's JSON export, which **overwrites** anything edited since. This is only for a fresh start:

```bash
pnpm --filter @esg/pg-export export --from-json ../../output/backup -o ../../apps/website/content
```

Presenter emails are written as `null` unless you pass `--include-emails`. Keep it that way: `content/` is committed and published.

After either one, run `pnpm build`. Broken references (an ID pointing at a missing file) fail the build, which is a good check.

## Known leftovers

- **Template remnants:** `src/consts.ts` still has the template's `SITE_DESCRIPTION`. `about.astro` uses the template's `BlogPost.astro` layout, and `BaseHead` falls back to `/blog-placeholder-1.jpg` for the share image.
- **Unused files:** `check_query.js` is an old Supabase scratch script whose dependency isn't installed, and `project.json` is an unused Nx config.
- **Not ported from the old site yet:** the static pages (`/events`, `/cal`, `/bookings`, `/live`, `/fb_live`, `/support_us`, `/screenshots`, `/terms`), search (`/episodes/search`, `/presenters/search`), newsletter signup, `/videos/:tag` and the `/api/*` JSON endpoints.
