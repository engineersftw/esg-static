import { describe, expect, it } from "vitest";
import { isStandIn, thumbnailSource } from "./thumbnails";

const youtube = (id: string) => ({
  default: `https://i.ytimg.com/vi/${id}/default.jpg`,
  medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  high: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

describe("thumbnailSource", () => {
  it("uses the stored high-quality thumbnail and offers maxresdefault for YouTube", () => {
    expect(thumbnailSource(youtube("abc"))).toEqual({
      src: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      srcset: "https://i.ytimg.com/vi/abc/hqdefault.jpg 480w, https://i.ytimg.com/vi/abc/maxresdefault.jpg 1280w",
    });
  });

  it("works for the other YouTube image hosts", () => {
    const high = "https://i9.ytimg.com/vi/abc/hqdefault.jpg";
    expect(thumbnailSource({ default: null, medium: null, high })?.srcset).toContain("https://i9.ytimg.com/vi/abc/maxresdefault.jpg 1280w");
  });

  it("gives other sites' thumbnails as they are", () => {
    const high = "https://i.vimeocdn.com/video/123_640.jpg";
    expect(thumbnailSource({ default: null, medium: null, high })).toEqual({ src: high });
  });

  it("falls back to the smaller stored sizes, without a larger version", () => {
    const { medium, default: small } = youtube("abc");
    expect(thumbnailSource({ high: null, medium, default: small })).toEqual({ src: medium });
    expect(thumbnailSource({ high: null, medium: null, default: small })).toEqual({ src: small });
  });

  it("returns null when there is no thumbnail", () => {
    expect(thumbnailSource({ high: null, medium: null, default: null })).toBeNull();
  });
});

describe("isStandIn", () => {
  it("tells YouTube's 4:3 stand-in from a real 16:9 thumbnail, at any display density", () => {
    expect(isStandIn(120, 90)).toBe(true);
    expect(isStandIn(39, 29)).toBe(true);
    expect(isStandIn(1280, 720)).toBe(false);
    expect(isStandIn(420, 236)).toBe(false);
  });

  it("does not call an image that has not loaded a stand-in", () => {
    expect(isStandIn(0, 0)).toBe(false);
  });
});
