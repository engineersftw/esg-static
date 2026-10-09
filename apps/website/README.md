# Engineers.SG website

The new [Engineers.SG](https://engineers.sg) site: a static [Astro](https://docs.astro.build) site that lists the community's recorded talks by video, conference, playlist, organization and presenter. It replaces the old Rails app, and is deployed to Cloudflare Pages.

There is no database or server. Every page is built ahead of time from Markdown files in [`content/`](content/), and the old site's URLs are kept working with static redirect pages.

## Getting started

You need Node 24 (the repo's `.nvmrc` pins 24.21.0) and pnpm 10. This app is one package of a pnpm workspace, so install from the **repository root**:

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
| `pnpm build` | Builds the static site into `dist/` (about 7k pages, roughly 10 seconds) |
| `pnpm preview` | Serves `dist/` locally, without the Pages Function (so no legacy redirects) |
| `pnpm exec wrangler pages dev ./dist` | Serves `dist/` the way Cloudflare does, including the Pages Function, at http://localhost:8788 |
| `pnpm run deploy` | Uploads `dist/` to Cloudflare Pages as a preview deployment (not `pnpm deploy`, which is a pnpm built-in) |
| `pnpm deploy:production` | Uploads `dist/` to the production branch |
| `pnpm astro …` | The Astro CLI, e.g. `pnpm astro sync` to regenerate content types |

The site has Vitest tests for its pure helpers (`pnpm test`), such as the one that finds links in descriptions. The tools that produce its data have their own (`pnpm test` at the repo root runs all of them).

## Environment variables

Both are read at **build time**, from `.env` locally or `.env.production` for production builds (both git-ignored). See [`env.example`](env.example).

| Variable | Used for |
|---|---|
| `HOSTNAME` | The site's public URL (e.g. `https://engineers.sg`). It is used for canonical URLs, the sitemap and the `/feed` links. If it isn't set, they point at `http://localhost:4321`, so **always set it for a deploy build.** |
| `PUBLIC_GTM_ID` | Google Tag Manager container ID (`GTM-…`). If it isn't set, no tracking code is added, which is what you want for dev and preview builds. A malformed ID fails the build. |

## Deploying

The Cloudflare Pages project builds from GitHub. Its build settings must use **`apps/website` as the root directory**, with `dist` as the output directory. The build picks its Node version from `apps/website/.nvmrc`, a copy of the repo's `.nvmrc`; update both together. Cloudflare only looks for `functions/` in the root directory, so with the repo root there, the site deploys but the legacy-URL redirects don't. Set `HOSTNAME` and `PUBLIC_GTM_ID` as environment variables in the project settings, because they are read at build time.

To deploy by hand instead, `pnpm run deploy` (preview) and `pnpm deploy:production` upload whatever is in `dist/`, so build with the production settings first:

```bash
HOSTNAME=https://engineers.sg PUBLIC_GTM_ID=GTM-XXXXXXX pnpm build
pnpm deploy:production
```

Run these from `apps/website`, because wrangler compiles `functions/` from the directory it runs in. Use `pnpm run deploy` rather than `pnpm deploy`, which runs pnpm's own built-in `deploy` command instead of the script. Wrangler needs a Cloudflare login the first time (`pnpm exec wrangler login`).

## How the site is put together

```
apps/website/
  content/              The data: one Markdown file per entry (see below)
    video/<id>.md
    organization/<id>.md
    presenter/<id>.md
    playlist/<id>.md
  public/               Static files, plus _headers and _routes.json for Cloudflare
  src/
    content.config.ts   The four content collections and their schemas
    helpers/
      collections.ts    Queries every page uses (active filtering, sorting)
      url_helpers.ts    toSlug(), and profileLinkLabel() for presenter and organization links
      linkify.ts        Finds the URLs in a description (with a test next to it)
    components/         Header, Footer, BaseHead, Pagination, PlaylistPage, VideoCard, EntityImage, GoogleTagManager, ...
    pages/              One file per route (see "Routes")
    styles/global.css
  functions/
    _middleware.ts      Cloudflare Pages Function that redirects old Rails URLs
    api/search.ts       Cloudflare Pages Function for video search (GET /api/search?q=…)
  astro.config.mjs      Site URL, integrations and the /episodes redirect
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
active: true
videoSite: "youtube"
...
---

Speaker: Yeo Kheng Meng
```

Things to know:

- **IDs are the file names.** Entries from the old site keep their database IDs (`video/601.md`); newer ones are `yt-<YouTube ID>` (videos, and playlists from YouTube) or a random ID (`presenter/k3v9qz2m7d.md`). They are also the entry IDs in Astro. Relations (`organizations` and `presenters` on a video, `videos` and `subPlaylists` on a playlist) are lists of those IDs, declared with `reference()` in `src/content.config.ts`. Use `getEntries()` to turn them into entries.
- **Each link is stored on one side.** A presenter's or organization's videos and a video's playlists aren't in the files: `src/helpers/collections.ts` works them out once per build (`getPresenterVideos`, `getOrganizationVideos`, `getVideoPlaylists`).
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
| `getPresenterVideos(id)` / `getOrganizationVideos(id)` | A presenter's or organization's active videos, newest first (worked out from the videos, once per build) |
| `getVideoPlaylists(id)` | The active playlists that list a video |
| `compareIds(a, b)` | Entry ID order for tie-breaks: numeric IDs by number, then the rest as text |

### Routes

Paginated pages use the shared `Pagination` component, which always shows 7 page numbers (the range shifts near either end). The list sizes are multiples of the grid's columns so that every row is full.

| URL | Page |
|---|---|
| `/` | The latest videos, with a "More videos" button to `/videos` |
| `/videos`, `/videos/[page]` | All videos, 50 per page in rows of 2. Page 1 also shows the newest video large above them, and leaves it out of the list |
| `/video/[slug]` | One video, with its organizations and presenters |
| `/conferences`, `/conferences/list/[page]` | Conference playlists, 50 per page, two per row on desktop |
| `/conference/[slug]`, `/conference/[slug]/[page]` | One conference or track: its videos (25 per page) and tracks |
| `/playlist/[slug]`, `/playlist/[slug]/[page]` | Any other playlist, on the same `PlaylistPage` component. The `/playlist/` URL of a conference redirects to its `/conference/` page |
| `/organizations`, `/organizations/list/[page]` | Organizations, A–Z, 48 per page (3 columns, 2 on mobile), with a name filter |
| `/organization/[slug]`, `/organization/[slug]/[page]` | One organization and its videos |
| `/presenters`, `/presenters/list/[page]` | Presenters, A–Z, 48 per page (3 columns, 2 on mobile), with a name filter |
| `/presenter/[slug]`, `/presenter/[slug]/[page]` | One presenter and their videos |
| `/search` | Video search: a static page that calls `/api/search` as you type (see "Video search") |
| `/feed` | RSS feed of the 50 newest videos (`public/_headers` sets its content type) |
| `/about` | About page |
| `404` | Served by Cloudflare for any missing path |

### Video search

The search icon in the header leads to `/search`, which searches every active video's title, presenters, organizations, playlists and description.

- **How it works:** the page is static. Its script calls the Pages Function `functions/api/search.ts` (`/api/search?q=<words>&page=<n>`) once the visitor pauses typing, and shows 20 results at a time with a "More results" button. The query stays in the address (`/search?q=kubernetes`), so searches can be shared.
- **The index:** `src/pages/search-index.json.ts` builds `dist/search-index.json`, which wrangler bundles into the function, so **build before deploying**. Nothing else needs updating when content changes.
- **Matching:** every word must appear somewhere, ignoring case and accents ("kube" finds "Kubernetes"). Title matches rank first, then presenter and organization names, then playlists, then descriptions. The logic is in `src/helpers/search.ts`, with tests in `search.test.ts`.
- **Limits:** each search request counts against the Workers quota (100,000 a day on the free plan), which is why the page waits for a pause in typing. The Functions bundle is about 1 MB gzipped, against the free plan's 3 MB limit.
- **Testing:** `pnpm preview` doesn't run Functions, so search shows "Search isn't available right now" there. Use `pnpm exec wrangler pages dev ./dist`.

### Presenter and organization filters

`/presenters` and `/organizations` have a filter box that searches every name, not just the 48 on the page. It runs in the browser with no Function: the first keystroke loads `/presenters.json` or `/organizations.json` (built by `src/pages/*.json.ts`), and the matches replace the list until the box is cleared. `NameFilter.astro` has the details, including the `data-name-filter-*` elements a list page provides; the matching is in `src/helpers/nameFilter.ts`, with tests.

### Old Rails URLs

Links to the old site keep working. A Cloudflare Pages Function, [`functions/_middleware.ts`](functions/_middleware.ts), sends a 301 to the new slug URL, keeping any query string:

- `/v/:id`, `/:id` (e.g. `/601`), `/episodes/:id` and `/video/<anything>--<id>` go to the video.
- `/organization/:id`, `/organizations/:id`, `/organizations/<slug>`, `/org/:id`, `/o/:id` and `/organization/<anything>--<id>` go to the organization.
- `/presenter/:id`, `/presenters/:id`, `/s/:id` and `/presenter/<anything>--<id>` go to the presenter.
- `/episodes` goes to `/videos` (the one redirect left in `astro.config.mjs`).

As in Rails, only the ID matters in `<name>--<id>`, so links made before a title changed still work. Unknown and inactive IDs fall through to the 404 page.

How it fits together:

- **The map:** the function looks IDs up in `dist/legacy-redirects.json`, which `src/pages/legacy-redirects.json.ts` builds from the active entries. Wrangler bundles that file into the function when it deploys, so **always build before deploying.**
- **Why a function:** these used to be static redirect pages, about 21,000 of them. That put the deployment over Cloudflare Pages' 20,000-file limit, so don't bring back routes that generate a page per entry just to redirect.
- **Invocation cost:** `public/_routes.json` keeps the function off paths that can never redirect (assets, lists, conference and playlist pages). Every other request runs it, and those count against the Workers request quota (100,000 a day on the free plan). Static files don't.
- **Testing:** `pnpm preview` doesn't run the function. Use `pnpm exec wrangler pages dev ./dist`.

### Page metadata

Every page passes its own `title`, `description` and `image` to `BaseHead`, so a link shared on social media or in chat previews that page rather than the site. `BaseHead` writes the `<title>`, description, canonical URL, Open Graph and Twitter tags:

- It adds " | Engineers.SG" to the title, unless the title already names the site.
- It collapses the description (usually the entry's body) to plain text and cuts it to about 200 characters. With no description it uses `SITE_DESCRIPTION`.
- With no image it uses the square site logo (`public/engineerssg-logo.png`) as a small `summary` card. Video thumbnails and playlist images get the large card. Organization logos and presenter photos pass `card="summary"`.
- Paginated pages pass `pageNumber`. Later pages get ", Page N" in the title, and page 1's canonical URL is the bare list URL (`/videos/`, not `/videos/1`), since the index pages rewrite to page 1.

### Images

Organization logos and presenter photos always go through `EntityImage`. It shows `public/placeholder-organization.svg` or `public/placeholder-presenter.svg` when the URL is null, or when the image fails to load (an inline `onerror` swaps it in; many old Twitter image URLs now 404). Don't use a plain `<img>` for them.

Photos we host ourselves are in `public/images/presenters/<id>.jpg` (400×400), and the presenter's `imageUrl` is `/images/presenters/<id>.jpg`.

### Video cards

Every list of videos (the home page, `/videos`, and the organization, presenter and playlist pages) and the search results show the same card: a 16:9 thumbnail, the title, and the date with the presenters' and organizations' names. `VideoCard.astro` renders it inside `<ul class="video-grid">`. The first video of a list is `featured`: full width with a larger title. An organization or presenter page leaves its own name out of the byline (`without`). The styles are global in `src/styles/global.css`, because `search.astro` builds the same card in the browser; if you change the card, change both.

Thumbnails are the stored 480 px YouTube image, cropped to 16:9. For YouTube videos the card also offers the 1280 px `maxresdefault`, so phones and other high-density screens (and the full-width featured card) get a sharp image, and normal screens keep the small download. About 6% of videos have no large thumbnail; `src/helpers/thumbnailFallback.ts` notices (YouTube sends a small 4:3 stand-in picture) and shows the stored one instead.

### Links in descriptions

Descriptions are plain text with their line breaks kept. `LinkedText.astro` shows the URLs in them (`http(s)://…` and `www.…`) as links that open in a new tab. Punctuation after a URL, as in "(see http://a.sg/x).", stays out of the link. A bare domain such as `tiny.tt/asm` isn't linked. Video, organization, presenter and playlist descriptions all use it.

### Presenter and organization links

Presenters and organizations have a `links` list in their frontmatter, shown in that order:

```yaml
links: [{"type":"x","url":"https://x.com/ongchinhwee"},{"type":"website","url":"https://ongchinhwee.me/"}]
```

The types are `x`, `website` (a personal or group site), `linkedin`, `instagram` and `tiktok` (`PROFILE_LINK_TYPES` in `src/consts.ts`). `url` is always a full http(s) URL, and the build fails on one that isn't. `ProfileLinks.astro` shows each with its icon from `LinkIcon.astro` (the network's logo, or a globe for a website), stacked on mobile, and labels X, Instagram and TikTok links with the `@handle`. The presenter page shows them under the byline; the organization page after "Contact: …" when the organization has a `contactPerson`.

To add a link type: add it to `ProfileLinkType` in `@esg/db-types/content`, `PROFILE_LINK_TYPES` and `PROFILE_LINK_NAMES` in `src/consts.ts`, an icon in `LinkIcon.astro`, its handle rules in `packages/content/src/profileLinks.ts`, and a flag in the cms.

### Header

`Header.astro` shows the logo and site name on the left, the section links, and the Twitter and GitHub icons. At 720px wide and under, the name, icons and links collapse: only the logo and a hamburger button show, and the button opens the links as a list below the header.

### Adding a page

- Start each page's `<head>` with `<BaseHead … />`, passing its `title`, `description` and `image`. It loads the global styles, the meta tags and the GTM script.
- Start each page's `<body>` with `<Header />`. It also renders the GTM `<noscript>` fallback, which has to come first in the body.
- Get data through the helpers above, and pass paginated pages to `<Pagination page={page} />`. Its numbered links assume the page number is the last part of the URL.
- If the new URL replaces an old Rails one, add a rule to `RULES` in `functions/_middleware.ts` rather than a redirect page (see above).

## Updating the content

Don't edit hundreds of files by hand: use the tools in this repo, which write `content/` in the right format.

**From YouTube** (the usual way to add new videos and playlists). `packages/yt-export` syncs the channel into `content/`. It updates titles, descriptions and thumbnails of existing entries, adds new ones, and never deletes anything:

```bash
cd packages/yt-export
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content --dry-run   # see what would change
YOUTUBE_API_KEY=... pnpm export --channel @engineerssg --content ../../apps/website/content
```

Videos people submit through the **Submit a video** issue form arrive as pull requests that add them to the Community Contributed playlist (`content/playlist/130.md`, slug `community-contributed`), with their presenters linked or created (see `.github/workflows/VIDEO_SUBMISSION.md`).

New videos from the YouTube sync come in with no organizations or presenters. Link them with the `cms` tool (`pnpm cms assign --video <ref> --presenter <ref> --organization <ref>` from the repo root), which writes each link where it belongs, instead of editing the frontmatter by hand. See [`packages/cms/README.md`](../../packages/cms/README.md), and [`packages/yt-export/README.md`](../../packages/yt-export/README.md) for the sync's matching rules, `--deactivate-missing` and `--exclude-video`.

**From the old database.** `packages/pg-export` regenerates every file from the Rails database's JSON export, which **overwrites** anything edited since. This is only for a fresh start:

```bash
pnpm --filter @esg/pg-export export --from-json ../../output/backup -o ../../apps/website/content
```

Presenter emails are written as `null` unless you pass `--include-emails`. Keep it that way: `content/` is committed and published.

After any change, run `pnpm content` from the repo root (`pnpm cms check`, which CI also runs): it reports links to missing entries, IDs that differ only in case, and leftover reverse lists. Then `pnpm build`.

## Known leftovers

- **Template remnants:** `about.astro` still uses the template's `BlogPost.astro` layout, and `public/blog-placeholder-*.jpg` are unused.
- **Unused files:** `check_query.js` is an old Supabase scratch script whose dependency isn't installed, and `project.json` is an unused Nx config.
- **Not ported from the old site yet:** the static pages (`/events`, `/cal`, `/bookings`, `/live`, `/fb_live`, `/support_us`, `/screenshots`, `/terms`), the old search URLs (`/episodes/search`, `/presenters/search`; search is now `/search` and the list pages' name filters), newsletter signup, `/videos/:tag` and the `/api/*` JSON endpoints.
