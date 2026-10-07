/**
 * Editing operations on the Astro content collections, done on an in-memory copy: create presenters,
 * and link videos to presenters, organizations and playlists. Every link is written on both sides
 * (the video's `presenters` / `organizations` / `playlists` and the other entry's `videos`), in the
 * order pg-export uses (see @esg/content's links.ts).
 *
 * No I/O here: `changes()` returns the files to write, so it can be unit tested and dry-run.
 */
import {
  addVideo,
  append,
  normalizeProfileLink,
  PROFILE_LINK_TYPES,
  profileLinks,
  reconcileLinks,
  serializeEntry,
  slugAllocator,
  toBody,
  VIDEO_LINKS,
  without,
  type Entry,
  type HasVideos,
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

/** Changes to a presenter's or organization's links. */
export interface LinkEdits {
  /** A handle or URL per type: replaces that type's link where it is, or adds one at the end. */
  set?: Partial<Record<ProfileLinkType, string | null>>;
  /** Types whose links are removed. */
  remove?: ProfileLinkType[];
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

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** The ID, slug or external ID in an argument that may be a URL: `/video/<slug>`, `…/watch?v=<id>`, `youtu.be/<id>`. */
export function refKey(ref: string): string {
  const s = ref.trim();
  const param = /[?&](?:v|list)=([\w-]+)/.exec(s);
  if (param) return param[1];
  const parts = s.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").split("/").filter(Boolean);
  // A site path is /<collection>/<slug>[/<page>]; anything shorter is the key itself.
  return parts.length > 1 ? parts[1] : (parts[0] ?? s);
}

export class Cms {
  private readonly items: Record<Collection, Map<string, Item>>;
  /** Notes for the user, e.g. linking to an entry the site doesn't show. */
  readonly warnings = new Set<string>();

  constructor(entries: ContentEntries) {
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

  /**
   * What a new presenter or organization needs before its fields are written: its name, the next free
   * ID, a unique slug (or the one asked for) and its links. Throws if anything is missing or taken.
   */
  private prepareNew(
    collection: "presenter" | "organization",
    input: { name: string; slug?: string | null; links?: Partial<Record<ProfileLinkType, string | null>>; allowDuplicate?: boolean },
  ) {
    const name = blank(input.name);
    if (!name) throw new CmsError(`${collection === "presenter" ? "a presenter" : "an organization"} needs a name`);
    const items = this.items[collection];
    const twin = [...items.values()].find((i) => sameName(titleOf(i.data), name));
    if (twin && !input.allowDuplicate) {
      throw new CmsError(`${collection} ${twin.data.id} (${twin.data.slug}) is already called "${name}"; pass --allow-duplicate to create another`);
    }

    const id = String([...items.keys()].reduce((m, k) => Math.max(m, Number(k) || 0), 0) + 1);
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
      videos: [],
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
      videos: [],
    };
    this.items.organization.set(id, { data, body: toBody(input.description ?? null) });
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

  /** Link a video and an entry of `field`'s collection on both sides. Returns false if already linked. */
  link(videoRef: string, field: VideoLinkField, otherRef: string): boolean {
    const video = this.find("video", videoRef) as Video;
    const other = this.find(VIDEO_LINKS[field], otherRef) as AnyData & HasVideos;
    if (!video.active) this.warnings.add(`video ${video.id} is inactive, so the site doesn't show it`);
    if (!other.active) this.warnings.add(`${VIDEO_LINKS[field]} ${other.id} is inactive, so the site doesn't show it`);
    const had = video[field].includes(other.id) && other.videos.includes(video.id);
    video[field] = append(video[field], other.id);
    other.videos = addVideo(field, other.videos, video.id, (id) => (this.items.video.get(id)?.data as Video | undefined)?.publishedAt);
    return !had;
  }

  /** Remove the link between a video and an entry of `field`'s collection on both sides. Returns false if not linked. */
  unlink(videoRef: string, field: VideoLinkField, otherRef: string): boolean {
    const video = this.find("video", videoRef) as Video;
    const other = this.find(VIDEO_LINKS[field], otherRef) as AnyData & HasVideos;
    const had = video[field].includes(other.id) || other.videos.includes(video.id);
    video[field] = without(video[field], other.id);
    other.videos = without(other.videos, video.id);
    return had;
  }

  /** Complete every one-sided link, for all three relations. Returns how many entries changed per relation. */
  reconcile(): Record<VideoLinkField, number> {
    const videos = new Map([...this.items.video].map(([id, i]) => [id, i.data as Video]));
    const counts = {} as Record<VideoLinkField, number>;
    for (const field of Object.keys(VIDEO_LINKS) as VideoLinkField[]) {
      const others = new Map([...this.items[VIDEO_LINKS[field]]].map(([id, i]) => [id, i.data as AnyData & HasVideos]));
      const changed = reconcileLinks(field, videos, others);
      counts[field] = changed.videos.size + changed.others.size;
    }
    return counts;
  }

  /** The files that differ from what was read, new ones included, in collection then ID order. */
  changes(): Change[] {
    const out: Change[] = [];
    for (const [collection, items] of Object.entries(this.items)) {
      const sorted = [...items.entries()].sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b));
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
