import { describe, expect, it } from "vitest";
import type { YtVideo } from "@esg/yt-export/youtube";
import { Cms } from "./cms.js";
import {
  addedReport,
  applySubmission,
  escapeMarkdown,
  groupOptionProblems,
  groupOptions,
  parseIssueForm,
  parsePresenters,
  parseSubmission,
  rejectedReport,
  SubmissionError,
  withGroupOptions,
  youtubeVideoId,
  type Submission,
} from "./submission.js";
import { content, counterIds, data, organization, playlist, presenter, video } from "./testContent.js";

/** An issue body as GitHub renders the submit-video form. */
const issueBody = (fields: { url?: string; presenters?: string; group?: string; notes?: string }) =>
  [
    `### YouTube URL\n\n${fields.url ?? "_No response_"}`,
    `### Presenters\n\n${fields.presenters ?? "_No response_"}`,
    `### Group\n\n${fields.group ?? "_No response_"}`,
    `### Others (not in list)\n\n${fields.notes ?? "_No response_"}`,
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

const submission = (over: Partial<Submission> = {}): Submission => ({ videoId: "dQw4w9WgXcQ", presenters: [], group: null, notes: null, ...over });

const community = () =>
  content({ playlist: [playlist("4"), playlist("8", { playlistId: null, slug: "community-contributed", playlistTitle: "Community Contributed" })] });

describe("parseIssueForm", () => {
  it("reads each heading's value, with GitHub's empty marker as empty", () => {
    const fields = parseIssueForm("### YouTube URL\r\n\r\nhttps://youtu.be/x\r\n\r\n### Presenters\n\n_No response_\n\n### Others (not in list)\n\nLine 1\n\nLine 2\n");
    expect([...fields]).toEqual([
      ["YouTube URL", "https://youtu.be/x"],
      ["Presenters", ""],
      ["Others (not in list)", "Line 1\n\nLine 2"],
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
    expect(parseSubmission(issueBody({ url: "https://youtu.be/dQw4w9WgXcQ", presenters: "Jane Doe", group: "PyCon SG", notes: "Great talk" }))).toEqual({
      videoId: "dQw4w9WgXcQ",
      presenters: [{ name: "Jane Doe", links: [] }],
      group: "PyCon SG",
      notes: "Great talk",
    });
  });

  it("needs a YouTube video link", () => {
    expect(() => parseSubmission(issueBody({}))).toThrow(/field is empty/);
    expect(() => parseSubmission(issueBody({ url: "https://vimeo.com/1" }))).toThrow(/isn't a link to a YouTube video/);
  });
});

describe("applySubmission", () => {
  it("stores the length YouTube reports for the submitted video", () => {
    const cms = new Cms(community(), { randomId: counterIds() });
    const video = { ...yt(), contentDetails: { duration: "PT12M5S" } };
    expect(applySubmission(cms, submission(), video).video).toMatchObject({ duration: "PT12M5S" });
  });

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

  it("links the organization named by the group, ignoring case, and reports it", () => {
    const cms = new Cms(community(), { randomId: counterIds() });
    const sub = submission({ group: "org 5" });
    const result = applySubmission(cms, sub, yt());
    expect(result.organization?.id).toBe("5");
    expect(result.video.organizations).toEqual(["5"]);
    expect(addedReport(result, sub)).toContain("Group: org 5. Linked to organization 5, `/organization/org-5`.");
  });

  it("links nothing for a group that is unknown, inactive or absent", () => {
    const c = community();
    const orgs = [...c.organization, organization("6", { orgTitle: "Gone", active: false })];
    for (const group of ["Nowhere", "Gone", null]) {
      const result = applySubmission(new Cms({ ...c, organization: orgs }), submission({ group }), yt());
      expect(result.organization).toBeNull();
      expect(result.video.organizations).toEqual([]);
    }
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

describe("withGroupOptions", () => {
  const form = ["body:", "  - type: dropdown", "    id: group", "    attributes:", "      options:", '        - "Old"', '        - "Older"', "    validations:", "      required: false", ""].join("\n");

  it("replaces the options and keeps the rest", () => {
    expect(withGroupOptions(form, ["A & B", 'Say "hi"'])).toBe(
      ["body:", "  - type: dropdown", "    id: group", "    attributes:", "      options:", '        - "A & B"', '        - "Say \\"hi\\""', "    validations:", "      required: false", ""].join("\n"),
    );
  });

  it("reads the options back, and reports what is out of step", () => {
    expect(groupOptions(form)).toEqual(["Old", "Older"]);
    expect(groupOptionProblems(form, ["Old", "Older"])).toEqual([]);
    expect(groupOptionProblems(form, ["Older", "Old"])).toEqual(["submission form: Group options are not sorted by name"]);
    expect(groupOptionProblems(form, ["Old", "New"], "submit-playlist.yml")[0]).toBe('submit-playlist.yml: Group options lack "New"');
    expect(groupOptionProblems(form, ["Old", "New"])).toEqual([
      'submission form: Group options lack "New"',
      'submission form: Group options list "Older", which is not an active organization',
    ]);
  });

  it("is a no-op for the same names, and fails without a group dropdown", () => {
    expect(withGroupOptions(form, ["Old", "Older"])).toBe(form);
    expect(() => withGroupOptions("body: []\n", ["A"])).toThrow("no \"group\" dropdown");
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
      group: "PyCon SG 2024",
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
    expect(report).toContain("Group: PyCon SG 2024.");
    expect(report).toContain("> Great talk by &#64;someone\n> &lt;b&gt;really&lt;/b&gt;");
    expect(report.trimEnd().endsWith("Closes #42")).toBe(true);
  });

  it("explains a rejection to the submitter", () => {
    expect(rejectedReport("The video is private on YouTube.")).toContain("> The video is private on YouTube.");
  });
});
