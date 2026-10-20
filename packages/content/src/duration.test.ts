import { describe, expect, it } from "vitest";
import { normalizeDuration, withDuration } from "./duration.js";

describe("normalizeDuration", () => {
  it("keeps real ISO 8601 durations", () => {
    for (const d of ["PT27M13S", "PT1H2M3S", "PT45S", "PT3H", "P1DT2H", "P2D"]) expect(normalizeDuration(d)).toBe(d);
    expect(normalizeDuration(" pt5m ")).toBe("PT5M");
  });

  it("drops zero, empty and malformed values", () => {
    for (const d of ["P0D", "PT0S", "PT0M0S", "PT", "P", "", "  ", "27:13", "PT1.5S", "1H", null, undefined]) {
      expect(normalizeDuration(d)).toBeNull();
    }
  });
});

describe("withDuration", () => {
  const video = { id: "1", publishedAt: "2020-01-01T00:00:00Z", slug: "a" };

  it("puts the duration right after publishedAt", () => {
    expect(Object.keys(withDuration(video, "PT5M"))).toEqual(["id", "publishedAt", "duration", "slug"]);
    expect(withDuration(video, "PT5M")).toMatchObject({ duration: "PT5M" });
  });

  it("replaces an old duration, keeps it when there is no new one, and never adds an empty one", () => {
    const has = { ...video, duration: "PT1M" };
    expect(withDuration(has, "PT9M")).toMatchObject({ duration: "PT9M" });
    expect(withDuration(has, null)).toMatchObject({ duration: "PT1M" });
    expect(withDuration(has, "P0D")).toMatchObject({ duration: "PT1M" });
    expect(withDuration(video, "P0D")).not.toHaveProperty("duration");
  });
});
