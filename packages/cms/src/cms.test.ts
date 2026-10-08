import { describe, expect, it } from "vitest";
import { Cms, CmsError, refKey } from "./cms.js";
import { content, data, organization, presenter, video } from "./testContent.js";

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

describe("createOrganization", () => {
  it("takes the next ID, makes a unique slug and writes the fields in pg-export order", () => {
    const cms = new Cms(content({ organization: [organization("5"), organization("9", { slug: "tech-circle" })] }));
    const o = cms.createOrganization({
      name: " Tech Circle ",
      links: { website: "techcircle.sg", x: "@techcircle" },
      contactPerson: " Jane Doe ",
      logoImage: " ",
      description: "Monthly roundtables.\r\nFor leaders.",
    });

    expect(o.id).toBe("10");
    expect(cms.changes()).toEqual([
      {
        kind: "create",
        path: "organization/10.md",
        title: "Tech Circle",
        content: `---
id: "10"
orgTitle: "Tech Circle"
links: [{"type":"x","url":"https://x.com/techcircle"},{"type":"website","url":"https://techcircle.sg"}]
logoImage: null
contactPerson: "Jane Doe"
slug: "tech-circle-2"
active: true
videos: []
---

Monthly roundtables.
For leaders.
`,
      },
    ]);
  });

  it("refuses a taken name or slug, a bad link and a blank name", () => {
    const cms = new Cms(content());
    expect(() => cms.createOrganization({ name: "org 5" })).toThrow(/already called/);
    expect(cms.createOrganization({ name: "Org 5", allowDuplicate: true }).slug).toBe("org-5-2");
    expect(() => cms.createOrganization({ name: "New", slug: "org-5" })).toThrow(/already used by another organization/);
    expect(() => cms.createOrganization({ name: "New", links: { x: "not a handle" } })).toThrow(CmsError);
    expect(() => cms.createOrganization({ name: " " })).toThrow(/an organization needs a name/);
  });

  it("can be linked to videos on both sides straight away", () => {
    const cms = new Cms(content());
    const o = cms.createOrganization({ name: "New Group" });
    cms.link("1", "organizations", o.id);
    cms.link("3", "organizations", "new-group");
    expect(o.videos).toEqual(["3", "1"]);
    expect(cms.changes().map((c) => c.path)).toEqual(["video/1.md", "video/3.md", "organization/6.md"]);
  });
});

describe("editLinks", () => {
  const withLinks = () =>
    new Cms(
      content({
        presenter: [
          presenter("7", "Jane Doe", {
            links: [
              { type: "x", url: "https://x.com/jane" },
              { type: "website", url: "https://jane.dev" },
            ],
          }),
        ],
        organization: [organization("3")],
      }),
    );

  it("replaces a type's link where it is and adds new types at the end", () => {
    const cms = withLinks();
    const links = cms.editLinks("presenter", "jane-doe", { set: { instagram: "@jane.d", x: "https://twitter.com/janedoe" } });
    expect(links).toEqual([
      { type: "x", url: "https://x.com/janedoe" },
      { type: "website", url: "https://jane.dev" },
      { type: "instagram", url: "https://www.instagram.com/jane.d/" },
    ]);
    expect(cms.changes().map((c) => c.path)).toEqual(["presenter/7.md"]);
  });

  it("removes links by type", () => {
    const cms = withLinks();
    expect(cms.editLinks("presenter", "7", { remove: ["x"], set: { tiktok: "jane" } })).toEqual([
      { type: "website", url: "https://jane.dev" },
      { type: "tiktok", url: "https://www.tiktok.com/@jane" },
    ]);
  });

  it("works for organizations", () => {
    const cms = withLinks();
    expect(cms.editLinks("organization", "3", { set: { website: "example.org" } })).toEqual([{ type: "website", url: "https://example.org" }]);
  });

  it("changes nothing when a value is invalid or a type is both set and removed", () => {
    const cms = withLinks();
    expect(() => cms.editLinks("presenter", "7", { set: { website: "jane.org", linkedin: "https://example.com" } })).toThrow(CmsError);
    expect(() => cms.editLinks("presenter", "7", { set: { x: "jane" }, remove: ["x"] })).toThrow(/both set and removed/);
    expect(cms.changes()).toEqual([]);
  });
});

describe("createPresenter", () => {
  it("takes the next ID, makes a unique slug and writes the fields in pg-export order", () => {
    const cms = new Cms(content({ presenter: [presenter("7", "Jane Doe"), presenter("12", "Someone", { slug: "john-tan" })] }));
    const p = cms.createPresenter({
      name: "  John Tan ",
      links: { tiktok: "@jtan.dev", website: "jtan.dev", x: "@jtan" },
      byline: " ",
      bio: "Builds things.\r\nSometimes.",
    });

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
links: [{"type":"x","url":"https://x.com/jtan"},{"type":"website","url":"https://jtan.dev"},{"type":"tiktok","url":"https://www.tiktok.com/@jtan.dev"}]
email: null
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
    expect(() => cms.createPresenter({ name: "X", links: { linkedin: "https://example.com" } })).toThrow(CmsError);
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

describe("createVideo", () => {
  const input = {
    videoId: "dQw4w9WgXcQ",
    title: "Video 1",
    publishedAt: "2024-05-01T10:00:00Z",
    thumbnails: { default: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg", medium: null, high: " " },
    description: "About it\r\n",
  };

  it("takes the next ID and a unique slug, with the fields the YouTube sync writes", () => {
    const cms = new Cms(content());
    const v = cms.createVideo(input);
    expect(v).toEqual({
      id: "4",
      videoId: "dQw4w9WgXcQ",
      videoTitle: "Video 1",
      publishedAt: "2024-05-01T10:00:00Z",
      thumbnailDefault: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg",
      thumbnailMedium: null,
      thumbnailHigh: null,
      slug: "video-1-2",
      organizations: [],
      presenters: [],
      playlists: [],
      active: true,
      videoSite: "youtube",
    });
    const change = cms.changes().find((c) => c.path === "video/4.md");
    expect(change?.kind).toBe("create");
    expect(change?.content.endsWith("---\n\nAbout it\n")).toBe(true);
  });

  it("refuses a YouTube video that is already there", () => {
    const cms = new Cms(content());
    expect(() => cms.createVideo({ ...input, videoId: "yt2" })).toThrow(/video 2 \(video-2\) is already YouTube video yt2/);
  });
});

describe("presentersNamed", () => {
  it("matches names ignoring case, spacing and accents, active ones and those with more videos first", () => {
    const cms = new Cms(
      content({
        presenter: [
          presenter("1", "José Tan", { active: false, videos: ["1", "2", "3"] }),
          presenter("2", "jose  tan"),
          presenter("3", "Jose Tan ", { videos: ["1"] }),
          presenter("4", "Josef Tan"),
        ],
      }),
    );
    expect(cms.presentersNamed(" JOSE TAN").map((p) => p.id)).toEqual(["3", "2", "1"]);
    expect(cms.presentersNamed("Nobody")).toEqual([]);
  });

  it("is what createPresenter checks for duplicates", () => {
    const cms = new Cms(content());
    expect(() => cms.createPresenter({ name: "Ánn  LEE" })).toThrow(/already called/);
  });
});
