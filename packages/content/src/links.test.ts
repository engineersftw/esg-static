import { describe, expect, it } from "vitest";
import { append, without } from "./links.js";
import { slugAllocator, slugify } from "./slug.js";

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

describe("slugs", () => {
  it("slugifies like pg-export and keeps them unique", () => {
    expect(slugify("Ünïcode & Friends!")).toBe("unicode-friends");
    expect(slugify("日本語", "presenter-1")).toBe("presenter-1");
    const next = slugAllocator(["jane-doe"]);
    expect(next("Jane Doe", "x")).toBe("jane-doe-2");
    expect(next("Jane Doe", "x")).toBe("jane-doe-3");
    expect(next("新加坡", "video-yt-AbC_1")).toBe("video-yt-abc-1");
  });
});
