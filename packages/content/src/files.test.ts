import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEntry, readEntries, serializeEntry, toBody, writeEntryFiles } from "./files.js";

// A file exactly as pg-export writes it.
const FILE = `---
id: "4442"
videoId: "r_GiEIe_oZk"
videoTitle: "Making a \\"HDMI\\" ISA card: Hackware v7.9"
publishedAt: "2023-11-03T06:41:58Z"
thumbnailHigh: null
organizations: ["111"]
active: true
---

Speaker: Yeo Kheng Meng

Produced by Engineers.SG
`;

describe("toBody", () => {
  it("normalizes line endings and trims", () => {
    expect(toBody("  a\r\nb\rc \n\n")).toBe("a\nb\nc");
  });

  it("is empty for null", () => {
    expect(toBody(null)).toBe("");
  });
});

describe("parseEntry", () => {
  it("reads JSON-valued frontmatter and the body", () => {
    const e = parseEntry<Record<string, unknown>>("video/4442.md", FILE);
    expect(e.id).toBe("4442");
    expect(e.path).toBe("video/4442.md");
    expect(e.data).toEqual({
      id: "4442",
      videoId: "r_GiEIe_oZk",
      videoTitle: 'Making a "HDMI" ISA card: Hackware v7.9',
      publishedAt: "2023-11-03T06:41:58Z",
      thumbnailHigh: null,
      organizations: ["111"],
      active: true,
    });
    expect(e.body).toBe("Speaker: Yeo Kheng Meng\n\nProduced by Engineers.SG");
    expect(e.text).toBe(FILE);
  });

  it("keeps the field order", () => {
    expect(Object.keys(parseEntry("video/1.md", FILE).data)).toEqual([
      "id",
      "videoId",
      "videoTitle",
      "publishedAt",
      "thumbnailHigh",
      "organizations",
      "active",
    ]);
  });

  it("reads a file with no body", () => {
    const e = parseEntry("playlist/1.md", '---\nid: "1"\n---\n');
    expect(e.body).toBe("");
  });

  it("rejects a file without frontmatter", () => {
    expect(() => parseEntry("video/1.md", "hello")).toThrow(/missing frontmatter/);
  });

  it("rejects a frontmatter value that is not JSON", () => {
    expect(() => parseEntry("video/1.md", "---\nid: 1abc\n---\n")).toThrow(/not JSON/);
  });
});

describe("serializeEntry", () => {
  it("reproduces a parsed file byte for byte", () => {
    const e = parseEntry("video/4442.md", FILE);
    expect(serializeEntry(e.data, e.body)).toBe(FILE);
  });

  it("reproduces a file with no body", () => {
    const text = '---\nid: "1"\nvideos: []\n---\n';
    const e = parseEntry("playlist/1.md", text);
    expect(serializeEntry(e.data, e.body)).toBe(text);
  });

  it("normalizes the body it is given", () => {
    expect(serializeEntry({ id: "1" }, "  Hello\r\nworld \n")).toBe('---\nid: "1"\n---\n\nHello\nworld\n');
  });

  it("keeps a body line that looks like a frontmatter delimiter", () => {
    const text = serializeEntry({ id: "1" }, "a\n---\nb");
    const e = parseEntry("video/1.md", text);
    expect(e.body).toBe("a\n---\nb");
    expect(serializeEntry(e.data, e.body)).toBe(text);
  });
});

describe("readEntries / writeEntryFiles", () => {
  it("reads a collection directory in file name order, ignoring other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "yt-content-"));
    mkdirSync(join(dir, "video"));
    writeFileSync(join(dir, "video", "2.md"), '---\nid: "2"\n---\n');
    writeFileSync(join(dir, "video", "1.md"), '---\nid: "1"\n---\n');
    writeFileSync(join(dir, "video", "notes.txt"), "ignore me");
    expect(readEntries(dir, "video").map((e) => e.path)).toEqual(["video/1.md", "video/2.md"]);
  });

  it("treats a missing collection directory as empty", () => {
    expect(readEntries(mkdtempSync(join(tmpdir(), "yt-content-")), "playlist")).toEqual([]);
  });

  it("writes files, creating directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "yt-content-"));
    writeEntryFiles(dir, [{ path: "playlist/7.md", content: FILE }]);
    expect(readFileSync(join(dir, "playlist", "7.md"), "utf8")).toBe(FILE);
  });
});
