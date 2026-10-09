import { describe, expect, it } from "vitest";
import type { Playlist as PlaylistEntry, Video as VideoEntry } from "@esg/db-types/content";
import { parseEntry, serializeEntry, type Entry } from "@esg/content";
import { item, playlist, raw, video } from "./fixtures.js";
import { planSync, type ExistingContent, type SyncWrite } from "./sync.js";

// ---------------------------------------------------------------------------
// Existing content, built the way pg-export writes it
// ---------------------------------------------------------------------------
function videoEntry(id: string, videoId: string, over: Partial<VideoEntry> = {}, body = "Old description"): Entry<VideoEntry> {
  const data: VideoEntry = {
    id,
    videoId,
    videoTitle: "Old title",
    publishedAt: "2020-01-01T00:00:00Z",
    thumbnailDefault: "https://old/default.jpg",
    thumbnailMedium: "https://old/medium.jpg",
    thumbnailHigh: "https://old/high.jpg",
    slug: `old-title-${id}`,
    organizations: ["7"],
    presenters: ["8"],
    active: true,
    videoSite: "youtube",
    ...over,
  };
  return parseEntry(`video/${id}.md`, serializeEntry(data, body));
}

function playlistEntry(id: string, playlistId: string | null, over: Partial<PlaylistEntry> = {}, body = "Old about"): Entry<PlaylistEntry> {
  const data: PlaylistEntry = {
    id,
    playlistId,
    playlistTitle: "Old playlist",
    publishDate: "2019-05-04",
    image: "https://old/playlist.jpg",
    website: "https://example.com/",
    hashtag: "#old",
    category: "Conference",
    slug: `old-playlist-${id}`,
    active: true,
    videos: [],
    subPlaylists: [],
    ...over,
  };
  return parseEntry(`playlist/${id}.md`, serializeEntry(data, body));
}

const content = (videos: Entry<VideoEntry>[] = [], playlists: Entry<PlaylistEntry>[] = []): ExistingContent => ({ videos, playlists });

const find = (writes: SyncWrite[], path: string) => {
  const w = writes.find((x) => x.path === path);
  if (!w) throw new Error(`no write for ${path}; got ${writes.map((x) => x.path).join(", ")}`);
  return { ...w, entry: parseEntry<Record<string, unknown>>(w.path, w.content) };
};

// ---------------------------------------------------------------------------
// Existing videos
// ---------------------------------------------------------------------------
describe("planSync: existing videos", () => {
  it("refreshes title, description and thumbnails and keeps every other field", () => {
    const v = video("yt1", "2023-11-03T06:41:58Z");
    v.snippet.title = "New title";
    v.snippet.description = "New\r\ndescription\r\n";
    const existing = videoEntry("10", "yt1", { active: false });

    const plan = planSync(raw({ videos: [v] }), content([existing]));

    const w = find(plan.writes, "video/10.md");
    expect(w.kind).toBe("update");
    expect(w.entry.data).toEqual({
      ...existing.data,
      videoTitle: "New title",
      thumbnailDefault: "https://i.ytimg.com/vi/yt1/default.jpg",
      thumbnailMedium: "https://i.ytimg.com/vi/yt1/mqdefault.jpg",
      thumbnailHigh: "https://i.ytimg.com/vi/yt1/hqdefault.jpg",
    });
    expect(w.entry.body).toBe("New\ndescription");
    expect(w.changed).toEqual(["videoTitle", "thumbnailDefault", "thumbnailMedium", "thumbnailHigh", "body"]);
    expect(plan.videos).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
  });

  it("keeps the field order of the file", () => {
    const plan = planSync(raw({ videos: [video("yt1", "2023-01-01T00:00:00Z")] }), content([videoEntry("10", "yt1")]));
    expect(Object.keys(find(plan.writes, "video/10.md").entry.data)).toEqual(Object.keys(videoEntry("10", "yt1").data));
  });

  it("writes nothing when nothing changed", () => {
    const v = video("yt1", "2023-01-01T00:00:00Z");
    const t = v.snippet.thumbnails;
    const existing = videoEntry(
      "10",
      "yt1",
      {
        videoTitle: v.snippet.title,
        thumbnailDefault: t.default!.url,
        thumbnailMedium: t.medium!.url,
        thumbnailHigh: t.high!.url,
      },
      v.snippet.description,
    );
    const plan = planSync(raw({ videos: [v] }), content([existing]));
    expect(plan.writes).toEqual([]);
    expect(plan.videos).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it("keeps an existing thumbnail that YouTube no longer returns", () => {
    const v = video("yt1", "2023-01-01T00:00:00Z");
    v.snippet.thumbnails = { default: v.snippet.thumbnails.default };
    const plan = planSync(raw({ videos: [v] }), content([videoEntry("10", "yt1")]));
    const data = find(plan.writes, "video/10.md").entry.data;
    expect(data.thumbnailMedium).toBe("https://old/medium.jpg");
    expect(data.thumbnailHigh).toBe("https://old/high.jpg");
  });

  it("empties the body when YouTube's description is empty", () => {
    const v = video("yt1", "2023-01-01T00:00:00Z");
    v.snippet.description = "";
    const plan = planSync(raw({ videos: [v] }), content([videoEntry("10", "yt1")]));
    expect(find(plan.writes, "video/10.md").entry.body).toBe("");
  });

  it("reports existing videos YouTube was asked about and did not return, and leaves them untouched", () => {
    const plan = planSync(
      raw({
        videos: [video("priv", "2020-01-01T00:00:00Z", { privacy: "private" })],
        requested: { videos: ["gone", "priv"], playlists: [] },
      }),
      content([videoEntry("10", "gone", { videoTitle: "Gone video" }), videoEntry("11", "priv", { active: false })]),
    );
    expect(plan.writes).toEqual([]);
    expect(plan.videos.notOnYouTube).toEqual([
      { entry: "10", youtubeId: "gone", title: "Gone video", active: true },
      { entry: "11", youtubeId: "priv", title: "Old title", active: false },
    ]);
    expect(plan.videos.notFetched).toBe(0);
  });

  it("counts existing videos YouTube was never asked about as not fetched, not as missing", () => {
    const plan = planSync(raw({ requested: { videos: [], playlists: [] } }), content([videoEntry("10", "never-asked")]));
    expect(plan.videos).toMatchObject({ notOnYouTube: [], notFetched: 1 });
  });

  it("ignores Vimeo entries", () => {
    const plan = planSync(raw({ videos: [] }), content([videoEntry("10", "162848698", { videoSite: "vimeo" })]));
    expect(plan.writes).toEqual([]);
    expect(plan.videos.notOnYouTube).toEqual([]);
  });

  it("does not match a Vimeo entry that has the same ID as a YouTube video", () => {
    const plan = planSync(
      raw({ videos: [video("same", "2023-01-01T00:00:00Z")] }),
      content([videoEntry("10", "same", { videoSite: "vimeo" })]),
    );
    expect(plan.writes.map((w) => [w.kind, w.path])).toEqual([["create", "video/yt-same.md"]]);
  });
});

// ---------------------------------------------------------------------------
// New videos
// ---------------------------------------------------------------------------
describe("planSync: new videos", () => {
  it("names new entries after their YouTube IDs, oldest first", () => {
    const plan = planSync(
      raw({
        videos: [
          video("c", "2024-01-01T00:00:00Z"),
          video("b", "2021-01-01T00:00:00Z"),
          video("known", "2019-01-01T00:00:00Z"),
        ],
      }),
      content([videoEntry("4442", "known")]),
    );
    const created = plan.writes.filter((w) => w.kind === "create").map((w) => [w.path, find(plan.writes, w.path).entry.data.videoId]);
    expect(created).toEqual([
      ["video/yt-b.md", "b"],
      ["video/yt-c.md", "c"],
    ]);
    expect(plan.videos).toMatchObject({ created: 2 });
  });

  it("fills the frontmatter like pg-export and uses the description as the body", () => {
    const v = video("abc", "2023-11-03T06:41:58Z");
    v.snippet.title = "Hackware v7.9: HDMI!";
    v.snippet.description = "Speaker: Someone\r\n\r\nProduced by Engineers.SG\r\n";
    const plan = planSync(raw({ videos: [v] }), content());
    const w = find(plan.writes, "video/yt-abc.md");
    expect(w.entry.data).toEqual({
      id: "yt-abc",
      videoId: "abc",
      videoTitle: "Hackware v7.9: HDMI!",
      publishedAt: "2023-11-03T06:41:58Z",
      thumbnailDefault: "https://i.ytimg.com/vi/abc/default.jpg",
      thumbnailMedium: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
      thumbnailHigh: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      slug: "hackware-v7-9-hdmi",
      organizations: [],
      presenters: [],
      active: true,
      videoSite: "youtube",
    });
    expect(Object.keys(w.entry.data)).toEqual(Object.keys(videoEntry("1", "x").data));
    expect(w.entry.body).toBe("Speaker: Someone\n\nProduced by Engineers.SG");
  });

  it("marks unlisted videos inactive and skips private ones", () => {
    const plan = planSync(
      raw({
        videos: [
          video("unl", "2020-01-01T00:00:00Z", { privacy: "unlisted" }),
          video("priv", "2020-01-02T00:00:00Z", { privacy: "private" }),
        ],
      }),
      content(),
    );
    expect(plan.writes.map((w) => w.path)).toEqual(["video/yt-unl.md"]);
    expect(find(plan.writes, "video/yt-unl.md").entry.data.active).toBe(false);
  });

  it("gives unique slugs, also against existing and new entries", () => {
    const a = video("a", "2020-01-01T00:00:00Z");
    const b = video("b", "2020-01-02T00:00:00Z");
    const c = video("c", "2020-01-03T00:00:00Z");
    a.snippet.title = b.snippet.title = c.snippet.title = "Talk";
    const plan = planSync(raw({ videos: [a, b, c] }), content([videoEntry("5", "known", { slug: "talk" })]));
    expect(["video/yt-a.md", "video/yt-b.md", "video/yt-c.md"].map((p) => find(plan.writes, p).entry.data.slug)).toEqual([
      "talk-2",
      "talk-3",
      "talk-4",
    ]);
  });

  it("falls back to video-<id> for a title with no ASCII", () => {
    const v = video("AbC_d", "2020-01-01T00:00:00Z");
    v.snippet.title = "新加坡";
    const plan = planSync(raw({ videos: [v] }), content());
    expect(find(plan.writes, "video/yt-AbC_d.md").entry.data.slug).toBe("video-yt-abc-d");
  });

  it("uses null for missing thumbnails", () => {
    const v = video("a", "2020-01-01T00:00:00Z");
    v.snippet.thumbnails = {};
    const plan = planSync(raw({ videos: [v] }), content());
    const data = find(plan.writes, "video/yt-a.md").entry.data;
    expect([data.thumbnailDefault, data.thumbnailMedium, data.thumbnailHigh]).toEqual([null, null, null]);
  });
});

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------
describe("planSync: existing playlists", () => {
  it("refreshes title, description and image and keeps the curated fields", () => {
    const p = playlist("PL1", "GeekcampSG 2021", "2021-10-23T03:00:00Z");
    p.snippet.description = "New about";
    const existing = playlistEntry("5", "PL1", { subPlaylists: ["9"], videos: ["1"] });

    const plan = planSync(raw({ playlists: [p], videos: [video("yt1", "2020-01-01T00:00:00Z")] }), content([videoEntry("1", "yt1")], [existing]));

    const w = find(plan.writes, "playlist/5.md");
    expect(w.kind).toBe("update");
    expect(w.entry.data).toEqual({
      ...existing.data,
      playlistTitle: "GeekcampSG 2021",
      image: "https://i.ytimg.com/pl/PL1/hqdefault.jpg",
    });
    expect(w.entry.body).toBe("New about");
    expect(w.changed).toEqual(["playlistTitle", "image", "body"]);
  });

  it("falls back to a smaller thumbnail, and keeps the image when there is none", () => {
    const small = playlist("PL1", "A", "2021-01-01T00:00:00Z");
    delete small.snippet.thumbnails.high;
    const none = playlist("PL2", "B", "2021-01-02T00:00:00Z");
    none.snippet.thumbnails = {};
    const plan = planSync(
      raw({ playlists: [small, none] }),
      content([], [playlistEntry("5", "PL1"), playlistEntry("6", "PL2")]),
    );
    expect(find(plan.writes, "playlist/5.md").entry.data.image).toBe("https://i.ytimg.com/pl/PL1/default.jpg");
    expect(find(plan.writes, "playlist/6.md").entry.data.image).toBe("https://old/playlist.jpg");
  });

  it("appends new videos in YouTube order without removing or reordering the existing ones", () => {
    const videos = ["a", "b", "c", "d"].map((id, i) => video(id, `2020-01-0${i + 1}T00:00:00Z`));
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "d", 0), item("PL1", "b", 1), item("PL1", "a", 2), item("PL1", "c", 3)] },
      }),
      // Playlist has c and a (in curated order); b and d are new to it. e is curated but not on YouTube.
      content(
        [videoEntry("1", "a"), videoEntry("2", "b"), videoEntry("3", "c"), videoEntry("4", "d"), videoEntry("5", "e")],
        [playlistEntry("9", "PL1", { videos: ["3", "1", "5"] })],
      ),
    );
    expect(find(plan.writes, "playlist/9.md").entry.data.videos).toEqual(["3", "1", "5", "4", "2"]);
    // Membership is stored on the playlist only.
    expect(find(plan.writes, "video/4.md").changed).not.toContain("playlists");
  });

  it("adds a video to a playlist once", () => {
    const plan = planSync(
      raw({
        videos: [video("a", "2020-01-01T00:00:00Z")],
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0), item("PL1", "a", 1)] },
      }),
      content([videoEntry("1", "a")], [playlistEntry("9", "PL1", { videos: ["1"] })]),
    );
    expect(find(plan.writes, "playlist/9.md").entry.data.videos).toEqual(["1"]);
  });

  it("ignores private and unavailable items when adding videos", () => {
    const plan = planSync(
      raw({
        videos: [video("priv", "2020-01-01T00:00:00Z", { privacy: "private" })],
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "priv", 0), item("PL1", "deleted", 1)] },
      }),
      content([], [playlistEntry("9", "PL1")]),
    );
    expect(find(plan.writes, "playlist/9.md").entry.data.videos).toEqual([]);
    expect(plan.writes.filter((w) => w.kind === "create")).toEqual([]);
  });

  it("reports existing playlists YouTube was asked about and did not return, and leaves them and entries without a playlistId alone", () => {
    const plan = planSync(
      raw({ requested: { videos: [], playlists: ["PLgone"] } }),
      content([], [playlistEntry("5", "PLgone", { playlistTitle: "Gone playlist" }), playlistEntry("6", null), playlistEntry("7", "PLnever")]),
    );
    expect(plan.writes).toEqual([]);
    expect(plan.playlists.notOnYouTube).toEqual([{ entry: "5", youtubeId: "PLgone", title: "Gone playlist", active: true }]);
    expect(plan.playlists.notFetched).toBe(1);
  });
});

describe("planSync: new playlists", () => {
  const videos = ["a", "b", "c"].map((id, i) => video(id, `2020-01-0${i + 1}T00:00:00Z`));

  it("creates an entry with the videos in YouTube order and the curated fields empty", () => {
    const p = playlist("PL1", "AWS Community Day 2023", "2023-03-16T01:33:29Z");
    p.snippet.description = "About it";
    const plan = planSync(
      raw({ videos, playlists: [p], playlistItems: { PL1: [item("PL1", "c", 0), item("PL1", "a", 1)] } }),
      content([videoEntry("4", "b")], [playlistEntry("119", "PLold")]),
    );
    const w = find(plan.writes, "playlist/yt-PL1.md");
    expect(w.kind).toBe("create");
    expect(w.entry.data).toEqual({
      id: "yt-PL1",
      playlistId: "PL1",
      playlistTitle: "AWS Community Day 2023",
      publishDate: "2023-03-16",
      image: "https://i.ytimg.com/pl/PL1/hqdefault.jpg",
      website: null,
      hashtag: null,
      category: null,
      slug: "aws-community-day-2023",
      active: true,
      videos: ["yt-c", "yt-a"],
      subPlaylists: [],
    });
    expect(w.entry.body).toBe("About it");
    expect(plan.playlists).toMatchObject({ created: 1 });
  });

  it("stores the membership on the new playlist only", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0), item("PL1", "b", 1)] },
      }),
      content([videoEntry("4", "b")]),
    );
    expect(find(plan.writes, "playlist/yt-PL1.md").entry.data.videos).toEqual(["yt-a", "4"]);
    expect(find(plan.writes, "video/4.md").entry.data).not.toHaveProperty("playlists");
    expect(find(plan.writes, "video/yt-a.md").entry.data).not.toHaveProperty("playlists");
  });

  it("names them after their YouTube IDs and gives unique slugs oldest first, also against existing ones", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PLnew", "Meetup", "2023-01-01T00:00:00Z"), playlist("PLold", "Meetup", "2019-01-01T00:00:00Z")],
        playlistItems: { PLnew: [item("PLnew", "a", 0)], PLold: [item("PLold", "b", 0)] },
      }),
      content([], [playlistEntry("10", "PLx", { slug: "meetup" })]),
    );
    expect([find(plan.writes, "playlist/yt-PLold.md"), find(plan.writes, "playlist/yt-PLnew.md")].map((w) => [w.entry.data.playlistId, w.entry.data.slug])).toEqual([
      ["PLold", "meetup-2"],
      ["PLnew", "meetup-3"],
    ]);
  });

  it("marks a non-public playlist inactive", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "Hidden", "2021-01-01T00:00:00Z", "unlisted")],
        playlistItems: { PL1: [item("PL1", "a", 0)] },
      }),
      content(),
    );
    expect(find(plan.writes, "playlist/yt-PL1.md").entry.data.active).toBe(false);
  });

  it("falls back to playlist-<id> for a title with no ASCII", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "新加坡", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0)] },
      }),
      content(),
    );
    expect(find(plan.writes, "playlist/yt-PL1.md").entry.data.slug).toBe("playlist-yt-pl1");
  });

  it("skips a playlist with no available videos", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PLempty", "Empty", "2019-01-01T00:00:00Z"), playlist("PL1", "Full", "2021-01-01T00:00:00Z")],
        playlistItems: { PLempty: [item("PLempty", "deleted", 0)], PL1: [item("PL1", "a", 0)] },
      }),
      content(),
    );
    expect(plan.writes.filter((w) => w.path.startsWith("playlist/")).map((w) => w.path)).toEqual(["playlist/yt-PL1.md"]);
    expect(plan.playlists.skipped).toEqual(["Empty"]);
  });
});

describe("planSync: missing entries", () => {
  const raws = raw({
    videos: [video("here", "2020-01-01T00:00:00Z")],
    requested: { videos: ["here", "priv1", "priv2", "priv3"], playlists: ["PLgone"] },
  });
  const entries = () =>
    content(
      [
        videoEntry("1", "priv1", { videoTitle: "Published private" }),
        videoEntry("2", "priv2", { active: false }), // already hidden
        videoEntry("3", "never", { videoTitle: "Published, never asked" }),
        videoEntry("4", "priv3", { videoSite: "vimeo" }), // not a YouTube entry
      ],
      [playlistEntry("9", "PLgone"), playlistEntry("10", "PLnever")],
    );

  it("changes nothing by default", () => {
    const plan = planSync(raws, entries());
    expect(plan.videos.deactivated).toBe(0);
    expect(plan.writes.filter((w) => w.changed.includes("active"))).toEqual([]);
  });

  it("with deactivateMissing, hides the published ones YouTube did not return", () => {
    const plan = planSync(raws, entries(), { deactivateMissing: true });
    const video1 = find(plan.writes, "video/1.md");
    expect(video1.kind).toBe("update");
    expect(video1.changed).toEqual(["active"]);
    expect(video1.entry.data).toEqual({ ...videoEntry("1", "priv1", { videoTitle: "Published private" }).data, active: false });
    expect(video1.entry.body).toBe("Old description");
    expect(find(plan.writes, "playlist/9.md").entry.data.active).toBe(false);
    expect(plan.videos.deactivated).toBe(1);
    expect(plan.playlists.deactivated).toBe(1);
  });

  it("does not touch entries already inactive, never fetched, or not on YouTube", () => {
    const plan = planSync(raws, entries(), { deactivateMissing: true });
    for (const path of ["video/2.md", "video/3.md", "video/4.md", "playlist/10.md"]) {
      expect(plan.writes.some((w) => w.path === path && w.changed.includes("active"))).toBe(false);
    }
    expect(plan.videos.notFetched).toBe(1);
    expect(plan.playlists.notFetched).toBe(1);
  });

  it("is idempotent: once hidden, a second run finds nothing to deactivate", () => {
    const first = planSync(raws, entries(), { deactivateMissing: true });
    const files = first.writes.map((w) => parseEntry(w.path, w.content));
    const second = planSync(
      raws,
      content(
        [...files.filter((e) => e.path === "video/1.md"), videoEntry("2", "priv2", { active: false }), videoEntry("3", "never"), videoEntry("4", "priv3", { videoSite: "vimeo" })] as unknown as Entry<VideoEntry>[],
        [...files.filter((e) => e.path === "playlist/9.md"), playlistEntry("10", "PLnever")] as unknown as Entry<PlaylistEntry>[],
      ),
      { deactivateMissing: true },
    );
    expect(second.videos.deactivated).toBe(0);
    expect(second.playlists.deactivated).toBe(0);
    expect(second.videos.notOnYouTube.find((m) => m.entry === "1")?.active).toBe(false);
  });

  it("an older raw file without a record of the requests still catches private videos listed in a playlist", () => {
    const legacy = raw({
      videos: [video("here", "2020-01-01T00:00:00Z")],
      playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
      // A private video still appears in the playlist's items, but videos.list doesn't return it.
      playlistItems: { PL1: [item("PL1", "here", 0), item("PL1", "priv1", 1)] },
    });
    const plan = planSync(legacy, content([videoEntry("1", "priv1"), videoEntry("3", "never")]), { deactivateMissing: true });
    expect(plan.videos.notOnYouTube.map((m) => m.youtubeId)).toEqual(["priv1"]);
    expect(plan.videos.notFetched).toBe(1);
    expect(find(plan.writes, "video/1.md").entry.data.active).toBe(false);
  });
});

describe("planSync: excludeVideos", () => {
  const videos = ["a", "b", "c"].map((id, i) => video(id, `2020-01-0${i + 1}T00:00:00Z`));

  it("does not create an excluded video", () => {
    const plan = planSync(raw({ videos }), content(), { excludeVideos: ["b"] });
    expect(plan.writes.map((w) => [w.path, find(plan.writes, w.path).entry.data.videoId])).toEqual([
      ["video/yt-a.md", "a"],
      ["video/yt-c.md", "c"],
    ]);
    expect(plan.videos).toMatchObject({ created: 2, excluded: ["b"] });
  });

  it("leaves out of playlists, and does not create a playlist that is left empty", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "Both", "2021-01-01T00:00:00Z"), playlist("PL2", "Only b", "2021-01-02T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0), item("PL1", "b", 1)], PL2: [item("PL2", "b", 0)] },
      }),
      content(),
      { excludeVideos: ["b"] },
    );
    expect(find(plan.writes, "playlist/yt-PL1.md").entry.data.videos).toEqual(["yt-a"]);
    expect(plan.writes.some((w) => w.path === "playlist/yt-PL2.md")).toBe(false);
    expect(plan.playlists.skipped).toEqual(["Only b"]);
  });

  it("leaves an existing excluded video untouched, neither updated nor reported missing", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "b", 0)] },
      }),
      content([videoEntry("10", "b")], [playlistEntry("9", "PL1")]),
      { excludeVideos: ["b"] },
    );
    expect(plan.writes.some((w) => w.path === "video/10.md")).toBe(false);
    expect(plan.videos.notOnYouTube).toEqual([]);
    expect(plan.videos.unchanged).toBe(0);
    expect(plan.videos.excluded).toEqual(["b"]);
    // It is not added to the playlist either (the playlist itself is still refreshed).
    expect(find(plan.writes, "playlist/9.md").entry.data.videos).toEqual([]);
  });

  it("only reports excluded IDs that match something", () => {
    const plan = planSync(raw({ videos }), content([videoEntry("10", "old")]), { excludeVideos: ["a", "old", "nope"] });
    expect(plan.videos.excluded).toEqual(["a", "old"]);
  });

  it("excludes nothing by default", () => {
    expect(planSync(raw({ videos }), content()).videos).toMatchObject({ created: 3, excluded: [] });
  });
});

describe("planSync: IDs and links", () => {
  it("leaves hand-made links alone and writes nothing when nothing changed", () => {
    const plan = planSync(raw({}), content([videoEntry("10", "yt1")], [playlistEntry("3", null, { videos: ["10", "98"] })]));
    expect(plan.writes).toEqual([]);
  });

  it("refuses to create an entry whose ID differs from another only in case", () => {
    expect(() => planSync(raw({ videos: [video("AbC", "2020-01-01T00:00:00Z")] }), content([videoEntry("yt-abc", "abc")]))).toThrow(
      "video IDs that differ only in case: yt-abc / yt-AbC",
    );
  });
});

describe("planSync: idempotence", () => {
  it("a second run over its own output changes nothing", () => {
    const data = raw({
      videos: [video("a", "2020-01-01T00:00:00Z"), video("b", "2020-01-02T00:00:00Z")],
      playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
      playlistItems: { PL1: [item("PL1", "b", 0), item("PL1", "a", 1)] },
    });
    const first = planSync(data, content());
    const files = first.writes.map((w) => parseEntry(w.path, w.content));
    const second = planSync(
      data,
      content(
        files.filter((e) => e.path.startsWith("video/")) as unknown as Entry<VideoEntry>[],
        files.filter((e) => e.path.startsWith("playlist/")) as unknown as Entry<PlaylistEntry>[],
      ),
    );
    expect(second.writes).toEqual([]);
    expect(second.videos).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(second.playlists).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });
});
