import { describe, expect, it } from "vitest";
import type { Episode, Organization, Playlist, Presenter } from "@esg/db-types";
import { frontmatter, slugify, toBody, toIsoTimestamp, toMarkdownFiles, uniqueSlugs, type MarkdownSource } from "./markdown.js";

const stamp = "2016-01-01 10:14:35.104398";

const episode = (id: number, over: Partial<Episode> = {}): Episode => ({
  id,
  video_id: `vid${id}`,
  title: `Talk ${id}`,
  published_at: `2020-01-0${id} 00:00:00`,
  description: `About talk ${id}`,
  image1: `https://i.ytimg.com/vi/vid${id}/default.jpg`,
  image2: `https://i.ytimg.com/vi/vid${id}/mqdefault.jpg`,
  image3: `https://i.ytimg.com/vi/vid${id}/hqdefault.jpg`,
  created_at: stamp,
  updated_at: stamp,
  sort_order: null,
  active: true,
  video_site: 1,
  view_count: 0,
  ...over,
});

const org = (id: number, over: Partial<Organization> = {}): Organization => ({
  id,
  title: `Org ${id}`,
  description: "",
  website: "",
  twitter: "",
  contact_person: "",
  active: true,
  created_at: stamp,
  updated_at: stamp,
  image: "",
  slug: null,
  ...over,
});

const presenter = (id: number, over: Partial<Presenter> = {}): Presenter => ({
  id,
  name: `Person ${id}`,
  biography: "",
  twitter: "",
  email: `person${id}@example.com`,
  website: "",
  active: true,
  created_at: stamp,
  updated_at: stamp,
  byline: "",
  avatar_url: null,
  ...over,
});

const playlist = (id: number, over: Partial<Playlist> = {}): Playlist => ({
  id,
  playlist_id: `PL${id}`,
  name: `Playlist ${id}`,
  description: null,
  publish_date: "2020-01-01",
  image: `https://i.ytimg.com/vi/vid${id}/hqdefault.jpg`,
  active: true,
  created_at: stamp,
  updated_at: stamp,
  website: null,
  hashtag: null,
  playlist_category_id: 1,
  slug: null,
  ...over,
});

const category = (id: number, title: string) => ({ id, title, active: true, created_at: stamp, updated_at: stamp });
const item = (id: number, playlist_id: number, episode_id: number, sort_order: number | null) => ({ id, playlist_id, episode_id, sort_order, created_at: stamp, updated_at: stamp });
const sub = (id: number, playlist_id: number, sub_playlist_id: number, sequence: number) => ({ id, playlist_id, sub_playlist_id, sequence, created_at: stamp, updated_at: stamp });

const vo = (id: number, episode_id: number | null, organization_id: number | null) => ({ id, episode_id, organization_id, created_at: stamp, updated_at: stamp });
const vp = (id: number, episode_id: number | null, presenter_id: number | null) => ({ id, episode_id, presenter_id, created_at: stamp, updated_at: stamp });

function source(over: Partial<MarkdownSource> = {}): MarkdownSource {
  return {
    episodes: [episode(1), episode(2), episode(3)],
    organizations: [org(10)],
    presenters: [presenter(20), presenter(21)],
    video_organizations: [vo(1, 1, 10), vo(2, 3, 10)],
    video_presenters: [vp(1, 1, 21), vp(2, 1, 20), vp(3, 2, 20)],
    playlists: [playlist(30), playlist(31), playlist(32)],
    playlist_categories: [category(1, "Conference"), category(6, "Conference Track")],
    playlist_items: [item(1, 30, 3, 1), item(2, 30, 1, 0), item(3, 31, 1, 0)],
    sub_playlists: [sub(1, 30, 32, 2), sub(2, 30, 31, 1)],
    ...over,
  };
}

/** Parse the JSON-per-line frontmatter this module writes. */
function parse(content: string) {
  const m = /^---\n([\s\S]*?)\n---\n(?:\n([\s\S]*)\n)?$/.exec(content);
  if (!m) throw new Error(`Bad file:\n${content}`);
  const data = Object.fromEntries(
    m[1].split("\n").map((line) => {
      const i = line.indexOf(": ");
      return [line.slice(0, i), JSON.parse(line.slice(i + 2))];
    }),
  );
  return { data, body: m[2] ?? "" };
}

const files = (src = source(), includeEmails = false) =>
  new Map(toMarkdownFiles(src, { includeEmails }).map((f) => [f.path, parse(f.content)]));

describe("toIsoTimestamp", () => {
  it("converts Postgres UTC text to ISO 8601", () => {
    expect(toIsoTimestamp("2023-11-03 06:41:58")).toBe("2023-11-03T06:41:58Z");
  });
  it("keeps milliseconds", () => {
    expect(toIsoTimestamp("2016-01-01 10:14:35.104398")).toBe("2016-01-01T10:14:35.104Z");
    expect(toIsoTimestamp("2016-01-01 10:14:35.1")).toBe("2016-01-01T10:14:35.100Z");
  });
  it("rejects other formats", () => {
    expect(() => toIsoTimestamp("2016-01-01T10:14:35Z")).toThrow();
  });
});

describe("slugs", () => {
  it("slugifies to lowercase ASCII words", () => {
    expect(slugify("Café & Code: Ruby 3.0!")).toBe("cafe-code-ruby-3-0");
    expect(slugify("新加坡")).toBe("");
  });
  it("keeps existing slugs, falls back, and suffixes collisions", () => {
    expect(
      uniqueSlugs([
        { text: "Singapore JS", fallback: "x-1" },
        { existing: "singapore-js", text: "SingaporeJS", fallback: "x-2" },
        { text: "Singapore JS", fallback: "x-3" },
        { text: "新加坡", fallback: "x-4" },
      ]),
    ).toEqual(["singapore-js-2", "singapore-js", "singapore-js-3", "x-4"]);
  });
});

describe("frontmatter", () => {
  it("writes every value as JSON so YAML keeps strings as strings", () => {
    expect(frontmatter({ id: "1", publishedAt: "2020-01-01T00:00:00Z", title: 'a: "b" #c', tags: ["1", "2"], none: null, ok: true })).toBe(
      '---\nid: "1"\npublishedAt: "2020-01-01T00:00:00Z"\ntitle: "a: \\"b\\" #c"\ntags: ["1","2"]\nnone: null\nok: true\n---\n',
    );
  });
});

describe("toBody", () => {
  it("normalizes line endings and trims", () => {
    expect(toBody("Speaker: X\r\n\nhttps://a\n\r\nEnd\r\n")).toBe("Speaker: X\n\nhttps://a\n\nEnd");
    expect(toBody(null)).toBe("");
  });
});

describe("toMarkdownFiles", () => {
  it("writes one file per entry in each collection", () => {
    expect([...files().keys()]).toEqual([
      "video/1.md",
      "video/2.md",
      "video/3.md",
      "organization/10.md",
      "presenter/20.md",
      "presenter/21.md",
      "playlist/30.md",
      "playlist/31.md",
      "playlist/32.md",
    ]);
  });

  it("maps a video, with references and the description as the body", () => {
    expect(files().get("video/1.md")).toEqual({
      data: {
        id: "1",
        videoId: "vid1",
        videoTitle: "Talk 1",
        publishedAt: "2020-01-01T00:00:00Z",
        thumbnailDefault: "https://i.ytimg.com/vi/vid1/default.jpg",
        thumbnailMedium: "https://i.ytimg.com/vi/vid1/mqdefault.jpg",
        thumbnailHigh: "https://i.ytimg.com/vi/vid1/hqdefault.jpg",
        slug: "talk-1",
        organizations: ["10"],
        presenters: ["21", "20"],
        playlists: ["30", "31"],
        active: true,
        videoSite: "youtube",
      },
      body: "About talk 1",
    });
  });

  it("lists an organization's and a presenter's videos newest first", () => {
    const out = files();
    expect(out.get("organization/10.md")!.data.videos).toEqual(["3", "1"]);
    expect(out.get("presenter/20.md")!.data.videos).toEqual(["2", "1"]);
  });

  it("turns blank strings into null and keeps an existing organization slug", () => {
    const out = files(source({ organizations: [org(10, { slug: "org-ten", description: "We meet monthly.", image: " " })] }));
    expect(out.get("organization/10.md")).toEqual({
      data: { id: "10", orgTitle: "Org 10", website: null, twitter: null, logoImage: null, contactPerson: null, slug: "org-ten", active: true, videos: ["3", "1"] },
      body: "We meet monthly.",
    });
  });

  it("leaves presenter emails out unless asked", () => {
    expect(files().get("presenter/20.md")!.data.email).toBeNull();
    expect(files(source(), true).get("presenter/20.md")!.data.email).toBe("person20@example.com");
  });

  it("writes an empty body when there is no description", () => {
    const out = toMarkdownFiles(source({ episodes: [episode(1, { description: null })] }), { includeEmails: false });
    expect(out[0].content.endsWith("---\n")).toBe(true);
  });

  it("suffixes duplicate video slugs in id order", () => {
    const out = files(source({ episodes: [episode(2, { title: "Lightning Talks" }), episode(1, { title: "Lightning Talks" })] }));
    expect(out.get("video/1.md")!.data.slug).toBe("lightning-talks");
    expect(out.get("video/2.md")!.data.slug).toBe("lightning-talks-2");
  });

  it("marks Vimeo videos and keeps inactive ones", () => {
    const out = files(source({ episodes: [episode(1, { video_site: 2, active: false })] }));
    expect(out.get("video/1.md")!.data).toMatchObject({ videoSite: "vimeo", active: false });
  });

  it("drops join rows with nulls, dangling ids and repeats", () => {
    const out = files(
      source({
        video_organizations: [vo(1, 1, 10), vo(2, 1, 10), vo(3, 1, 99), vo(4, 99, 10), vo(5, null, 10)],
      }),
    );
    expect(out.get("video/1.md")!.data.organizations).toEqual(["10"]);
    expect(out.get("organization/10.md")!.data.videos).toEqual(["1"]);
  });

  it("maps a playlist, with videos in playlist order and sub-playlists in sequence order", () => {
    const out = files(source({ playlists: [playlist(30, { description: "Talks from day one.\r\n", hashtag: "#fossasia" }), playlist(31), playlist(32)] }));
    expect(out.get("playlist/30.md")).toEqual({
      data: {
        id: "30",
        playlistId: "PL30",
        playlistTitle: "Playlist 30",
        publishDate: "2020-01-01",
        image: "https://i.ytimg.com/vi/vid30/hqdefault.jpg",
        website: null,
        hashtag: "#fossasia",
        category: "Conference",
        slug: "playlist-30",
        active: true,
        videos: ["1", "3"],
        subPlaylists: ["31", "32"],
      },
      body: "Talks from day one.",
    });
  });

  it("keeps inactive organizations and presenters with active false, and treats a null active as true", () => {
    const out = files(
      source({
        organizations: [org(10, { active: false }), org(11, { active: null }), org(12)],
        presenters: [presenter(20, { active: false }), presenter(21, { active: null }), presenter(22)],
      }),
    );
    expect(["10", "11", "12"].map((id) => out.get(`organization/${id}.md`)!.data.active)).toEqual([false, true, true]);
    expect(["20", "21", "22"].map((id) => out.get(`presenter/${id}.md`)!.data.active)).toEqual([false, true, true]);
  });

  it("keeps inactive playlists with active false, and treats a null active as true", () => {
    const out = files(source({ playlists: [playlist(30, { active: false }), playlist(31, { active: null }), playlist(32)] }));
    expect(["30", "31", "32"].map((id) => out.get(`playlist/${id}.md`)!.data.active)).toEqual([false, true, true]);
  });

  it("breaks sort_order ties by item id and drops dangling playlist items", () => {
    const out = files(source({ playlist_items: [item(3, 30, 2, 0), item(1, 30, 3, 0), item(2, 30, 1, 1), item(4, 30, 99, 0), item(5, 99, 1, 0)] }));
    expect(out.get("playlist/30.md")!.data.videos).toEqual(["3", "2", "1"]);
    expect(out.get("video/1.md")!.data.playlists).toEqual(["30"]);
  });

  it("keeps existing playlist slugs and leaves an unknown category null", () => {
    const out = files(source({ playlists: [playlist(30, { slug: "fossasia-2016", playlist_category_id: 9 }), playlist(31, { name: "FOSSASIA 2016" })] }));
    expect(out.get("playlist/30.md")!.data).toMatchObject({ slug: "fossasia-2016", category: null });
    expect(out.get("playlist/31.md")!.data.slug).toBe("fossasia-2016-2");
  });
});
