import { describe, expect, it } from "vitest";
import { createSearch, PAGE_SIZE, queryTerms, type SearchEntry } from "./search";

const video = (slug: string, over: Partial<SearchEntry> = {}): SearchEntry => ({
  slug,
  title: slug,
  date: "2024-01-01T00:00:00Z",
  thumbnail: null,
  presenters: [],
  organizations: [],
  playlists: [],
  description: "",
  ...over,
});

const slugs = (search: ReturnType<typeof createSearch>, query: string) => search(query).results.map((r) => r.slug);

describe("queryTerms", () => {
  it("normalizes case and accents, and drops repeats and surrounding punctuation", () => {
    expect(queryTerms("  Café, KUBERNETES kubernetes! (Go)  ")).toEqual(["cafe", "kubernetes", "go"]);
  });

  it("keeps C++ and C#, and ignores one-letter words unless they are all there is", () => {
    expect(queryTerms("c++ a c#")).toEqual(["c++", "c#"]);
    expect(queryTerms("intro to R")).toEqual(["intro", "to"]);
    expect(queryTerms("R")).toEqual(["r"]);
  });

  it("returns nothing for a blank query", () => {
    expect(queryTerms("  ,.  ")).toEqual([]);
  });
});

describe("createSearch", () => {
  const search = createSearch([
    video("rust-intro", { title: "An intro to Rust", description: "Ownership and borrowing" }),
    video("go-k8s", { title: "Running Go on Kubernetes", presenters: ["Jane Tan"], organizations: ["Singapore Gophers"] }),
    video("trust", { title: "Building trust in teams" }),
    video("cafe", { title: "Notes", description: "Recorded at a café in Tanjong Pagar" }),
    video("gophers-talk", { title: "Talk", organizations: ["Singapore Gophers"], playlists: ["GopherCon 2019"] }),
  ]);

  it("requires every word to match somewhere", () => {
    expect(slugs(search, "kubernetes jane")).toEqual(["go-k8s"]);
    expect(slugs(search, "kubernetes rust")).toEqual([]);
  });

  it("searches presenters, organizations, playlists and descriptions", () => {
    expect(slugs(search, "jane")).toEqual(["go-k8s"]);
    expect(slugs(search, "gopher")).toEqual(["go-k8s", "gophers-talk"]);
    expect(slugs(search, "gophercon")).toEqual(["gophers-talk"]);
    expect(slugs(search, "borrowing")).toEqual(["rust-intro"]);
  });

  it("ignores case and accents", () => {
    expect(slugs(search, "CAFE")).toEqual(["cafe"]);
    expect(slugs(search, "tanjong pagar")).toEqual(["cafe"]);
  });

  it("ranks a match at the start of a word above one inside a word", () => {
    expect(slugs(search, "rust")).toEqual(["rust-intro", "trust"]);
  });

  it("ranks title matches above description matches", () => {
    const s = createSearch([
      video("in-description", { title: "Something else", description: "We talk about Docker." }),
      video("in-title", { title: "Docker in production" }),
    ]);
    expect(slugs(s, "docker")).toEqual(["in-title", "in-description"]);
  });

  it("gives a bonus when the whole query is in the title", () => {
    const s = createSearch([
      video("apart", { title: "Machine vision and learning" }),
      video("phrase", { title: "Learning machine learning" }),
    ]);
    expect(slugs(s, "machine learning")).toEqual(["phrase", "apart"]);
  });

  it("keeps the index order for equal scores", () => {
    const s = createSearch([video("newer", { title: "Go tips" }), video("older", { title: "Go tips" })]);
    expect(slugs(s, "go")).toEqual(["newer", "older"]);
  });

  it("leaves the searched-only fields out of the results", () => {
    expect(search("borrowing").results[0]).toEqual({
      slug: "rust-intro",
      title: "An intro to Rust",
      date: "2024-01-01T00:00:00Z",
      thumbnail: null,
      presenters: [],
      organizations: [],
    });
  });

  it("pages the results and clamps the page number", () => {
    const many = createSearch(Array.from({ length: PAGE_SIZE + 5 }, (_, i) => video(`v${i}`, { title: "Same title" })));
    expect(many("same").results).toHaveLength(PAGE_SIZE);
    expect(many("same", 2)).toMatchObject({ total: PAGE_SIZE + 5, page: 2, pageSize: PAGE_SIZE });
    expect(many("same", 2).results.map((r) => r.slug)[0]).toBe(`v${PAGE_SIZE}`);
    expect(many("same", 99).page).toBe(2);
    expect(many("same", Number.NaN).page).toBe(1);
  });

  it("returns no results for an empty query", () => {
    expect(search("  ")).toEqual({ query: "", total: 0, page: 1, pageSize: PAGE_SIZE, results: [] });
  });
});
