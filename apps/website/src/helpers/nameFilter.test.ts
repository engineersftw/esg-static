import { describe, expect, it } from "vitest";
import { filterByName, type NameEntry } from "./nameFilter";

const entry = (name: string): NameEntry => ({ name, slug: name.toLowerCase().replace(/ /g, "-"), image: null });
const names = (entries: NameEntry[]) => entries.map((e) => e.name);

describe("filterByName", () => {
  const all = ["Aaron Tan", "Chen Hui Jing", "Ong Chin Hwee", "Tan Wei Ming", "Zoë Tan"].map(entry);

  it("matches every word anywhere in the name, ignoring case and accents", () => {
    expect(names(filterByName(all, "TAN"))).toEqual(["Tan Wei Ming", "Aaron Tan", "Zoë Tan"]);
    expect(names(filterByName(all, "zoe"))).toEqual(["Zoë Tan"]);
    expect(names(filterByName(all, "hui chen"))).toEqual(["Chen Hui Jing"]);
    expect(names(filterByName(all, "chin"))).toEqual(["Ong Chin Hwee"]);
  });

  it("puts names that start with the first word first, otherwise keeping the list order", () => {
    expect(names(filterByName(all, "tan"))[0]).toBe("Tan Wei Ming");
  });

  it("returns nothing for a blank query or no match", () => {
    expect(filterByName(all, "  ")).toEqual([]);
    expect(filterByName(all, "xyz")).toEqual([]);
  });
});
