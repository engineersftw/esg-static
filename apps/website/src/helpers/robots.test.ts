import { describe, expect, it } from "vitest";
import { robotsTxt } from "./robots";

describe("robotsTxt", () => {
  it("allows crawling and points at the sitemap when indexing is on", () => {
    const text = robotsTxt(new URL("https://engineers.sg"), "true");
    expect(text).toContain("Allow: /\n");
    expect(text).toContain("Disallow: /api/\n");
    expect(text).toContain("Disallow: /search\n");
    expect(text).toContain("Sitemap: https://engineers.sg/sitemap-index.xml\n");
  });

  it("blocks everything unless the variable is exactly true", () => {
    for (const value of [undefined, "", "false", "1", "TRUE"]) {
      expect(robotsTxt("https://engineers.sg", value)).toBe("User-agent: *\nDisallow: /\n");
    }
  });
});
