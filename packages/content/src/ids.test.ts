import { describe, expect, it } from "vitest";
import { caseClashes, compareIds, isLegacyId, playlistEntryId, randomEntryId, unusedId, videoEntryId } from "./ids.js";

describe("entry IDs", () => {
  it("tells legacy IDs from new ones", () => {
    expect(isLegacyId("4442")).toBe(true);
    expect(isLegacyId("yt-4442abcdEfg")).toBe(false);
    expect(isLegacyId("k3v9qz2m7d")).toBe(false);
  });

  it("orders legacy IDs by number, then the others as text", () => {
    expect(["yt-b", "10", "k3v9qz2m7d", "9", "yt-A"].sort(compareIds)).toEqual(["9", "10", "k3v9qz2m7d", "yt-A", "yt-b"]);
  });

  it("names videos and playlists after their external IDs", () => {
    expect(videoEntryId("youtube", "eJLVT157BSs")).toBe("yt-eJLVT157BSs");
    expect(videoEntryId("vimeo", "123")).toBe("vimeo-123");
    expect(playlistEntryId("PLabc_-1")).toBe("yt-PLabc_-1");
    expect(playlistEntryId(null)).toMatch(/^[a-z][a-z0-9]{9}$/);
  });

  it("makes random IDs that start with a letter", () => {
    const ids = new Set(Array.from({ length: 200 }, randomEntryId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]{9}$/);
  });

  it("finds IDs that differ only in case", () => {
    expect(caseClashes(["yt-abc", "1", "yt-ABC", "yt-abd"])).toEqual([["yt-abc", "yt-ABC"]]);
    expect(caseClashes(["1", "2"])).toEqual([]);
  });

  it("retries a taken ID and throws when it can't find a free one", () => {
    const queue = ["taken", "free"];
    expect(unusedId(() => queue.shift()!, ["TAKEN"], "x")).toBe("free");
    expect(() => unusedId(() => "yt-a", ["yt-A"], "a video with that ID")).toThrow("there is already a video with that ID");
  });
});
