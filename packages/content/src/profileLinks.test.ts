import { describe, expect, it } from "vitest";
import { detectProfileLink, normalizeProfileLink, profileLinks } from "./profileLinks.js";

describe("normalizeProfileLink", () => {
  it("turns an X handle or profile URL into an x.com URL", () => {
    expect(normalizeProfileLink("x", "jtan")).toBe("https://x.com/jtan");
    expect(normalizeProfileLink("x", " @jtan ")).toBe("https://x.com/jtan");
    expect(normalizeProfileLink("x", "https://twitter.com/jtan")).toBe("https://x.com/jtan");
    expect(normalizeProfileLink("x", "x.com/jtan/status/1")).toBe("https://x.com/jtan");
  });

  it("rejects what isn't an X handle", () => {
    expect(normalizeProfileLink("x", "not a handle")).toBeNull();
    expect(normalizeProfileLink("x", "https://example.com/jtan")).toBeNull();
    expect(normalizeProfileLink("x", "a_handle_that_is_too_long")).toBeNull();
  });

  it("handles Instagram and TikTok handles and URLs", () => {
    expect(normalizeProfileLink("instagram", "@jane.doe")).toBe("https://www.instagram.com/jane.doe/");
    expect(normalizeProfileLink("instagram", "https://instagram.com/jane.doe?igsh=x")).toBe("https://www.instagram.com/jane.doe/");
    expect(normalizeProfileLink("tiktok", "jane.doe")).toBe("https://www.tiktok.com/@jane.doe");
    expect(normalizeProfileLink("tiktok", "https://www.tiktok.com/@jane.doe")).toBe("https://www.tiktok.com/@jane.doe");
    expect(normalizeProfileLink("tiktok", "https://instagram.com/jane")).toBeNull();
  });

  it("fixes website URLs from the old data", () => {
    expect(normalizeProfileLink("website", "encore.dev")).toBe("https://encore.dev");
    expect(normalizeProfileLink("website", "http://http://blog.example.sg")).toBe("http://blog.example.sg");
    expect(normalizeProfileLink("website", "http//redmart.com")).toBe("http://redmart.com");
    expect(normalizeProfileLink("website", "https://example.com/about")).toBe("https://example.com/about");
    expect(normalizeProfileLink("website", "Research Assistant at NTU")).toBeNull();
    expect(normalizeProfileLink("website", "localhost")).toBeNull();
  });

  it("keeps LinkedIn URLs apart from websites", () => {
    expect(normalizeProfileLink("linkedin", "https://sg.linkedin.com/in/someone")).toBe("https://sg.linkedin.com/in/someone");
    expect(normalizeProfileLink("linkedin", "linkedin.com/in/someone")).toBe("https://linkedin.com/in/someone");
    expect(normalizeProfileLink("linkedin", "https://example.com")).toBeNull();
    expect(normalizeProfileLink("website", "https://www.linkedin.com/in/someone")).toBeNull();
  });

  it("returns null for blanks", () => {
    expect(normalizeProfileLink("website", null)).toBeNull();
    expect(normalizeProfileLink("x", "  ")).toBeNull();
  });
});

describe("detectProfileLink", () => {
  it("works out the type from the URL's host", () => {
    expect(detectProfileLink("https://twitter.com/jtan")).toEqual({ type: "x", url: "https://x.com/jtan" });
    expect(detectProfileLink("instagram.com/jane.doe")).toEqual({ type: "instagram", url: "https://www.instagram.com/jane.doe/" });
    expect(detectProfileLink("https://www.tiktok.com/@jane.doe")).toEqual({ type: "tiktok", url: "https://www.tiktok.com/@jane.doe" });
    expect(detectProfileLink("https://sg.linkedin.com/in/someone")).toEqual({ type: "linkedin", url: "https://sg.linkedin.com/in/someone" });
    expect(detectProfileLink("jtan.dev")).toEqual({ type: "website", url: "https://jtan.dev" });
  });

  it("takes an @handle as an X handle", () => {
    expect(detectProfileLink(" @jtan ")).toEqual({ type: "x", url: "https://x.com/jtan" });
  });

  it("returns null for what isn't a link", () => {
    expect(detectProfileLink("Jane Doe")).toBeNull();
    expect(detectProfileLink("@not a handle")).toBeNull();
    expect(detectProfileLink("https://x.com/")).toBeNull();
    expect(detectProfileLink("")).toBeNull();
  });
});

describe("profileLinks", () => {
  it("normalizes each given link, in type order, skipping blanks", () => {
    expect(profileLinks({ tiktok: "@jt", website: "jtan.dev", x: "@jtan", linkedin: " " })).toEqual([
      { type: "x", url: "https://x.com/jtan" },
      { type: "website", url: "https://jtan.dev" },
      { type: "tiktok", url: "https://www.tiktok.com/@jt" },
    ]);
  });

  it("throws on a value that isn't a link of its type", () => {
    expect(() => profileLinks({ linkedin: "https://example.com" })).toThrow('"https://example.com" is not a valid linkedin link');
  });
});
