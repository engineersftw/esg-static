import { describe, expect, it } from "vitest";
import type { Video } from "@esg/db-types/content";
import { append, insertNewestFirst, reconcileLinks, without, type HasVideos } from "./links.js";
import { slugAllocator, slugify } from "./slug.js";

const dates: Record<string, string> = { "1": "2020-01-01T00:00:00Z", "2": "2021-01-01T00:00:00Z", "3": "2022-01-01T00:00:00Z" };
const publishedAt = (id: string) => dates[id];

function video(id: string, over: Partial<Video> = {}): Video {
  return {
    id,
    videoId: `yt${id}`,
    videoTitle: `Video ${id}`,
    publishedAt: dates[id] ?? "2019-01-01T00:00:00Z",
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
  };
}

describe("append / without", () => {
  it("returns the same array when there is nothing to do", () => {
    const ids = ["1", "2"];
    expect(append(ids, "2")).toBe(ids);
    expect(without(ids, "3")).toBe(ids);
    expect(append(ids, "3")).toEqual(["1", "2", "3"]);
    expect(without(ids, "1")).toEqual(["2"]);
    expect(ids).toEqual(["1", "2"]);
  });
});

describe("insertNewestFirst", () => {
  it("inserts before the first older video and keeps the existing order", () => {
    expect(insertNewestFirst(["3", "1"], "2", publishedAt)).toEqual(["3", "2", "1"]);
    expect(insertNewestFirst(["2", "1"], "3", publishedAt)).toEqual(["3", "2", "1"]);
    expect(insertNewestFirst(["3", "2"], "1", publishedAt)).toEqual(["3", "2", "1"]);
    expect(insertNewestFirst([], "1", publishedAt)).toEqual(["1"]);
  });

  it("puts videos with no known date last and does not add one twice", () => {
    expect(insertNewestFirst(["3"], "x", publishedAt)).toEqual(["3", "x"]);
    expect(insertNewestFirst(["x"], "2", publishedAt)).toEqual(["2", "x"]);
    const ids = ["2"];
    expect(insertNewestFirst(ids, "2", publishedAt)).toBe(ids);
  });
});

describe("reconcileLinks", () => {
  it("completes one-sided links in both directions, in each side's order", () => {
    const videos = new Map([
      ["1", video("1", { presenters: ["p"] })],
      ["2", video("2")],
      ["3", video("3", { presenters: ["q", "p"] })],
    ]);
    const others = new Map<string, HasVideos>([
      ["p", { id: "p", videos: ["2"] }],
      ["q", { id: "q", videos: ["3"] }],
    ]);
    const before = videos.get("1")!.presenters;

    const changed = reconcileLinks("presenters", videos, others);

    expect(others.get("p")!.videos).toEqual(["3", "2", "1"]); // newest first
    expect(videos.get("2")!.presenters).toEqual(["p"]);
    expect([...changed.videos]).toEqual(["2"]);
    expect([...changed.others]).toEqual(["p"]);
    expect(before).toEqual(["p"]); // arrays replaced, not mutated
  });

  it("appends to a playlist and leaves dangling IDs alone", () => {
    const videos = new Map([["2", video("2", { playlists: ["a", "missing"] })]]);
    const others = new Map<string, HasVideos>([["a", { id: "a", videos: ["3", "missing"] }]]);

    const changed = reconcileLinks("playlists", videos, others);

    expect(others.get("a")!.videos).toEqual(["3", "missing", "2"]);
    expect(videos.get("2")!.playlists).toEqual(["a", "missing"]);
    expect(changed.videos.size).toBe(0);
  });
});

describe("slugs", () => {
  it("slugifies like pg-export and keeps them unique", () => {
    expect(slugify("Ünïcode & Friends!")).toBe("unicode-friends");
    expect(slugify("日本語", "presenter-1")).toBe("presenter-1");
    const next = slugAllocator(["jane-doe"]);
    expect(next("Jane Doe", "x")).toBe("jane-doe-2");
    expect(next("Jane Doe", "x")).toBe("jane-doe-3");
  });
});
