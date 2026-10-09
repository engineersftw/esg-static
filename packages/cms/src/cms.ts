/**
 * Editing operations on the Astro content collections, done on an in-memory copy: add YouTube videos,
 * create presenters, organizations and playlists, and link videos to presenters, organizations and playlists.
 * Each link is stored on one side only (see @esg/content's links.ts): a video's `presenters` and
 * `organizations`, a playlist's `videos`. New entries get IDs that can't clash with another
 * contributor's (see @esg/content's ids.ts).
 *
 * No I/O here: `changes()` returns the files to write, so it can be unit tested and dry-run.
 */
import {
  append,
  caseClashes,
  compareIds,
  normalizeProfileLink,
  playlistEntryId,
  PROFILE_LINK_TYPES,
  profileLinks,
  randomEntryId,
  serializeEntry,
  slugAllocator,
  toBody,
  unusedId,
  VIDEO_LINKS,
  videoEntryId,
  without,
  type Entry,
  type VideoLinkField,
} from "@esg/content";
import type { Collection, Organization, Playlist, Presenter, ProfileLink, ProfileLinkType, Video } from "@esg/db-types/content";

export interface ContentEntries {
  video: Entry<Video>[];
  organization: Entry<Organization>[];
  presenter: Entry<Presenter>[];
  playlist: Entry<Playlist>[];
}

type AnyData = Video | Organization | Presenter | Playlist;

interface Item<T extends AnyData = AnyData> {
  /** The file as read; absent for a new entry. */
  before?: Entry<T>;
  data: T;
  body: string;
}

export interface Change {
  kind: "create" | "update";
  /** Relative to the content directory, e.g. "presenter/1234.md". */
  path: string;
  content: string;
  title: string;
}

export interface NewPresenter {
  name: string;
  byline?: string | null;
  /** A handle or URL per link type (a website is a personal site); written in `PROFILE_LINK_TYPES` order. */
  links?: Partial<Record<ProfileLinkType, string | null>>;
  email?: string | null;
  imageUrl?: string | null;
  /** The biography, the Markdown body. */
  bio?: string | null;
  slug?: string | null;
  active?: boolean;
  /** Create it even if a presenter with the same name exists. */
  allowDuplicate?: boolean;
}

export interface NewOrganization {
  name: string;
  /** A handle or URL per link type (a website is the group's site); written in `PROFILE_LINK_TYPES` order. */
  links?: Partial<Record<ProfileLinkType, string | null>>;
  logoImage?: string | null;
  contactPerson?: string | null;
  /** The description, the Markdown body. */
  description?: string | null;
  slug?: string | null;
  active?: boolean;
  /** Create it even if an organization with the same name exists. */
  allowDuplicate?: boolean;
}

/** The categories a playlist can have, as the site's pages and pg-export know them. */
export const PLAYLIST_CATEGORIES = ["Conference", "Conference Track", "Meetup", "Tutorial", "Training", "Shows"] as const;

export interface NewPlaylist {
  title: string;
  /** Matched case-insensitively against `PLAYLIST_CATEGORIES`. */
  category?: string | null;
  /** The YouTube playlist ID, if there is one; the daily sync then refreshes the playlist. */
  playlistId?: string | null;
  /** YYYY-MM-DD: the event date, which sorts conferences. */
  publishDate?: string | null;
  image?: string | null;
  website?: string | null;
  hashtag?: string | null;
  /** The description, the Markdown body. */
  description?: string | null;
  slug?: string | null;
  active?: boolean;
  /** Create it even if a playlist with the same title exists. */
  allowDuplicate?: boolean;
}

/** Changes to a presenter's or organization's links. */
export interface LinkEdits {
  /** A handle or URL per type: replaces that type's link where it is, or adds one at the end. */
  set?: Partial<Record<ProfileLinkType, string | null>>;
  /** Types whose links are removed. */
  remove?: ProfileLinkType[];
}

/** A YouTube video to add, as the YouTube Data API describes it. */
export interface NewVideo {
  videoId: string;
  title: string;
  /** ISO 8601 UTC, as YouTube gives it. */
  publishedAt: string;
  thumbnails: { default?: string | null; medium?: string | null; high?: string | null };
  /** The description, the Markdown body. */
  description?: string | null;
  active?: boolean;
}

export class CmsError extends Error {}

/** The display title of an entry of any collection. */
export function titleOf(data: AnyData): string {
  if ("videoTitle" in data) return data.videoTitle;
  if ("orgTitle" in data) return data.orgTitle;
  if ("presenterName" in data) return data.presenterName.trim();
  return data.playlistTitle;
}

const blank = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/** A name as compared: trimmed, single-spaced, lowercase and without accents, so "José  Tan" is "jose tan". */
export const nameKey = (name: string) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

/** The ID, slug or external ID in an argument that may be a URL: `/video/<slug>`, `…/watch?v=<id>`, `youtu.be/<id>`. */
export function refKey(ref: string): string {
  const s = ref.trim();
  const param = /[?&](?:v|list)=([\w-]+)/.exec(s);
  if (param) return param[1];
  const parts = s.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").split("/").filter(Boolean);
  // A site path is /<collection>/<slug>[/<page>]; anything shorter is the key itself.
  return parts.length > 1 ? parts[1] : (parts[0] ?? s);
}

/** Most videos one range like "4600-4700" may name. */
const MAX_RANGE = 1000;

/**
 * Video refs from command-line values: each value may list refs separated by commas, and an
 * "a-b" pair of entry IDs is every ID from a to b. Other refs (slugs, YouTube IDs, URLs) are kept as
 * written, and repeats are dropped.
 */
export function expandVideoRefs(values: string[]): string[] {
  const refs: string[] = [];
  for (const part of values.flatMap((v) => v.split(","))) {
    const ref = part.trim();
    if (!ref) continue;
    const range = /^(\d{1,7})-(\d{1,7})$/.exec(ref);
    if (!range) {
      refs.push(ref);
      continue;
    }
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (from > to) throw new CmsError(`range "${ref}" runs backwards`);
    if (to - from >= MAX_RANGE) throw new CmsError(`range "${ref}" names more than ${MAX_RANGE} videos`);
    for (let id = from; id <= to; id++) refs.push(String(id));
  }
  return [...new Set(refs)];
}

export class Cms {
  private readonly items: Record<Collection, Map<string, Item>>;
  /** Notes for the user, e.g. linking to an entry the site doesn't show. */
  readonly warnings = new Set<string>();
  private readonly randomId: () => string;

  /** `randomId` makes the random IDs of new presenters, organizations and hand-made playlists. */
  constructor(entries: ContentEntries, { randomId = randomEntryId }: { randomId?: () => string } = {}) {
    this.randomId = randomId;
    const load = <T extends AnyData>(list: Entry<T>[]) =>
      new Map<string, Item>(list.map((e) => [e.id, { before: e, data: { ...e.data }, body: e.body } as Item]));
    this.items = {
      video: load(entries.video),
      organization: load(entries.organization),
      presenter: load(entries.presenter),
      playlist: load(entries.playlist),
    };
  }

  /**
   * The entry an argument names: its ID, its slug, or for videos the YouTube video ID and for
   * playlists the YouTube playlist ID. A site URL or path (`/video/<slug>`) or a YouTube URL works too.
   */
  find(collection: Collection, ref: string): AnyData {
    const r = refKey(ref);
    const items = this.items[collection];
    const byId = items.get(r);
    if (byId) return byId.data;
    const matches = [...items.values()].filter(({ data: d }) => {
      if (d.slug === r) return true;
      if ("videoId" in d) return d.videoId === r;
      if ("playlistId" in d) return d.playlistId === r;
      return false;
    });
    if (matches.length === 1) return matches[0].data;
    if (!matches.length) {
      const by = collection === "video" ? "ID, slug or YouTube ID" : collection === "playlist" ? "ID, slug or playlist ID" : "ID or slug";
      throw new CmsError(`no ${collection} matches "${ref}" (by ${by})`);
    }
    throw new CmsError(`"${ref}" matches several ${collection} entries: ${matches.map((m) => m.data.id).join(", ")}; use the ID`);
  }

  /** Entries whose ID, slug, title or external ID contains `text` (case-insensitive). */
  search(collection: Collection, text: string): AnyData[] {
    const q = text.trim().toLowerCase();
    return [...this.items[collection].values()]
      .map((i) => i.data)
      .filter((d) => {
        const fields = [d.id, d.slug, titleOf(d), "videoId" in d ? d.videoId : null, "playlistId" in d ? d.playlistId : null];
        return fields.some((f) => f?.toLowerCase().includes(q));
      });
  }

  /** The IDs of the videos a playlist lists, in its order. */
  playlistVideos(ref: string): string[] {
    return [...(this.find("playlist", ref) as Playlist).videos];
  }

  /** Presenters with this name (see `nameKey`), active ones first, then by most videos. */
  presentersNamed(name: string): Presenter[] {
    const key = nameKey(name);
    return [...this.items.presenter.values()]
      .map((i) => i.data as Presenter)
      .filter((p) => nameKey(p.presenterName) === key)
      .sort((a, b) => Number(b.active) - Number(a.active) || this.videoCount("presenters", b.id) - this.videoCount("presenters", a.id) || compareIds(a.id, b.id));
  }

  /** How many videos list this presenter or organization. */
  videoCount(field: "presenters" | "organizations", id: string): number {
    let n = 0;
    for (const { data } of this.items.video.values()) if ((data as Video)[field].includes(id)) n++;
    return n;
  }

  /** A new ID for `collection` from `make`, unless an entry already has it (ignoring case). */
  private newId(collection: Collection, make: () => string, what: string): string {
    try {
      return unusedId(make, this.items[collection].keys(), what);
    } catch (e) {
      throw new CmsError((e as Error).message);
    }
  }

  /**
   * Add a YouTube video, with the ID `yt-<YouTube ID>` and a unique slug from its title, and no links yet.
   * The fields are the ones yt-export's sync writes for a new video, so the daily sync refreshes it
   * like any other. Throws if a video with the same YouTube ID exists.
   */
  createVideo(input: NewVideo): Video {
    const existing = [...this.items.video.values()].find((i) => (i.data as Video).videoSite === "youtube" && (i.data as Video).videoId === input.videoId);
    if (existing) throw new CmsError(`video ${existing.data.id} (${existing.data.slug}) is already YouTube video ${input.videoId}`);
    const id = this.newId("video", () => videoEntryId("youtube", input.videoId), `a video whose ID differs from ${videoEntryId("youtube", input.videoId)} only in case`);
    const slug = slugAllocator([...this.items.video.values()].map((i) => i.data.slug))(input.title, `video-${id}`);
    // Field order as yt-export's sync writes it.
    const data: Video = {
      id,
      videoId: input.videoId,
      videoTitle: input.title,
      publishedAt: input.publishedAt,
      thumbnailDefault: blank(input.thumbnails.default),
      thumbnailMedium: blank(input.thumbnails.medium),
      thumbnailHigh: blank(input.thumbnails.high),
      slug,
      organizations: [],
      presenters: [],
      active: input.active ?? true,
      videoSite: "youtube",
    };
    this.items.video.set(id, { data, body: toBody(input.description ?? null) });
    return data;
  }

  /**
   * What a new presenter, organization or playlist needs before its fields are written: its name, a
   * new ID (random unless `makeId` says otherwise), a unique slug (or the one asked for) and its
   * links. Throws if anything is missing or taken.
   */
  private prepareNew(
    collection: "presenter" | "organization" | "playlist",
    input: { name: string; slug?: string | null; links?: Partial<Record<ProfileLinkType, string | null>>; allowDuplicate?: boolean },
    makeId: () => string = this.randomId,
  ) {
    const name = blank(input.name);
    if (!name) throw new CmsError(`${{ presenter: "a presenter", organization: "an organization", playlist: "a playlist" }[collection]} needs a ${collection === "playlist" ? "title" : "name"}`);
    const items = this.items[collection];
    const twin = [...items.values()].find((i) => sameName(titleOf(i.data), name));
    if (twin && !input.allowDuplicate) {
      throw new CmsError(`${collection} ${twin.data.id} (${twin.data.slug}) is already called "${name}"; pass --allow-duplicate to create another`);
    }

    const id = this.newId(collection, makeId, `a ${collection} with that ID`);
    const slugs = [...items.values()].map((i) => i.data.slug);
    let slug: string;
    if (input.slug) {
      slug = input.slug.trim();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new CmsError(`slug "${slug}" must be lowercase letters, digits and single dashes`);
      if (slugs.includes(slug)) throw new CmsError(`slug "${slug}" is already used by another ${collection}`);
    } else {
      slug = slugAllocator(slugs)(name, `${collection}-${id}`);
    }

    try {
      return { name, id, slug, links: profileLinks(input.links ?? {}) };
    } catch (e) {
      throw new CmsError((e as Error).message);
    }
  }

  createPresenter(input: NewPresenter): Presenter {
    const { name, id, slug, links } = this.prepareNew("presenter", input);
    // Field order as pg-export writes it.
    const data: Presenter = {
      id,
      presenterName: name,
      presenterByline: blank(input.byline),
      links,
      email: blank(input.email),
      imageUrl: blank(input.imageUrl),
      slug,
      active: input.active ?? true,
    };
    this.items.presenter.set(id, { data, body: toBody(input.bio ?? null) });
    return data;
  }

  createOrganization(input: NewOrganization): Organization {
    const { name, id, slug, links } = this.prepareNew("organization", input);
    // Field order as pg-export writes it.
    const data: Organization = {
      id,
      orgTitle: name,
      links,
      logoImage: blank(input.logoImage),
      contactPerson: blank(input.contactPerson),
      slug,
      active: input.active ?? true,
    };
    this.items.organization.set(id, { data, body: toBody(input.description ?? null) });
    return data;
  }

  /**
   * Add a playlist with no videos yet (link them with `link`). Like the community playlist, one with
   * no `playlistId` is left alone by the YouTube sync.
   */
  createPlaylist(input: NewPlaylist): Playlist {
    const playlistId = blank(input.playlistId);
    if (playlistId) {
      const twin = [...this.items.playlist.values()].find((i) => (i.data as Playlist).playlistId === playlistId);
      if (twin) throw new CmsError(`playlist ${twin.data.id} (${twin.data.slug}) is already YouTube playlist ${playlistId}`);
    }
    const { name, id, slug } = this.prepareNew(
      "playlist",
      { name: input.title, slug: input.slug, allowDuplicate: input.allowDuplicate },
      playlistId ? () => playlistEntryId(playlistId) : this.randomId,
    );

    const category = blank(input.category);
    let canonical: string | null = null;
    if (category) {
      canonical = PLAYLIST_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase()) ?? null;
      if (!canonical) throw new CmsError(`unknown category "${category}"; use ${PLAYLIST_CATEGORIES.join(", ")}`);
    }

    const publishDate = blank(input.publishDate);
    if (publishDate && (!/^\d{4}-\d{2}-\d{2}$/.test(publishDate) || Number.isNaN(Date.parse(publishDate)))) {
      throw new CmsError(`publish date "${publishDate}" must be a date as YYYY-MM-DD`);
    }

    // Field order as yt-export's sync writes it.
    const data: Playlist = {
      id,
      playlistId,
      playlistTitle: name,
      publishDate,
      image: blank(input.image),
      website: blank(input.website),
      hashtag: blank(input.hashtag),
      category: canonical,
      slug,
      active: input.active ?? true,
      videos: [],
      subPlaylists: [],
    };
    this.items.playlist.set(id, { data, body: toBody(input.description ?? null) });
    return data;
  }

  /**
   * Change a presenter's or organization's links and return them. Every value is checked before
   * anything changes, so an invalid one leaves the links as they were.
   */
  editLinks(collection: "presenter" | "organization", ref: string, edits: LinkEdits): ProfileLink[] {
    const entry = this.find(collection, ref) as Presenter | Organization;
    const remove = new Set(edits.remove ?? []);
    const set: ProfileLink[] = [];
    for (const type of PROFILE_LINK_TYPES) {
      const value = blank(edits.set?.[type]);
      if (!value) continue;
      if (remove.has(type)) throw new CmsError(`the ${type} link can't be both set and removed`);
      const url = normalizeProfileLink(type, value);
      if (!url) throw new CmsError(`"${value}" is not a valid ${type} link`);
      set.push({ type, url });
    }

    let links = entry.links.filter((l) => !remove.has(l.type));
    for (const link of set) {
      const i = links.findIndex((l) => l.type === link.type);
      links = i < 0 ? [...links, link] : [...links.slice(0, i), link, ...links.slice(i + 1).filter((l) => l.type !== link.type)];
    }
    entry.links = links;
    return links;
  }

  /**
   * Link a video and an entry of `field`'s collection: the video's `presenters` or `organizations`
   * gets the entry, or the playlist's `videos` gets the video. Returns false if already linked.
   */
  link(videoRef: string, field: VideoLinkField, otherRef: string): boolean {
    const video = this.find("video", videoRef) as Video;
    const other = this.find(VIDEO_LINKS[field], otherRef);
    if (!video.active) this.warnings.add(`video ${video.id} is inactive, so the site doesn't show it`);
    if (!other.active) this.warnings.add(`${VIDEO_LINKS[field]} ${other.id} is inactive, so the site doesn't show it`);
    if (field === "playlists") {
      const playlist = other as Playlist;
      const had = playlist.videos.includes(video.id);
      playlist.videos = append(playlist.videos, video.id);
      return !had;
    }
    const had = video[field].includes(other.id);
    video[field] = append(video[field], other.id);
    return !had;
  }

  /** Remove the link between a video and an entry of `field`'s collection. Returns false if not linked. */
  unlink(videoRef: string, field: VideoLinkField, otherRef: string): boolean {
    const video = this.find("video", videoRef) as Video;
    const other = this.find(VIDEO_LINKS[field], otherRef);
    if (field === "playlists") {
      const playlist = other as Playlist;
      const had = playlist.videos.includes(video.id);
      playlist.videos = without(playlist.videos, video.id);
      return had;
    }
    const had = video[field].includes(other.id);
    video[field] = without(video[field], other.id);
    return had;
  }

  /**
   * Problems in the content: links to entries that don't exist, IDs that differ only in case (which
   * overwrite each other on macOS and Windows), and leftover reverse link lists. Empty when all is well.
   */
  problems(): string[] {
    const out: string[] = [];
    const missing = (from: string, collection: Collection, ids: string[]) => {
      for (const id of ids) if (!this.items[collection].has(id)) out.push(`${from} links to ${collection} ${id}, which doesn't exist`);
    };
    for (const [id, { data }] of this.items.video) {
      missing(`video ${id}`, "presenter", (data as Video).presenters);
      missing(`video ${id}`, "organization", (data as Video).organizations);
    }
    for (const [id, { data }] of this.items.playlist) {
      missing(`playlist ${id}`, "video", (data as Playlist).videos);
      missing(`playlist ${id}`, "playlist", (data as Playlist).subPlaylists);
    }
    for (const [collection, items] of Object.entries(this.items)) {
      for (const group of caseClashes(items.keys())) out.push(`${collection} IDs differ only in case: ${group.join(", ")}`);
    }
    // Lists from before links were stored on one side; a branch made before then can bring them back.
    for (const [collection, field] of [["video", "playlists"], ["presenter", "videos"], ["organization", "videos"]] as const) {
      for (const [id, { data }] of this.items[collection]) {
        if (field in data) out.push(`${collection} ${id} has a "${field}" list, which is no longer used: remove it (the other side holds the link)`);
      }
    }
    return out;
  }

  /** The files that differ from what was read, new ones included, in collection then ID order. */
  changes(): Change[] {
    const out: Change[] = [];
    for (const [collection, items] of Object.entries(this.items)) {
      const sorted = [...items.entries()].sort(([a], [b]) => compareIds(a, b));
      for (const [id, item] of sorted) {
        const content = serializeEntry(item.data, item.body);
        if (item.before && content === item.before.text) continue;
        out.push({
          kind: item.before ? "update" : "create",
          path: item.before?.path ?? `${collection}/${id}.md`,
          content,
          title: titleOf(item.data),
        });
      }
    }
    return out;
  }
}
