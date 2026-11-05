import { describe, expect, it } from "vitest";
import { GROUP_OF_TOPIC, TOPICS, topicsFor, withTopics } from "./topics.js";

describe("the taxonomy", () => {
  it("has unique topic slugs and titles", () => {
    expect(new Set(TOPICS.map((t) => t.slug)).size).toBe(TOPICS.length);
    expect(new Set(TOPICS.map((t) => t.title)).size).toBe(TOPICS.length);
    expect(GROUP_OF_TOPIC.size).toBe(TOPICS.length);
  });
});

describe("topicsFor", () => {
  it("matches title and the start of the description, in taxonomy order", () => {
    expect(topicsFor("Intro to Docker", "with Python")).toEqual(["python", "containers-and-kubernetes"]);
  });
  it("ignores case and the far end of a long description", () => {
    expect(topicsFor("RUST talk")).toEqual(["rust"]);
    expect(topicsFor("Hello", `${"x".repeat(500)} python`)).toEqual([]);
  });
});

describe("withTopics", () => {
  it("puts topics after presenters, and removes them when empty", () => {
    const data = { id: "1", presenters: [], active: true };
    expect(Object.keys(withTopics(data, ["go"]))).toEqual(["id", "presenters", "topics", "active"]);
    expect(withTopics(withTopics(data, ["go"]), [])).toEqual(data);
  });
});
