import { describe, expect, it } from "vitest";
import { parseEntry, serializeEntry, type Entry } from "@esg/content";
import type { Organization, Playlist, Presenter, Video } from "@esg/db-types/content";
import { Cms, CmsError, refKey, type ContentEntries } from "./cms.js";

const entry = <T extends object>(path: string, data: T, body = "") => parseEntry<T>(path, serializeEntry(data, body));

function video(id: string, publishedAt: string, over: Partial<Video> = {}): Entry<Video> {
  return entry(`video/${id}.md`, {
    id,
    videoId: `yt${id}`,
    videoTitle: `Video ${id}`,
    publishedAt,
    thumbnailDefault: null,
    thumbnailMedium: null,
    thumbnailHigh: null,
    slug: `video-${id}`,
    organizations: [],
    presenters: [],
    playlists: [],
    active: true,
    videoSite: "youtube",
    ...over,
  } satisfies Video);
}

function presenter(id: string, name: string, over: Partial<Presenter> = {}): Entry<Presenter> {
  return entry(`presenter/${id}.md`, {
    id,
    presenterName: name,
    presenterByline: null,
    twitter: null,
    email: null,
    website: null,
    linkedin: null,
    imageUrl: null,
    slug: name.toLowerCase().replace(/ /g, "-"),
    active: true,
    videos: [],
    ...over,
  } satisfies Presenter);
}

function organization(id: string, over: Partial<Organization> = {}): Entry<Organization> {
  return entry(`organization/${id}.md`, {
    id,
    orgTitle: `Org ${id}`,
    website: null,
    twitter: null,
    logoImage: null,
    contactPerson: null,
    slug: `org-${id}`,
    active: true,
    videos: [],
    ...over,
  } satisfies Organization);
}

function playlist(id: string, over: Partial<Playlist> = {}): Entry<Playlist> {
  return entry(`playlist/${id}.md`, {
    id,
    playlistId: `PL${id}`,
    playlistTitle: `Playlist ${id}`,
    publishDate: null,
    image: null,
    website: null,
    hashtag: null,
    category: "Meetup",
    slug: `playlist-${id}`,
    active: true,
    videos: [],
    subPlaylists: [],
    ...over,
  } satisfies Playlist);
}

function content(over: Partial<ContentEntries> = {}): ContentEntries {
  return {
    video: [video("1", "2020-01-01T00:00:00Z"), video("2", "2021-01-01T00:00:00Z"), video("3", "2022-01-01T00:00:00Z")],
    organization: [organization("5", { videos: ["3", "1"] })],
    presenter: [presenter("7", "Jane Doe"), presenter("9", "Ann Lee", { videos: ["3", "1"] })],
    playlist: [playlist("4", { videos: ["1", "3"] })],
    ...over,
  };
}

const data = (cms: Cms, path: string) => {
  const c = cms.changes().find((x) => x.path === path);
  if (!c) throw new Error(`no change to ${path}`);
  return parseEntry<Record<string, unknown>>(path, c.content);
};

describe("refKey", () => {
  it("takes the key out of IDs, paths and URLs", () => {
    expect(refKey("123")).toBe("123");
    expect(refKey(" jane-doe ")).toBe("jane-doe");
    expect(refKey("/presenter/jane-doe")).toBe("jane-doe");
    expect(refKey("https://engineers.sg/conference/pyconsg-2019/2")).toBe("pyconsg-2019");
    expect(refKey("https://www.youtube.com/watch?v=JUqZxUlixSw&t=10")).toBe("JUqZxUlixSw");
    expect(refKey("https://youtu.be/JUqZxUlixSw")).toBe("JUqZxUlixSw");
    expect(refKey("https://www.youtube.com/playlist?list=PLMrPH")).toBe("PLMrPH");
  });
});

describe("find", () => {
  it("finds by ID, slug, YouTube video ID and playlist ID", () => {
    const cms = new Cms(content());
    expect(cms.find("presenter", "7").id).toBe("7");
    expect(cms.find("presenter", "ann-lee").id).toBe("9");
    expect(cms.find("video", "yt2").id).toBe("2");
    expect(cms.find("video", "/video/video-3").id).toBe("3");
    expect(cms.find("playlist", "PL4").id).toBe("4");
  });

  it("fails on no match and on an ambiguous one", () => {
    const cms = new Cms(content({ video: [video("1", "2020-01-01T00:00:00Z"), video("2", "2020-01-01T00:00:00Z", { slug: "yt1" })] }));
    expect(() => cms.find("presenter", "nobody")).toThrow(CmsError);
    expect(() => cms.find("video", "yt1")).toThrow(/several/);
  });
});

describe("createPresenter", () => {
  it("takes the next ID, makes a unique slug and writes the fields in pg-export order", () => {
    const cms = new Cms(content({ presenter: [presenter("7", "Jane Doe"), presenter("12", "Someone", { slug: "john-tan" })] }));
    const p = cms.createPresenter({ name: "  John Tan ", twitter: "@jtan", byline: " ", bio: "Builds things.\r\nSometimes." });

    expect(p.id).toBe("13");
    expect(cms.changes()).toEqual([
      {
        kind: "create",
        path: "presenter/13.md",
        title: "John Tan",
        content: `---
id: "13"
presenterName: "John Tan"
presenterByline: null
twitter: "jtan"
email: null
website: null
linkedin: null
imageUrl: null
slug: "john-tan-2"
active: true
videos: []
---

Builds things.
Sometimes.
`,
      },
    ]);
  });

  it("refuses a duplicate name unless allowed, and a bad or taken slug", () => {
    const cms = new Cms(content());
    expect(() => cms.createPresenter({ name: "jane  doe" })).toThrow(/already called/);
    expect(cms.createPresenter({ name: "Jane Doe", allowDuplicate: true }).slug).toBe("jane-doe-2");
    expect(() => cms.createPresenter({ name: "X", slug: "Bad Slug" })).toThrow(/lowercase/);
    expect(() => cms.createPresenter({ name: "X", slug: "ann-lee" })).toThrow(/already used/);
    expect(() => cms.createPresenter({ name: " " })).toThrow(/needs a name/);
  });

  it("can be linked to a video straight away", () => {
    const cms = new Cms(content());
    const p = cms.createPresenter({ name: "New Person" });
    cms.link("2", "presenters", p.id);
    expect(data(cms, "presenter/10.md").data.videos).toEqual(["2"]);
    expect(data(cms, "video/2.md").data.presenters).toEqual(["10"]);
  });
});

describe("link", () => {
  it("writes both sides: presenters and organizations newest first", () => {
    const cms = new Cms(content());
    expect(cms.link("2", "presenters", "ann-lee")).toBe(true);
    expect(cms.link("yt2", "organizations", "5")).toBe(true);

    expect(data(cms, "presenter/9.md").data.videos).toEqual(["3", "2", "1"]);
    expect(data(cms, "organization/5.md").data.videos).toEqual(["3", "2", "1"]);
    expect(data(cms, "video/2.md").data).toMatchObject({ presenters: ["9"], organizations: ["5"] });
  });

  it("appends to a playlist and to the video's existing links", () => {
    const cms = new Cms(content({ video: [video("1", "2020-01-01T00:00:00Z"), video("2", "2021-01-01T00:00:00Z", { playlists: ["8"] })] }));
    cms.link("2", "playlists", "PL4");
    expect(data(cms, "playlist/4.md").data.videos).toEqual(["1", "3", "2"]);
    expect(data(cms, "video/2.md").data.playlists).toEqual(["8", "4"]);
  });

  it("changes nothing when already linked, and completes a one-sided link", () => {
    const cms = new Cms(content({ video: [video("1", "2020-01-01T00:00:00Z", { presenters: ["9"] }), video("3", "2022-01-01T00:00:00Z")] }));
    expect(cms.link("1", "presenters", "9")).toBe(false);
    expect(cms.changes()).toEqual([]);
    expect(cms.link("3", "presenters", "9")).toBe(true);
    expect(cms.changes().map((c) => c.path)).toEqual(["video/3.md"]);
  });

  it("warns about inactive entries", () => {
    const cms = new Cms(content({ presenter: [presenter("9", "Ann Lee", { active: false })] }));
    cms.link("1", "presenters", "9");
    cms.link("2", "presenters", "9");
    expect([...cms.warnings]).toEqual(["presenter 9 is inactive, so the site doesn't show it"]);
  });
});

describe("unlink", () => {
  it("removes both sides", () => {
    const cms = new Cms(content({ video: [video("1", "2020-01-01T00:00:00Z", { playlists: ["4"] }), video("3", "2022-01-01T00:00:00Z", { playlists: ["4"] })] }));
    expect(cms.unlink("1", "playlists", "4")).toBe(true);
    expect(data(cms, "playlist/4.md").data.videos).toEqual(["3"]);
    expect(data(cms, "video/1.md").data.playlists).toEqual([]);
    expect(cms.unlink("1", "playlists", "4")).toBe(false);
  });
});

describe("reconcile", () => {
  it("completes one-sided links of every relation", () => {
    const cms = new Cms(content());
    // Fixture: org 5, presenter 9 and playlist 4 list videos 1 and 3, which don't list them back.
    expect(cms.reconcile()).toEqual({ organizations: 2, presenters: 2, playlists: 2 });
    expect(data(cms, "video/1.md").data).toMatchObject({ organizations: ["5"], presenters: ["9"], playlists: ["4"] });
    expect(cms.changes().map((c) => c.path)).toEqual(["video/1.md", "video/3.md"]);
  });
});
