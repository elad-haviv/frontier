import type { AfterPublishStep } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { Recents, RECENTS_KEY } from "./recents.ts";
import {
  arrivedByHistory,
  backlinksLine,
  entries,
  folderName,
  followPublish,
  publishedEntries,
  RULE_TAG,
  splitMention,
  stepWords,
} from "./strip.ts";

describe("the backlinks line", () => {
  const b = (n: number) => ({ path: `Places/E${n}.md`, title: `E${n}` });

  it("names the first three and counts the rest", () => {
    const line = backlinksLine([1, 2, 3, 4, 5].map(b));
    expect(line.named).toEqual(["E1", "E2", "E3"]);
    expect(line.more).toBe(2);
    expect(line.all).toHaveLength(5);
  });

  it("lists an entry once however many times it links", () => {
    const line = backlinksLine([b(1), b(1), b(2)]);
    expect(line.all.map((x) => x.title)).toEqual(["E1", "E2"]);
    expect(line.more).toBe(0);
  });

  it("is empty with no links", () => {
    expect(backlinksLine([])).toEqual({ all: [], named: [], more: 0 });
  });
});

describe("a mention in its sentence", () => {
  it("splits the sentence round the name", () => {
    expect(splitMention("It sails to Harbor today.", [12, 18])).toEqual([
      "It sails to ",
      "Harbor",
      " today.",
    ]);
  });

  it("keeps the whole sentence when the place is out of range", () => {
    expect(splitMention("Short.", [10, 20])).toEqual(["Short.", "", ""]);
    expect(splitMention("Short.", [4, 2])).toEqual(["Shor", "", "t."]);
  });
});

describe("the words of the strip", () => {
  it("has a short tag for each rule", () => {
    expect(Object.keys(RULE_TAG)).toHaveLength(6);
    expect(RULE_TAG.stub).toBe("stub");
  });

  it("names the folder an entry is in", () => {
    expect(folderName("01 Places/Harbor/Old Quay.md")).toBe("Harbor");
    expect(folderName("README.md")).toBe("the library");
  });

  it("counts entries", () => {
    expect(entries(1)).toBe("1 entry");
    expect(entries(9)).toBe("9 entries");
  });
});

describe("the next steps after Publish", () => {
  const from = { path: "A.md", title: "A" };

  it("says each in words", () => {
    const stub: AfterPublishStep = { kind: "stub", path: "S.md", title: "S", words: 38, from };
    expect(stepWords(stub)).toEqual({
      lead: "A links to ",
      name: "S",
      tail: ", which is still a stub of 38 words.",
    });
    const missing: AfterPublishStep = {
      kind: "missing",
      name: "The Salt Concord",
      mentions: 1,
      folder: null,
      from,
    };
    expect(stepWords(missing)).toEqual({
      lead: "",
      name: "The Salt Concord",
      tail: " is named in 1 entry and does not exist yet.",
    });
    expect(stepWords({ kind: "old", path: "O.md", title: "O" }).lead).toMatch(/6 months/);
    expect(stepWords({ ...stub, words: 1 }).tail).toContain("1 word.");
  });

  it("sends only entries to the server, once each", () => {
    expect(
      publishedEntries(["A.md", "A.md", "Images/a.png", ".frontier/pins.json", "B/C.MD"]),
    ).toEqual(["A.md", "B/C.MD"]);
  });
});

describe("what a publish does to the entries this device remembers", () => {
  const memory = () => {
    const data = new Map<string, string>();
    const recents = new Recents({
      storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
      now: () => 1_000,
      later: () => undefined,
    });
    for (const [path, title] of [
      ["Places/Old.md", "Old"],
      ["Places/Harbor/Quay.md", "Quay"],
      ["People/Mira.md", "Mira"],
    ] as const) {
      recents.viewed(path, title);
    }
    return { recents, data };
  };
  const paths = (r: Recents) => r.snapshot().recents.map((e) => e.path);

  it("follows an entry that was renamed, with its new name", () => {
    const { recents } = memory();
    followPublish(recents, {
      renames: [{ from: "Places/Old.md", to: "Places/New.md" }],
      deleted: [],
    });
    expect(recents.snapshot().recents.find((e) => e.path === "Places/New.md")?.title).toBe("New");
    expect(paths(recents)).not.toContain("Places/Old.md");
  });

  it("follows every entry of a folder that was renamed, keeping their names", () => {
    const { recents } = memory();
    followPublish(recents, {
      renames: [{ from: "Places/Harbor", to: "Places/Port" }],
      deleted: [],
    });
    expect(paths(recents)).toContain("Places/Port/Quay.md");
    expect(recents.snapshot().recents.find((e) => e.path === "Places/Port/Quay.md")?.title).toBe(
      "Quay",
    );
    expect(paths(recents)).toContain("Places/Old.md");
  });

  it("forgets an entry that was deleted, and keeps the others", () => {
    const { recents, data } = memory();
    followPublish(recents, { renames: [], deleted: ["People/Mira.md"] });
    expect(paths(recents)).toEqual(["Places/Harbor/Quay.md", "Places/Old.md"]);
    // It was the one open, so nothing is open now; the one before it is still the last.
    expect(recents.snapshot().current).toBeNull();
    expect(recents.snapshot().previous).toEqual({ path: "Places/Harbor/Quay.md", title: "Quay" });
    expect(data.get(RECENTS_KEY)).not.toContain("Mira");
  });
});

describe("arriving by the browser's history", () => {
  it("is a pop inside the app", () => {
    expect(arrivedByHistory("POP", "k1", "navigate")).toBe(true);
    expect(arrivedByHistory("PUSH", "k1", "back_forward")).toBe(false);
    expect(arrivedByHistory("REPLACE", "k2", undefined)).toBe(false);
  });

  it("is a load by the back button for the first page of a load", () => {
    expect(arrivedByHistory("POP", "default", "back_forward")).toBe(true);
    // The first page of any load is a pop to the router; a plain load or a reload is not history.
    expect(arrivedByHistory("POP", "default", "navigate")).toBe(false);
    expect(arrivedByHistory("POP", "default", "reload")).toBe(false);
    expect(arrivedByHistory("POP", "default", undefined)).toBe(false);
  });
});
