import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

const links = (text: string) => linkify(text).filter((p) => p.href).map((p) => p.href);

describe("linkify", () => {
  it("splits text into plain parts and links, and loses nothing", () => {
    const text = "Event Page: https://www.meetup.com/singa-js/events/1/\nProduced by Engineers.SG";
    const parts = linkify(text);
    expect(parts).toEqual([
      { text: "Event Page: " },
      { text: "https://www.meetup.com/singa-js/events/1/", href: "https://www.meetup.com/singa-js/events/1/" },
      { text: "\nProduced by Engineers.SG" },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });

  it("leaves text without URLs alone", () => {
    expect(linkify("Speaker: Jane Doe")).toEqual([{ text: "Speaker: Jane Doe" }]);
    expect(linkify("")).toEqual([]);
  });

  it("keeps the punctuation after a URL out of the link", () => {
    expect(links("See http://a.sg/x.")).toEqual(["http://a.sg/x"]);
    expect(links("Rack (http://rack.github.io) is popular, https://b.sg/y; and http://c.sg?")).toEqual([
      "http://rack.github.io",
      "https://b.sg/y",
      "http://c.sg",
    ]);
    expect(links("(www.ppi.io),")).toEqual(["https://www.ppi.io"]);
  });

  it("keeps brackets that belong to the URL", () => {
    expect(links("https://en.wikipedia.org/wiki/Rack_(web_server)")).toEqual(["https://en.wikipedia.org/wiki/Rack_(web_server)"]);
    expect(links("(https://en.wikipedia.org/wiki/Rack_(web_server))")).toEqual(["https://en.wikipedia.org/wiki/Rack_(web_server)"]);
  });

  it("links www addresses with https and keeps the text as written", () => {
    expect(linkify("at www.foodmatch.org.")).toEqual([
      { text: "at " },
      { text: "www.foodmatch.org", href: "https://www.foodmatch.org" },
      { text: "." },
    ]);
  });

  it("finds several links on one line, and keeps query strings", () => {
    expect(links("a http://x.sg/?a=1&b=2 b https://y.sg/#z")).toEqual(["http://x.sg/?a=1&b=2", "https://y.sg/#z"]);
  });

  it("does not link bare domains, other schemes or hosts without a dot", () => {
    expect(links("tiny.tt/asm mailto:a@b.sg javascript:alert(1) http://localhost/x")).toEqual([]);
  });
});
