import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms";

describe("llmsTxt", () => {
  const text = llmsTxt(new URL("https://engineers.sg"));

  it("starts with the site name and description", () => {
    expect(text.startsWith("# Engineers.SG\n\n> ")).toBe(true);
  });

  it("links to the lists with absolute URLs", () => {
    for (const path of ["videos", "conferences", "organizations", "presenters", "search", "feed"]) {
      expect(text).toContain(`](https://engineers.sg/${path})`);
    }
    expect(text).toContain("https://engineers.sg/video/<slug>");
    expect(text).toContain("https://engineers.sg/sitemap-index.xml");
  });
});
