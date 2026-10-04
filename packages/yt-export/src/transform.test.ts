import { describe, expect, it } from "vitest";
import { VideoSite } from "@esg/db-types";
import { slugify, toPgDate, toPgTimestamp, transform, uniqueSlugs, type RawExport } from "./transform.js";
import type { YtPlaylist, YtPlaylistItem, YtPrivacyStatus, YtVideo } from "./youtube.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
const NOW = new Date("2026-10-04T12:34:56.789Z");
const STAMP = "2026-10-04 12:34:56.789";

function video(id: string, publishedAt: string, opts: { privacy?: YtPrivacyStatus; viewCount?: string | null } = {}): YtVideo {
  return {
    id,
    snippet: {
      title: `Video ${id}`,
      description: `Speaker: Someone\n\nProduced by Engineers.SG`,
      publishedAt,
      channelId: "UCchannel",
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
        high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      },
    },
    ...(opts.viewCount === null ? {} : { statistics: { viewCount: opts.viewCount ?? "100" } }),
    status: { privacyStatus: opts.privacy ?? "public" },
  };
}

function playlist(id: string, title: string, publishedAt: string, privacy: YtPrivacyStatus = "public"): YtPlaylist {
  return {
    id,
    snippet: {
      title,
      description: `About ${title}`,
      publishedAt,
      channelId: "UCchannel",
      thumbnails: {
        default: { url: `https://i.ytimg.com/pl/${id}/default.jpg` },
        high: { url: `https://i.ytimg.com/pl/${id}/hqdefault.jpg` },
      },
    },
    status: { privacyStatus: privacy },
  };
}

function item(playlistId: string, videoId: string, position: number): YtPlaylistItem {
  return {
    id: `${playlistId}-${position}`,
    snippet: { playlistId, position, title: `Video ${videoId}` },
    contentDetails: { videoId },
  };
}

function raw(parts: Partial<RawExport>): RawExport {
  return {
    fetchedAt: "2026-10-04T12:00:00.000Z",
    channel: {
      id: "UCchannel",
      snippet: { title: "Engineers.SG" },
      contentDetails: { relatedPlaylists: { uploads: "UUchannel" } },
    },
    playlists: [],
    playlistItems: {},
    videos: [],
    ...parts,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
describe("toPgTimestamp", () => {
  it("formats whole seconds without a fraction, like backup/", () => {
    expect(toPgTimestamp("2023-11-03T06:41:58Z")).toBe("2023-11-03 06:41:58");
  });

  it("keeps milliseconds when present", () => {
    expect(toPgTimestamp(NOW)).toBe(STAMP);
  });

  it("converts offsets to UTC", () => {
    expect(toPgTimestamp("2023-11-03T14:41:58+08:00")).toBe("2023-11-03 06:41:58");
  });
});

describe("toPgDate", () => {
  it("takes the UTC date", () => {
    expect(toPgDate("2021-10-23T03:00:00Z")).toBe("2021-10-23");
    expect(toPgDate("2021-10-23T01:00:00+08:00")).toBe("2021-10-22");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("GeekcampSG 2021")).toBe("geekcampsg-2021");
  });

  it("strips punctuation and diacritics and trims hyphens", () => {
    expect(slugify("  Café & Code: Vol. 2!  ")).toBe("cafe-code-vol-2");
  });

  it("falls back when nothing usable remains", () => {
    expect(slugify("新加坡")).toBe("playlist");
  });
});

describe("uniqueSlugs", () => {
  it("suffixes collisions in order", () => {
    expect(uniqueSlugs(["Talk", "talk!", "Talk", "Other"])).toEqual(["talk", "talk-2", "talk-3", "other"]);
  });

  it("does not reuse a slug that already exists literally", () => {
    expect(uniqueSlugs(["Talk 2", "Talk", "Talk"])).toEqual(["talk-2", "talk", "talk-3"]);
  });
});

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------
describe("transform: episodes", () => {
  it("maps video fields to an Episode", () => {
    const { episodes } = transform(raw({ videos: [video("abc", "2023-11-03T06:41:58Z", { viewCount: "2483" })] }), NOW);
    expect(episodes).toEqual([
      {
        id: 1,
        video_id: "abc",
        title: "Video abc",
        published_at: "2023-11-03 06:41:58",
        description: "Speaker: Someone\n\nProduced by Engineers.SG",
        image1: "https://i.ytimg.com/vi/abc/default.jpg",
        image2: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
        image3: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        created_at: STAMP,
        updated_at: STAMP,
        sort_order: null,
        active: true,
        video_site: VideoSite.YouTube,
        view_count: 2483,
      },
    ]);
  });

  it("assigns ids oldest first, breaking ties by video id", () => {
    const { episodes } = transform(
      raw({
        videos: [
          video("c", "2024-01-01T00:00:00Z"),
          video("b", "2020-01-01T00:00:00Z"),
          video("a", "2024-01-01T00:00:00Z"),
        ],
      }),
      NOW,
    );
    expect(episodes.map((e) => [e.id, e.video_id])).toEqual([
      [1, "b"],
      [2, "a"],
      [3, "c"],
    ]);
  });

  it("drops private videos and marks unlisted ones inactive", () => {
    const { episodes } = transform(
      raw({
        videos: [
          video("pub", "2020-01-01T00:00:00Z"),
          video("priv", "2020-01-02T00:00:00Z", { privacy: "private" }),
          video("unl", "2020-01-03T00:00:00Z", { privacy: "unlisted" }),
        ],
      }),
      NOW,
    );
    expect(episodes.map((e) => [e.video_id, e.active])).toEqual([
      ["pub", true],
      ["unl", false],
    ]);
  });

  it("uses null view_count when statistics are hidden", () => {
    const { episodes } = transform(raw({ videos: [video("a", "2020-01-01T00:00:00Z", { viewCount: null })] }), NOW);
    expect(episodes[0].view_count).toBeNull();
  });

  it("uses null for missing thumbnails", () => {
    const v = video("a", "2020-01-01T00:00:00Z");
    v.snippet.thumbnails = { default: v.snippet.thumbnails.default };
    const { episodes } = transform(raw({ videos: [v] }), NOW);
    expect([episodes[0].image1, episodes[0].image2, episodes[0].image3]).toEqual([
      "https://i.ytimg.com/vi/a/default.jpg",
      null,
      null,
    ]);
  });
});

describe("transform: playlists", () => {
  it("maps playlist fields, leaving curated fields null", () => {
    const { playlists } = transform(raw({ playlists: [playlist("PL1", "GeekcampSG 2021", "2021-10-23T03:00:00Z")] }), NOW);
    expect(playlists).toEqual([
      {
        id: 1,
        playlist_id: "PL1",
        name: "GeekcampSG 2021",
        description: "About GeekcampSG 2021",
        publish_date: "2021-10-23",
        image: "https://i.ytimg.com/pl/PL1/hqdefault.jpg",
        active: true,
        created_at: STAMP,
        updated_at: STAMP,
        website: null,
        hashtag: null,
        playlist_category_id: null,
        slug: "geekcampsg-2021",
      },
    ]);
  });

  it("assigns ids oldest first and de-duplicates slugs in that order", () => {
    const { playlists } = transform(
      raw({
        playlists: [
          playlist("PLnew", "Meetup", "2023-01-01T00:00:00Z"),
          playlist("PLold", "Meetup", "2019-01-01T00:00:00Z"),
        ],
      }),
      NOW,
    );
    expect(playlists.map((p) => [p.id, p.playlist_id, p.slug])).toEqual([
      [1, "PLold", "meetup"],
      [2, "PLnew", "meetup-2"],
    ]);
  });

  it("falls back to smaller thumbnails and marks non-public playlists inactive", () => {
    const p = playlist("PL1", "Hidden", "2020-01-01T00:00:00Z", "unlisted");
    delete p.snippet.thumbnails.high;
    const { playlists } = transform(raw({ playlists: [p] }), NOW);
    expect(playlists[0].image).toBe("https://i.ytimg.com/pl/PL1/default.jpg");
    expect(playlists[0].active).toBe(false);
  });
});

describe("transform: playlist_items", () => {
  const videos = [
    video("v1", "2020-01-01T00:00:00Z"),
    video("v2", "2020-01-02T00:00:00Z"),
    video("v3", "2020-01-03T00:00:00Z"),
  ];
  const playlists = [playlist("PLa", "A", "2020-01-01T00:00:00Z"), playlist("PLb", "B", "2021-01-01T00:00:00Z")];

  it("links playlists to episodes by internal id, ordered by position", () => {
    const { playlist_items } = transform(
      raw({ videos, playlists, playlistItems: { PLa: [item("PLa", "v3", 1), item("PLa", "v1", 0)] } }),
      NOW,
    );
    expect(playlist_items).toEqual([
      { id: 1, playlist_id: 1, episode_id: 1, sort_order: 0, created_at: STAMP, updated_at: STAMP },
      { id: 2, playlist_id: 1, episode_id: 3, sort_order: 1, created_at: STAMP, updated_at: STAMP },
    ]);
  });

  it("gives a video in several playlists one episode and one item per playlist", () => {
    const { episodes, playlist_items } = transform(
      raw({ videos, playlists, playlistItems: { PLb: [item("PLb", "v2", 0)], PLa: [item("PLa", "v2", 0)] } }),
      NOW,
    );
    expect(episodes.filter((e) => e.video_id === "v2")).toHaveLength(1);
    expect(playlist_items.map((i) => [i.playlist_id, i.episode_id])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("drops items for unavailable or private videos, keeping the original position", () => {
    const { playlist_items } = transform(
      raw({
        videos: [...videos, video("priv", "2020-01-04T00:00:00Z", { privacy: "private" })],
        playlists,
        playlistItems: {
          PLa: [item("PLa", "deleted", 0), item("PLa", "priv", 1), item("PLa", "v2", 2)],
        },
      }),
      NOW,
    );
    expect(playlist_items.map((i) => [i.episode_id, i.sort_order])).toEqual([[2, 2]]);
  });

  it("keeps only the first occurrence of a video repeated within a playlist", () => {
    const { playlist_items } = transform(
      raw({ videos, playlists, playlistItems: { PLa: [item("PLa", "v1", 0), item("PLa", "v1", 1)] } }),
      NOW,
    );
    expect(playlist_items.map((i) => [i.episode_id, i.sort_order])).toEqual([[1, 0]]);
  });

  it("exports videos that are in no playlist as episodes", () => {
    const { episodes, playlist_items } = transform(raw({ videos, playlists, playlistItems: {} }), NOW);
    expect(episodes).toHaveLength(3);
    expect(playlist_items).toEqual([]);
  });
});
