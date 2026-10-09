/**
 * Pure transform from Engineers.SG database rows to Markdown files for Astro content
 * collections: one file per video, organization, presenter and playlist, at `<collection>/<id>.md`.
 * Frontmatter is shaped by @esg/db-types/content, and each description becomes the body.
 */
import {
  VideoSite,
  type Episode,
  type Organization,
  type Playlist,
  type PlaylistCategory,
  type PlaylistItem,
  type Presenter,
  type SubPlaylist,
  type Timestamp,
  type VideoOrganization,
  type VideoPresenter,
} from "@esg/db-types";
import {
  Collection,
  type IsoTimestamp,
  type Organization as OrganizationEntry,
  type Playlist as PlaylistEntry,
  type Presenter as PresenterEntry,
  type ProfileLink,
  type Video as VideoEntry,
} from "@esg/db-types/content";

/** Tables the Markdown export reads, by table name. */
export const MARKDOWN_TABLES = [
  "episodes",
  "organizations",
  "presenters",
  "video_organizations",
  "video_presenters",
  "playlists",
  "playlist_categories",
  "playlist_items",
  "sub_playlists",
] as const;

export interface MarkdownSource {
  episodes: Episode[];
  organizations: Organization[];
  presenters: Presenter[];
  video_organizations: VideoOrganization[];
  video_presenters: VideoPresenter[];
  playlists: Playlist[];
  playlist_categories: PlaylistCategory[];
  playlist_items: PlaylistItem[];
  sub_playlists: SubPlaylist[];
}

export interface MarkdownOptions {
  /** Write presenters' email addresses; otherwise `email` is null. */
  includeEmails: boolean;
}

export interface MarkdownFile {
  /** Relative to the output directory, e.g. "video/4442.md". */
  path: string;
  content: string;
}

/** Postgres `timestamp` text in UTC ("2023-11-03 06:41:58[.ffffff]") → "2023-11-03T06:41:58[.fff]Z". */
export function toIsoTimestamp(ts: Timestamp): IsoTimestamp {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(ts);
  if (!m) throw new Error(`Unexpected timestamp "${ts}"`);
  const ms = m[3] ? `.${m[3].slice(0, 3).padEnd(3, "0")}` : "";
  return `${m[1]}T${m[2]}${ms}Z`;
}

/** Lowercase ASCII words joined by hyphens; "" when nothing is left (e.g. a title in Chinese). */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * One slug per item, unique within the list. Existing slugs are kept and reserved first; the
 * rest are slugified from `text`, falling back to `fallback`, with -2, -3, … on collisions.
 */
export function uniqueSlugs(items: { existing?: string | null; text: string; fallback: string }[]): string[] {
  const used = new Set(items.map((i) => i.existing).filter((s): s is string => !!s));
  return items.map((item) => {
    if (item.existing) return item.existing;
    const base = slugify(item.text) || item.fallback;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  });
}

/** YAML frontmatter. Every value is written as JSON, which is valid YAML, so strings stay strings. */
export function frontmatter(data: object): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Normalize line endings and trim; "" for null. */
export function toBody(text: string | null): string {
  return (text ?? "").replace(/\r\n?/g, "\n").trim();
}

const blankToNull = (s: string | null) => (s?.trim() ? s.trim() : null);

/**
 * The content's `links` from the old `twitter` and `website` columns, as full URLs (the same rules as
 * normalizeProfileLink in @esg/content, which this build-step package can't import). The old site kept
 * LinkedIn profiles in the website column, so those become `linkedin` links. A handle that isn't one,
 * or a website that isn't a URL, is dropped.
 */
export function oldProfileLinks(twitter: string | null, website: string | null): ProfileLink[] {
  const links: ProfileLink[] = [];
  const handle = blankToNull(twitter)
    ?.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle)) links.push({ type: "x", url: `https://x.com/${handle}` });

  let site = blankToNull(website)
    ?.replace(/^(https?:\/\/)+(https?:\/\/)/i, "$2")
    .replace(/^(https?)\/\//i, "$1://");
  if (site && !/\s/.test(site)) {
    if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
    try {
      const host = new URL(site).hostname.toLowerCase();
      if (host.includes(".")) {
        const linkedin = host === "linkedin.com" || host.endsWith(".linkedin.com");
        links.push({ type: linkedin ? "linkedin" : "website", url: site });
      }
    } catch {
      // Not a URL: dropped.
    }
  }
  return links;
}

const file = (collection: Collection, id: string, data: object, body: string | null): MarkdownFile => {
  const text = toBody(body);
  return { path: `${collection}/${id}.md`, content: frontmatter(data) + (text ? `\n${text}\n` : "") };
};

const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;

/** Group join rows into id → related ids, dropping nulls, dangling ids and repeats; keeps `order` (default: join row id). */
function relate<R extends { id: number }>(
  rows: R[],
  from: (r: R) => number | null,
  to: (r: R) => number | null,
  valid: Set<number>,
  order: (a: R, b: R) => number = byId,
) {
  const map = new Map<number, string[]>();
  for (const r of [...rows].sort(order)) {
    const f = from(r);
    const t = to(r);
    if (f == null || t == null || !valid.has(t)) continue;
    const list = map.get(f) ?? [];
    if (!list.includes(String(t))) list.push(String(t));
    map.set(f, list);
  }
  return map;
}

export function toMarkdownFiles(src: MarkdownSource, opts: MarkdownOptions): MarkdownFile[] {
  const episodes = [...src.episodes].sort(byId);
  const organizations = [...src.organizations].sort(byId);
  const presenters = [...src.presenters].sort(byId);
  const playlists = [...src.playlists].sort(byId);

  const episodeIds = new Set(episodes.map((e) => e.id));
  const orgsByEpisode = relate(src.video_organizations, (r) => r.episode_id, (r) => r.organization_id, new Set(organizations.map((o) => o.id)));
  const presentersByEpisode = relate(src.video_presenters, (r) => r.episode_id, (r) => r.presenter_id, new Set(presenters.map((p) => p.id)));
  const playlistIds = new Set(playlists.map((p) => p.id));
  const videosByPlaylist = relate(src.playlist_items, (r) => r.playlist_id, (r) => r.episode_id, episodeIds, (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
  const subPlaylists = relate(src.sub_playlists, (r) => r.playlist_id, (r) => r.sub_playlist_id, playlistIds, (a, b) => a.sequence - b.sequence || a.id - b.id);
  const categoryTitle = new Map(src.playlist_categories.map((c) => [c.id, blankToNull(c.title)]));

  const files: MarkdownFile[] = [];

  const episodeSlugs = uniqueSlugs(episodes.map((e) => ({ text: e.title ?? "", fallback: `video-${e.id}` })));
  episodes.forEach((e, i) => {
    const data: VideoEntry = {
      id: String(e.id),
      videoId: e.video_id ?? "",
      videoTitle: e.title ?? "",
      publishedAt: toIsoTimestamp(e.published_at ?? e.created_at),
      thumbnailDefault: blankToNull(e.image1),
      thumbnailMedium: blankToNull(e.image2),
      thumbnailHigh: blankToNull(e.image3),
      slug: episodeSlugs[i],
      organizations: orgsByEpisode.get(e.id) ?? [],
      presenters: presentersByEpisode.get(e.id) ?? [],
      active: e.active,
      videoSite: e.video_site === VideoSite.Vimeo ? "vimeo" : "youtube",
    };
    files.push(file(Collection.Video, data.id, data, e.description));
  });

  const orgSlugs = uniqueSlugs(organizations.map((o) => ({ existing: blankToNull(o.slug), text: o.title, fallback: `organization-${o.id}` })));
  organizations.forEach((o, i) => {
    const data: OrganizationEntry = {
      id: String(o.id),
      orgTitle: o.title,
      links: oldProfileLinks(o.twitter, o.website),
      logoImage: blankToNull(o.image),
      contactPerson: blankToNull(o.contact_person),
      slug: orgSlugs[i],
      // `active` is nullable in the database and defaults to true.
      active: o.active !== false,
    };
    files.push(file(Collection.Organization, data.id, data, o.description));
  });

  const presenterSlugs = uniqueSlugs(presenters.map((p) => ({ text: p.name, fallback: `presenter-${p.id}` })));
  presenters.forEach((p, i) => {
    const data: PresenterEntry = {
      id: String(p.id),
      presenterName: p.name,
      presenterByline: blankToNull(p.byline),
      links: oldProfileLinks(p.twitter, p.website),
      email: opts.includeEmails ? blankToNull(p.email) : null,
      imageUrl: blankToNull(p.avatar_url),
      slug: presenterSlugs[i],
      active: p.active !== false,
    };
    files.push(file(Collection.Presenter, data.id, data, p.biography));
  });

  const playlistSlugs = uniqueSlugs(playlists.map((p) => ({ existing: blankToNull(p.slug), text: p.name ?? "", fallback: `playlist-${p.id}` })));
  playlists.forEach((p, i) => {
    const data: PlaylistEntry = {
      id: String(p.id),
      playlistId: blankToNull(p.playlist_id),
      playlistTitle: p.name ?? "",
      publishDate: p.publish_date,
      image: blankToNull(p.image),
      website: blankToNull(p.website),
      hashtag: blankToNull(p.hashtag),
      category: p.playlist_category_id == null ? null : (categoryTitle.get(p.playlist_category_id) ?? null),
      slug: playlistSlugs[i],
      active: p.active !== false,
      videos: videosByPlaylist.get(p.id) ?? [],
      subPlaylists: subPlaylists.get(p.id) ?? [],
    };
    files.push(file(Collection.Playlist, data.id, data, p.description));
  });

  return files;
}
