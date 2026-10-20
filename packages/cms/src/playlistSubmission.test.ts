import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { YtPlaylist, YtPlaylistItem, YtVideo } from "@esg/yt-export/youtube";
import { Cms, PLAYLIST_CATEGORIES } from "./cms.js";
import {
  applyPlaylistSubmission,
  MAX_PLAYLIST_VIDEOS,
  PLAYLIST_FORM_FIELDS,
  parsePlaylistSubmission,
  playlistAddedReport,
  videosToFetch,
  youtubePlaylistId,
  type PlaylistSubmission,
  type YouTubePlaylistData,
} from "./playlistSubmission.js";
import { SubmissionError } from "./submission.js";
import { content, counterIds, data, organization, playlist, video } from "./testContent.js";

const PL = "PLabcdefghijklmnop";

/** An issue body as GitHub renders the submit-playlist form. */
const issueBody = (fields: { url?: string; category?: string; group?: string; date?: string; website?: string; notes?: string }) =>
  [
    `### YouTube playlist URL\n\n${fields.url ?? "_No response_"}`,
    `### Category\n\n${fields.category ?? "_No response_"}`,
    `### Conference, meetup or group\n\n${fields.group ?? "_No response_"}`,
    `### Event date\n\n${fields.date ?? "_No response_"}`,
    `### Website\n\n${fields.website ?? "_No response_"}`,
    `### Anything else\n\n${fields.notes ?? "_No response_"}`,
  ].join("\n\n");

const submission = (over: Partial<PlaylistSubmission> = {}): PlaylistSubmission => ({
  playlistId: PL,
  category: null,
  group: null,
  date: null,
  website: null,
  notes: null,
  ...over,
});

const ytPlaylist = (over: Partial<YtPlaylist["snippet"]> = {}, privacyStatus: "public" | "unlisted" | "private" = "public"): YtPlaylist => ({
  id: PL,
  snippet: {
    title: "PyCon SG 2024",
    description: "Talks from PyCon SG 2024",
    publishedAt: "2024-07-01T08:00:00Z",
    channelId: "UCx",
    channelTitle: "PyCon SG",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg" }, high: { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" } },
    ...over,
  },
  status: { privacyStatus },
});

const item = (videoId: string, position: number, title = `Talk ${videoId}`): YtPlaylistItem => ({
  id: `item-${videoId}`,
  snippet: { playlistId: PL, position, title },
  contentDetails: { videoId },
});

const ytVideo = (id: string, privacyStatus: YtVideo["status"]["privacyStatus"] = "public"): YtVideo => ({
  id,
  snippet: {
    title: `Talk ${id}`,
    description: "",
    publishedAt: "2024-06-15T10:00:00Z",
    channelId: "UCx",
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
  },
  status: { privacyStatus },
});

const youtube = (over: Partial<YouTubePlaylistData> = {}): YouTubePlaylistData => ({
  playlist: ytPlaylist(),
  items: [item("bbbbbbbbbbb", 1), item("aaaaaaaaaaa", 0)],
  videos: [ytVideo("aaaaaaaaaaa"), ytVideo("bbbbbbbbbbb")],
  ...over,
});

describe("the Submit a playlist form", () => {
  const form = readFileSync(new URL("../../../.github/ISSUE_TEMPLATE/submit-playlist.yml", import.meta.url), "utf8");

  it("has the labels the parser reads", () => {
    for (const label of Object.values(PLAYLIST_FORM_FIELDS)) expect(form).toContain(`label: ${label}\n`);
  });

  it("offers only known categories", () => {
    const options = form.slice(form.indexOf("id: category")).split("validations:")[0].match(/^ +- (.+)$/gm)!.map((l) => l.replace(/^ +- /, ""));
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(PLAYLIST_CATEGORIES).toContain(o);
  });
});

describe("youtubePlaylistId", () => {
  it("reads the list parameter of a playlist or watch URL, or a bare ID", () => {
    expect(youtubePlaylistId(`https://www.youtube.com/playlist?list=${PL}`)).toBe(PL);
    expect(youtubePlaylistId(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}&index=2`)).toBe(PL);
    expect(youtubePlaylistId(`m.youtube.com/playlist?list=${PL}`)).toBe(PL);
    expect(youtubePlaylistId(`https://youtu.be/dQw4w9WgXcQ?list=${PL}`)).toBe(PL);
    expect(youtubePlaylistId(` ${PL} `)).toBe(PL);
  });

  it("is null for other sites, mixes, videos and junk", () => {
    expect(youtubePlaylistId(`https://example.com/playlist?list=${PL}`)).toBeNull();
    expect(youtubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ")).toBeNull();
    expect(youtubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubePlaylistId("dQw4w9WgXcQ")).toBeNull();
    expect(youtubePlaylistId("not a link")).toBeNull();
  });
});

describe("parsePlaylistSubmission", () => {
  it("reads every field", () => {
    const sub = parsePlaylistSubmission(
      issueBody({ url: `https://www.youtube.com/playlist?list=${PL}`, category: "conference", group: " PyCon  SG ", date: "2024-06-01", website: "pycon.sg", notes: "Thanks!" }),
    );
    expect(sub).toEqual({ playlistId: PL, category: "Conference", group: "PyCon SG", date: "2024-06-01", website: "https://pycon.sg", notes: "Thanks!" });
  });

  it("leaves the optional fields empty", () => {
    expect(parsePlaylistSubmission(issueBody({ url: PL }))).toEqual(submission());
  });

  it("treats an unknown category as none", () => {
    expect(parsePlaylistSubmission(issueBody({ url: PL, category: "Party" })).category).toBeNull();
  });

  it("rejects a missing or bad link, date or website", () => {
    expect(() => parsePlaylistSubmission(issueBody({}))).toThrow(SubmissionError);
    expect(() => parsePlaylistSubmission(issueBody({ url: "https://youtu.be/dQw4w9WgXcQ" }))).toThrow(/isn't a link to a YouTube playlist/);
    expect(() => parsePlaylistSubmission(issueBody({ url: PL, date: "1 June 2024" }))).toThrow(/YYYY-MM-DD/);
    expect(() => parsePlaylistSubmission(issueBody({ url: PL, website: "not a site" }))).toThrow(/isn't a web address/);
  });
});

describe("applyPlaylistSubmission", () => {
  const existing = () => content({ video: [...content().video, video("6", "2024-06-01T00:00:00Z", { videoId: "aaaaaaaaaaa", organizations: [] })] });

  it("creates the playlist with its videos in YouTube's order", () => {
    const cms = new Cms(content(), { randomId: counterIds() });
    const result = applyPlaylistSubmission(cms, submission({ category: "Conference" }), youtube());
    expect(result.playlist.id).toBe(`yt-${PL}`);
    expect(result.videos.map((v) => v.video.id)).toEqual(["yt-aaaaaaaaaaa", "yt-bbbbbbbbbbb"]);
    expect(data(cms, `playlist/yt-${PL}.md`).data).toMatchObject({
      playlistId: PL,
      playlistTitle: "PyCon SG 2024",
      publishDate: "2024-07-01",
      image: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
      category: "Conference",
      active: true,
      videos: ["yt-aaaaaaaaaaa", "yt-bbbbbbbbbbb"],
    });
    expect(data(cms, "video/yt-aaaaaaaaaaa.md").data).toMatchObject({ active: true, organizations: [] });
  });

  it("uses the submitted date and website", () => {
    const cms = new Cms(content());
    const { playlist: p } = applyPlaylistSubmission(cms, submission({ date: "2024-06-01", website: "https://pycon.sg" }), youtube());
    expect(p.publishDate).toBe("2024-06-01");
    expect(p.website).toBe("https://pycon.sg");
  });

  it("reuses existing videos and links only the new ones to the organization", () => {
    const cms = new Cms(existing());
    const result = applyPlaylistSubmission(cms, submission({ group: "org 5" }), youtube({ videos: [ytVideo("bbbbbbbbbbb")] }));
    expect(result.organization?.id).toBe("5");
    expect(result.videos.map((v) => [v.video.id, v.created])).toEqual([
      ["6", false],
      ["yt-bbbbbbbbbbb", true],
    ]);
    expect(data(cms, "video/yt-bbbbbbbbbbb.md").data.organizations).toEqual(["5"]);
    expect(cms.changes().some((c) => c.path === "video/6.md")).toBe(false);
  });

  it("skips private, deleted and unlisted videos", () => {
    const cms = new Cms(content());
    const result = applyPlaylistSubmission(
      cms,
      submission(),
      youtube({ items: [item("aaaaaaaaaaa", 0), item("bbbbbbbbbbb", 1, "Private video"), item("ccccccccccc", 2)], videos: [ytVideo("aaaaaaaaaaa"), ytVideo("ccccccccccc", "unlisted")] }),
    );
    expect(result.videos.map((v) => v.video.id)).toEqual(["yt-aaaaaaaaaaa"]);
    expect(result.skipped).toEqual([
      { videoId: "bbbbbbbbbbb", title: "Private video", reason: "private or deleted" },
      { videoId: "ccccccccccc", title: "Talk ccccccccccc", reason: "unlisted" },
    ]);
  });

  it("ignores a group that isn't an active organization", () => {
    const cms = new Cms(content({ organization: [organization("5", { active: false })] }));
    expect(applyPlaylistSubmission(cms, submission({ group: "Org 5" }), youtube()).organization).toBeNull();
    expect(applyPlaylistSubmission(new Cms(content()), submission({ group: "Nobody" }), youtube()).organization).toBeNull();
  });

  it("allows a title another playlist has, and reports it", () => {
    const cms = new Cms(content({ playlist: [playlist("4", { playlistTitle: "PyCon SG 2024" })] }));
    expect(applyPlaylistSubmission(cms, submission(), youtube()).sameTitle.map((p) => p.id)).toEqual(["4"]);
  });

  it("rejects a playlist that is already there, missing, not public, empty or too big", () => {
    const already = new Cms(content({ playlist: [playlist("4", { playlistId: PL })] }));
    expect(() => applyPlaylistSubmission(already, submission(), youtube())).toThrow(/already on Engineers.SG: https:\/\/engineers.sg\/playlist\/playlist-4/);
    const hidden = new Cms(content({ playlist: [playlist("4", { playlistId: PL, active: false })] }));
    expect(() => applyPlaylistSubmission(hidden, submission(), youtube())).toThrow(/hidden from the site/);
    const cms = () => new Cms(content());
    expect(() => applyPlaylistSubmission(cms(), submission(), youtube({ playlist: undefined }))).toThrow(/no public playlist/);
    expect(() => applyPlaylistSubmission(cms(), submission(), youtube({ playlist: ytPlaylist({}, "unlisted") }))).toThrow(/unlisted on YouTube/);
    expect(() => applyPlaylistSubmission(cms(), submission(), youtube({ videos: [] }))).toThrow(/no public videos/);
    const many = Array.from({ length: MAX_PLAYLIST_VIDEOS + 1 }, (_, i) => item(`v${String(i).padStart(10, "0")}`, i));
    expect(() => applyPlaylistSubmission(cms(), submission(), youtube({ items: many }))).toThrow(/more than the 300/);
  });

  it("writes nothing when it rejects", () => {
    const cms = new Cms(content());
    expect(() => applyPlaylistSubmission(cms, submission(), youtube({ videos: [] }))).toThrow(SubmissionError);
    expect(cms.changes()).toEqual([]);
  });
});

describe("videosToFetch", () => {
  it("lists the items' videos the content doesn't have, once each", () => {
    const cms = new Cms(content({ video: [video("6", "2024-06-01T00:00:00Z", { videoId: "aaaaaaaaaaa" })] }));
    expect(videosToFetch(cms, [item("aaaaaaaaaaa", 0), item("bbbbbbbbbbb", 1), item("bbbbbbbbbbb", 2)])).toEqual(["bbbbbbbbbbb"]);
  });
});

describe("playlistAddedReport", () => {
  it("describes the playlist, its videos and the review steps", () => {
    const cms = new Cms(content());
    const sub = submission({ category: "Conference", group: "Org 5", notes: "Day 1 <b>and</b> 2 @someone" });
    const report = playlistAddedReport(applyPlaylistSubmission(cms, sub, youtube()), sub, 12);
    expect(report).toContain("Adds the playlist submitted in #12.");
    expect(report).toContain(`(https://www.youtube.com/playlist?list=${PL})`);
    expect(report).toContain(`- Playlist yt-${PL}: \`/conference/pycon-sg-2024\``);
    expect(report).toContain("2 videos: 2 new, 0 already on the site");
    expect(report).toContain("Linked the new videos to organization 5");
    expect(report).toContain("&lt;b&gt;and&lt;/b&gt; 2 &#64;someone");
    expect(report).toContain("Closes #12");
  });

  it("explains how to link an organization that wasn't found", () => {
    const cms = new Cms(content());
    const sub = submission({ group: "Nobody" });
    expect(playlistAddedReport(applyPlaylistSubmission(cms, sub, youtube()), sub)).toContain(`pnpm cms assign --from-playlist yt-${PL} --organization <ref>`);
  });
});
