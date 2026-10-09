import { describe, expect, it } from "vitest";
import type { YtVideo } from "@esg/yt-export/youtube";
import { Cms } from "./cms.js";
import {
  addedReport,
  applySubmission,
  escapeMarkdown,
  parseIssueForm,
  parsePresenters,
  parseSubmission,
  rejectedReport,
  SubmissionError,
  youtubeVideoId,
  type Submission,
} from "./submission.js";
import { content, counterIds, data, playlist, presenter, video } from "./testContent.js";

/** An issue body as GitHub renders the submit-video form. */
const issueBody = (fields: { url?: string; presenters?: string; event?: string; notes?: string }) =>
  [
    `### YouTube URL\n\n${fields.url ?? "_No response_"}`,
    `### Presenters\n\n${fields.presenters ?? "_No response_"}`,
    `### Event or group\n\n${fields.event ?? "_No response_"}`,
    `### Anything else\n\n${fields.notes ?? "_No response_"}`,
  ].join("\n\n");

const yt = (over: Partial<YtVideo["snippet"]> = {}, privacyStatus: YtVideo["status"]["privacyStatus"] = "public"): YtVideo => ({
  id: "dQw4w9WgXcQ",
  snippet: {
    title: "Rust in production",
    description: "Slides: https://example.com/slides",
    publishedAt: "2024-05-01T10:00:00Z",
    channelId: "UCx",
    channelTitle: "Some Channel",
    thumbnails: {
      default: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg" },
      medium: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" },
      high: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
      maxres: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    },
    ...over,
  },
  status: { privacyStatus },
});

const submission = (over: Partial<Submission> = {}): Submission => ({ videoId: "dQw4w9WgXcQ", presenters: [], event: null, notes: null, ...over });

const community = () =>
  content({ playlist: [playlist("4"), playlist("8", { playlistId: null, slug: "community-contributed", playlistTitle: "Community Contributed" })] });

describe("parseIssueForm", () => {
  it("reads each heading's value, with GitHub's empty marker as empty", () => {
    const fields = parseIssueForm("### YouTube URL\r\n\r\nhttps://youtu.be/x\r\n\r\n### Presenters\n\n_No response_\n\n### Anything else\n\nLine 1\n\nLine 2\n");
    expect([...fields]).toEqual([
      ["YouTube URL", "https://youtu.be/x"],
      ["Presenters", ""],
      ["Anything else", "Line 1\n\nLine 2"],
    ]);
  });
});

describe("youtubeVideoId", () => {
  it("finds the ID in every kind of YouTube link", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      " dQw4w9WgXcQ ",
    ]) {
      expect(youtubeVideoId(link), link).toBe("dQw4w9WgXcQ");
    }
  });

  it("returns null for anything else", () => {
    for (const link of [
      "https://vimeo.com/123456",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/@engineerssg",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/short",
      "not a link",
    ]) {
      expect(youtubeVideoId(link), link).toBeNull();
    }
  });
});

describe("parsePresenters", () => {
  it("reads a name per line with links after each |, skipping blanks, bullets and repeats", () => {
    expect(parsePresenters("- Jane  Doe | @janedoe | https://www.linkedin.com/in/janedoe\n\n2. John Tan\njane doe")).toEqual([
      { name: "Jane Doe", links: ["@janedoe", "https://www.linkedin.com/in/janedoe"] },
      { name: "John Tan", links: [] },
    ]);
  });

  it("rejects a line that doesn't start with a name", () => {
    expect(() => parsePresenters("@janedoe")).toThrow(SubmissionError);
    expect(() => parsePresenters("https://x.com/janedoe | Jane")).toThrow(/start with the presenter's name/);
    expect(() => parsePresenters("| @janedoe")).toThrow(SubmissionError);
  });

  it("limits the number of presenters", () => {
    expect(() => parsePresenters(Array.from({ length: 11 }, (_, i) => `Person ${i}`).join("\n"))).toThrow(/at most 10/);
  });
});

describe("parseSubmission", () => {
  it("reads the form", () => {
    expect(parseSubmission(issueBody({ url: "https://youtu.be/dQw4w9WgXcQ", presenters: "Jane Doe", event: "PyCon SG", notes: "Great talk" }))).toEqual({
      videoId: "dQw4w9WgXcQ",
      presenters: [{ name: "Jane Doe", links: [] }],
      event: "PyCon SG",
      notes: "Great talk",
    });
  });

  it("needs a YouTube video link", () => {
    expect(() => parseSubmission(issueBody({}))).toThrow(/field is empty/);
    expect(() => parseSubmission(issueBody({ url: "https://vimeo.com/1" }))).toThrow(/isn't a link to a YouTube video/);
  });
});

describe("applySubmission", () => {
  it("adds the video, links existing presenters, creates new ones and adds it to the community playlist", () => {
    const cms = new Cms(community(), { randomId: counterIds() });
    const result = applySubmission(
      cms,
      submission({
        presenters: [
          { name: "jane DOE", links: ["@ignored"] },
          { name: "Bob Lee", links: ["@boblee", "boblee.dev", "@second", "nonsense"] },
        ],
      }),
      yt(),
    );

    expect(result.video).toMatchObject({ id: "yt-dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", slug: "rust-in-production", presenters: ["7", "new1"] });
    expect(result.video.thumbnailHigh).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(result.presenters.map(({ name, created, unused, links }) => ({ name, created, unused, links }))).toEqual([
      { name: "jane DOE", created: false, unused: ["@ignored"], links: [] },
      {
        name: "Bob Lee",
        created: true,
        unused: ["@second", "nonsense"],
        links: [
          { type: "x", url: "https://x.com/boblee" },
          { type: "website", url: "https://boblee.dev" },
        ],
      },
    ]);

    expect(cms.changes().map((c) => `${c.kind} ${c.path}`)).toEqual([
      "create video/yt-dQw4w9WgXcQ.md",
      "create presenter/new1.md",
      "update playlist/8.md",
    ]);
    expect(data(cms, "presenter/new1.md").data).toMatchObject({ presenterName: "Bob Lee", slug: "bob-lee" });
    expect(data(cms, "playlist/8.md").data.videos).toEqual(["yt-dQw4w9WgXcQ"]);
    expect(data(cms, "video/yt-dQw4w9WgXcQ.md").body).toBe("Slides: https://example.com/slides");
  });

  it("links the best of several presenters with the name and reports the others", () => {
    const c = community();
    const twins = new Cms({
      ...c,
      presenter: [presenter("7", "Jane Doe"), presenter("8", "Jane Doe")],
      video: [video("1", "2020-01-01T00:00:00Z", { presenters: ["8"] })],
    });
    const result = applySubmission(twins, submission({ presenters: [{ name: "Jane Doe", links: [] }] }), yt());
    expect(result.presenters[0].presenter.id).toBe("8");
    expect(result.presenters[0].otherMatches.map((p) => p.id)).toEqual(["7"]);
  });

  it("rejects a video that is already there, missing or not public, and writes nothing", () => {
    const shown = new Cms(community());
    expect(() => applySubmission(shown, submission({ videoId: "yt2" }), yt())).toThrow("This video is already on Engineers.SG: https://engineers.sg/video/video-2");

    const c = community();
    const hidden = new Cms({ ...c, video: [video("2", "2021-01-01T00:00:00Z", { active: false })] });
    expect(() => applySubmission(hidden, submission({ videoId: "yt2" }), yt())).toThrow(/hidden from the site/);

    const cms = new Cms(community());
    expect(() => applySubmission(cms, submission(), undefined)).toThrow(/no public video/);
    expect(() => applySubmission(cms, submission(), yt({}, "unlisted"))).toThrow("The video is unlisted on YouTube. Only public videos can be added.");
    expect(cms.changes()).toEqual([]);
  });
});

describe("escapeMarkdown", () => {
  it("shows Markdown and HTML as written, and stops mentions", () => {
    expect(escapeMarkdown("**Hi** <img src=x> @team [x](javascript:1)\nnext")).toBe(
      "\\*\\*Hi\\*\\* &lt;img src=x&gt; &#64;team \\[x\\]\\(javascript:1\\) next",
    );
  });
});

describe("reports", () => {
  it("describes what was added, for the pull request", () => {
    const cms = new Cms(community(), { randomId: counterIds() });
    const sub = submission({
      presenters: [
        { name: "Jane Doe", links: [] },
        { name: "Bob Lee", links: ["@boblee"] },
      ],
      event: "PyCon SG 2024",
      notes: "Great talk by @someone\n<b>really</b>",
    });
    const report = addedReport(applySubmission(cms, sub, yt({ title: "Rust *in* production" })), sub, 42);
    expect(report).toContain("Adds the video submitted in #42.");
    expect(report).toContain("**[Rust \\*in\\* production](https://www.youtube.com/watch?v=dQw4w9WgXcQ)**");
    expect(report).toContain("Published 2024-05-01 by the YouTube channel Some Channel.");
    expect(report).toContain("- Video yt-dQw4w9WgXcQ: `/video/rust-in-production`");
    expect(report).toContain("- Added to the playlist Community Contributed (`/playlist/community-contributed`)");
    expect(report).toContain("- **Jane Doe**: existing presenter 7, `/presenter/jane-doe`");
    expect(report).toContain("- **Bob Lee**: new presenter new1, `/presenter/bob-lee`, with links: x `https://x.com/boblee`");
    expect(report).toContain("Event or group: PyCon SG 2024.");
    expect(report).toContain("> Great talk by &#64;someone\n> &lt;b&gt;really&lt;/b&gt;");
    expect(report.trimEnd().endsWith("Closes #42")).toBe(true);
  });

  it("explains a rejection to the submitter", () => {
    expect(rejectedReport("The video is private on YouTube.")).toContain("> The video is private on YouTube.");
  });
});
