import { describe, expect, it } from "vitest";
import {
  byText,
  joinNames,
  keptText,
  lastVersionText,
  othersByPath,
  othersNotice,
  readersOf,
  readingText,
  shownName,
  whenText,
} from "./model.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("names", () => {
  it("shows a name, and nothing for a blank one", () => {
    expect(shownName("Wren")).toBe("Wren");
    expect(shownName("  ")).toBeNull();
    expect(shownName(undefined)).toBeNull();
    expect(shownName(null)).toBeNull();
  });

  it("joins names as people say them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Wren"])).toBe("Wren");
    expect(joinNames(["Wren", "Rex"])).toBe("Wren and Rex");
    expect(joinNames(["Wren", "Rex", "Sam"])).toBe("Wren, Rex and Sam");
    expect(joinNames(["Wren", "Rex", "Sam", "Ada"])).toBe("Wren, Rex and 2 more");
    expect(joinNames(["Wren", "Rex", "Sam", "Ada", "Bo"])).toBe("Wren, Rex and 3 more");
    expect(joinNames(["Wren", ""])).toBe("Wren and Someone");
  });
});

describe("authors on versions", () => {
  it("says when, in words", () => {
    expect(whenText(ago(10), NOW)).toBe("just now");
    expect(whenText(ago(60), NOW)).toBe("1 minute ago");
    expect(whenText(ago(5 * 60), NOW)).toBe("5 minutes ago");
    expect(whenText(ago(3600), NOW)).toBe("1 hour ago");
    expect(whenText(ago(2 * 3600), NOW)).toBe("2 hours ago");
    expect(whenText(ago(30 * 3600), NOW)).toBe("yesterday");
    expect(whenText("not a date", NOW)).toBe("");
  });

  it("writes the last version of an entry with its author", () => {
    expect(lastVersionText({ at: ago(2 * 3600), by: { name: "Wren" } }, NOW)).toBe(
      "Last version by Wren, 2 hours ago",
    );
  });

  it("leaves out the author nobody knows, rather than a blank 'by'", () => {
    expect(lastVersionText({ at: ago(2 * 3600), by: { name: "" } }, NOW)).toBe(
      "Last version, 2 hours ago",
    );
    expect(lastVersionText({ at: ago(2 * 3600) }, NOW)).toBe("Last version, 2 hours ago");
    expect(lastVersionText(null, NOW)).toBeNull();
    expect(lastVersionText(undefined, NOW)).toBeNull();
  });

  it("writes 'by <name>' for a row of the history, and nothing when unknown", () => {
    expect(byText({ name: "Wren" })).toBe("by Wren");
    expect(byText({ name: "" })).toBe("");
    expect(byText(undefined)).toBe("");
  });
});

describe("the notice that others have unsaved changes", () => {
  const who = (name: string, seconds: number) => ({ name, since: ago(seconds) });

  it("is nothing when nobody does", () => {
    expect(othersNotice([], NOW)).toBeNull();
  });

  it("names one person and since when, and never anything of what they wrote", () => {
    const n = othersNotice([who("Wren", 2 * 3600)], NOW)!;
    expect(n.text).toBe("Wren has unsaved changes to this entry, since 2 hours ago.");
    expect(n.headline).toBe("Wren has unsaved changes to this entry");
  });

  it("joins several, with the time of the first of them", () => {
    const n = othersNotice([who("Wren", 3 * 3600), who("Rex", 600)], NOW)!;
    expect(n.text).toBe(
      "Wren and Rex have unsaved changes to this entry, the first since 3 hours ago.",
    );
    // The earliest, whichever comes first in the list.
    const swapped = othersNotice([who("Rex", 600), who("Wren", 3 * 3600)], NOW)!;
    expect(swapped.since).toBe("3 hours ago");
  });

  it("collapses many names", () => {
    const n = othersNotice(
      [who("A", 10), who("B", 20), who("C", 30), who("D", 40)].map((p) => ({
        ...p,
        since: ago(3600),
      })),
      NOW,
    )!;
    expect(n.names).toBe("A, B and 2 more");
    expect(n.verb).toBe("have");
  });
});

describe("who is reading", () => {
  it("says who is also here", () => {
    expect(readingText([])).toBe("");
    expect(readingText([{ name: "Wren" }])).toBe("Wren is also here");
    expect(readingText([{ name: "Wren" }, { name: "Rex" }])).toBe("Wren and Rex are also here");
  });

  it("takes the people reading one entry, once each", () => {
    const presence = [
      { id: "a", name: "Wren", path: "x.md", since: ago(5) },
      { id: "a", name: "Wren", path: "x.md", since: ago(5) },
      { id: "b", name: "Rex", path: "y.md", since: ago(5) },
    ];
    expect(readersOf(presence, "x.md")).toEqual([{ id: "a", name: "Wren" }]);
    expect(readersOf(undefined, "x.md")).toEqual([]);
  });

  it("makes the status's list of unsaved changes into a lookup by entry", () => {
    const list = [{ path: "x.md", people: [{ id: "a", name: "Wren", since: ago(5) }] }];
    expect(othersByPath(list).get("x.md")).toHaveLength(1);
    expect(othersByPath(undefined).size).toBe(0);
  });
});

describe("what a removal says about unsaved changes", () => {
  it("says how many are kept and for how long", () => {
    expect(keptText({ unsavedKept: 3, keptDays: 30 }, "their")).toBe(
      "3 unsaved changes are kept for 30 days, and come back if they rejoin in that time.",
    );
    expect(keptText({ unsavedKept: 1, keptDays: 30 }, "your")).toBe(
      "1 unsaved change is kept for 30 days, and come back if you rejoin in that time.",
    );
  });

  it("says nothing when none were left", () => {
    expect(keptText({ unsavedKept: 0, keptDays: 30 }, "their")).toBe("");
    expect(keptText(undefined, "their")).toBe("");
  });
});
