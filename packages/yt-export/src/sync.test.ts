import { describe, expect, it } from "vitest";
import type { Playlist as PlaylistEntry, Video as VideoEntry } from "@esg/db-types/content";
import { parseEntry, serializeEntry, type Entry } from "./content.js";
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
    playlists: [],
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
    const existing = videoEntry("10", "yt1", { playlists: ["3"], active: false });

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

  it("reports existing videos YouTube did not return and leaves them untouched", () => {
    const plan = planSync(
      raw({ videos: [video("priv", "2020-01-01T00:00:00Z", { privacy: "private" })] }),
      content([videoEntry("10", "gone"), videoEntry("11", "priv")]),
    );
    expect(plan.writes).toEqual([]);
    expect(plan.videos.notOnYouTube).toEqual(["gone", "priv"]);
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
    expect(plan.writes.map((w) => [w.kind, w.path])).toEqual([["create", "video/11.md"]]);
  });
});

// ---------------------------------------------------------------------------
// New videos
// ---------------------------------------------------------------------------
describe("planSync: new videos", () => {
  it("creates an entry with the next IDs, oldest first", () => {
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
      ["video/4443.md", "b"],
      ["video/4444.md", "c"],
    ]);
    expect(plan.videos).toMatchObject({ created: 2 });
  });

  it("fills the frontmatter like pg-export and uses the description as the body", () => {
    const v = video("abc", "2023-11-03T06:41:58Z");
    v.snippet.title = "Hackware v7.9: HDMI!";
    v.snippet.description = "Speaker: Someone\r\n\r\nProduced by Engineers.SG\r\n";
    const plan = planSync(raw({ videos: [v] }), content());
    const w = find(plan.writes, "video/1.md");
    expect(w.entry.data).toEqual({
      id: "1",
      videoId: "abc",
      videoTitle: "Hackware v7.9: HDMI!",
      publishedAt: "2023-11-03T06:41:58Z",
      thumbnailDefault: "https://i.ytimg.com/vi/abc/default.jpg",
      thumbnailMedium: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
      thumbnailHigh: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      slug: "hackware-v7-9-hdmi",
      organizations: [],
      presenters: [],
      playlists: [],
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
    expect(plan.writes.map((w) => w.path)).toEqual(["video/1.md"]);
    expect(find(plan.writes, "video/1.md").entry.data.active).toBe(false);
  });

  it("gives unique slugs, also against existing and new entries", () => {
    const a = video("a", "2020-01-01T00:00:00Z");
    const b = video("b", "2020-01-02T00:00:00Z");
    const c = video("c", "2020-01-03T00:00:00Z");
    a.snippet.title = b.snippet.title = c.snippet.title = "Talk";
    const plan = planSync(raw({ videos: [a, b, c] }), content([videoEntry("5", "known", { slug: "talk" })]));
    expect(["video/6.md", "video/7.md", "video/8.md"].map((p) => find(plan.writes, p).entry.data.slug)).toEqual([
      "talk-2",
      "talk-3",
      "talk-4",
    ]);
  });

  it("falls back to video-<id> for a title with no ASCII", () => {
    const v = video("a", "2020-01-01T00:00:00Z");
    v.snippet.title = "新加坡";
    const plan = planSync(raw({ videos: [v] }), content());
    expect(find(plan.writes, "video/1.md").entry.data.slug).toBe("video-1");
  });

  it("uses null for missing thumbnails", () => {
    const v = video("a", "2020-01-01T00:00:00Z");
    v.snippet.thumbnails = {};
    const plan = planSync(raw({ videos: [v] }), content());
    const data = find(plan.writes, "video/1.md").entry.data;
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
    // The videos gain the playlist too, and the ones that already had it don't change.
    expect(find(plan.writes, "video/4.md").entry.data.playlists).toEqual(["9"]);
    expect(find(plan.writes, "video/2.md").entry.data.playlists).toEqual(["9"]);
  });

  it("adds a playlist to a video once", () => {
    const plan = planSync(
      raw({
        videos: [video("a", "2020-01-01T00:00:00Z")],
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0), item("PL1", "a", 1)] },
      }),
      content([videoEntry("1", "a", { playlists: ["9"] })], [playlistEntry("9", "PL1", { videos: ["1"] })]),
    );
    expect(plan.writes.filter((w) => w.path === "video/1.md" && w.changed.includes("playlists"))).toEqual([]);
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

  it("reports existing playlists YouTube did not return and leaves them and entries without a playlistId alone", () => {
    const plan = planSync(raw({}), content([], [playlistEntry("5", "PLgone"), playlistEntry("6", null)]));
    expect(plan.writes).toEqual([]);
    expect(plan.playlists.notOnYouTube).toEqual(["PLgone"]);
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
    const w = find(plan.writes, "playlist/120.md");
    expect(w.kind).toBe("create");
    expect(w.entry.data).toEqual({
      id: "120",
      playlistId: "PL1",
      playlistTitle: "AWS Community Day 2023",
      publishDate: "2023-03-16",
      image: "https://i.ytimg.com/pl/PL1/hqdefault.jpg",
      website: null,
      hashtag: null,
      category: null,
      slug: "aws-community-day-2023",
      active: true,
      videos: ["6", "5"], // new video IDs continue after 4: a → 5, c → 6
      subPlaylists: [],
    });
    expect(w.entry.body).toBe("About it");
    expect(plan.playlists).toMatchObject({ created: 1 });
  });

  it("links the new playlist from the videos in it, new and existing", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PL1", "A", "2021-01-01T00:00:00Z")],
        playlistItems: { PL1: [item("PL1", "a", 0), item("PL1", "b", 1)] },
      }),
      content([videoEntry("4", "b", { playlists: ["2"] })]),
    );
    // Playlist 1 is new; b already exists and a and c are new (5, 6).
    expect(find(plan.writes, "video/4.md").entry.data.playlists).toEqual(["2", "1"]);
    expect(find(plan.writes, "video/5.md").entry.data.playlists).toEqual(["1"]);
    expect(find(plan.writes, "video/6.md").entry.data.playlists).toEqual([]);
  });

  it("assigns IDs oldest first and gives unique slugs, also against existing ones", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PLnew", "Meetup", "2023-01-01T00:00:00Z"), playlist("PLold", "Meetup", "2019-01-01T00:00:00Z")],
        playlistItems: { PLnew: [item("PLnew", "a", 0)], PLold: [item("PLold", "b", 0)] },
      }),
      content([], [playlistEntry("10", "PLx", { slug: "meetup" })]),
    );
    expect([find(plan.writes, "playlist/11.md"), find(plan.writes, "playlist/12.md")].map((w) => [w.entry.data.playlistId, w.entry.data.slug])).toEqual([
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
    expect(find(plan.writes, "playlist/1.md").entry.data.active).toBe(false);
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
    expect(find(plan.writes, "playlist/1.md").entry.data.slug).toBe("playlist-1");
  });

  it("skips a playlist with no available videos, without using up an ID", () => {
    const plan = planSync(
      raw({
        videos,
        playlists: [playlist("PLempty", "Empty", "2019-01-01T00:00:00Z"), playlist("PL1", "Full", "2021-01-01T00:00:00Z")],
        playlistItems: { PLempty: [item("PLempty", "deleted", 0)], PL1: [item("PL1", "a", 0)] },
      }),
      content(),
    );
    expect(plan.writes.filter((w) => w.path.startsWith("playlist/")).map((w) => w.path)).toEqual(["playlist/1.md"]);
    expect(plan.playlists.skipped).toEqual(["Empty"]);
  });
});

describe("planSync: excludeVideos", () => {
  const videos = ["a", "b", "c"].map((id, i) => video(id, `2020-01-0${i + 1}T00:00:00Z`));

  it("does not create an excluded video and does not use up an ID", () => {
    const plan = planSync(raw({ videos }), content(), { excludeVideos: ["b"] });
    expect(plan.writes.map((w) => [w.path, find(plan.writes, w.path).entry.data.videoId])).toEqual([
      ["video/1.md", "a"],
      ["video/2.md", "c"],
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
    expect(find(plan.writes, "playlist/1.md").entry.data.videos).toEqual(["1"]);
    expect(plan.writes.some((w) => w.path === "playlist/2.md")).toBe(false);
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
