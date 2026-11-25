import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WeekResponse } from "@frontier/schema";
import { agesFrom } from "../src/keepGoing/history.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const NOW = new Date("2026-03-15T12:00:00Z");
const BODY = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

function commitOn(date: string, changes: Record<string, string | null>) {
  process.env["GIT_AUTHOR_DATE"] = date;
  process.env["GIT_COMMITTER_DATE"] = date;
  try {
    t.repo.pushFromOutside(changes, `Change on ${date}`);
  } finally {
    delete process.env["GIT_AUTHOR_DATE"];
    delete process.env["GIT_COMMITTER_DATE"];
  }
}

beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
  (t.services.keepGoingHistory as unknown as { d: { now: () => Date } }).d.now = () => NOW;
  commitOn("2025-03-15T12:00:00Z", {
    "50 Dated/Linker.md": `# Linker\n\n${BODY} [[Mover]] [[Edited]]\n`,
    "50 Dated/Mover.md": `# Mover\n\n${BODY}\n`,
    "50 Dated/Edited.md": `# Edited\n\n${BODY}\n`,
  });
  // Mover only changes its name and folder; Edited changes a word as well.
  commitOn("2026-03-13T12:00:00Z", {
    "50 Dated/Mover.md": null,
    "51 Moved/Mover.md": `# Mover\n\n${BODY}\n`,
  });
  commitOn("2026-03-14T12:00:00Z", {
    "50 Dated/Edited.md": null,
    "51 Moved/Edited.md": `# Edited\n\n${BODY} extra\n`,
  });
  await t.services.sync();
});

describe("history after a rename", () => {
  it("does not count a renamed entry as written, filled or touched when only its name changed", async () => {
    const res = await t.get("/api/keep-going/week?tz=0");
    const { week } = WeekResponse.parse(res.json());
    // Only the entry that was edited as well as moved was worked on; nothing new was written.
    expect(week.entriesTouched).toBe(1);
    expect(week.linksFilled).toBe(0);
    expect(week.days.at(-2)!.entries).toBe(1);
    expect(week.days.at(-3)!.entries).toBe(0);
  });

  it("carries an entry's age across the rename", async () => {
    const { onThisDay } = WeekResponse.parse((await t.get("/api/keep-going/week?tz=0")).json());
    const year = onThisDay.filter((r) => r.span === "year");
    expect(year.map((r) => [r.kind, r.path])).toEqual([
      ["written", "51 Moved/Edited.md"],
      ["written", "50 Dated/Linker.md"],
      ["written", "51 Moved/Mover.md"],
    ]);
  });

  it("keeps the untouched age of an entry that was only moved", async () => {
    const old = await t.services.keepGoingHistory.untouched();
    expect(old.has("51 Moved/Mover.md")).toBe(true);
    expect(old.has("50 Dated/Linker.md")).toBe(true);
    // Edited was changed as well, a day ago.
    expect(old.has("51 Moved/Edited.md")).toBe(false);
  });

  it("reads a log cut short as not knowing when an entry began", async () => {
    const history = t.services.keepGoingHistory as unknown as { d: { logLimit?: number } };
    history.d.logLimit = 1;
    const ages = await t.services.keepGoingHistory.agesOfEntries();
    // The one commit left is the move of Edited: it was not added in it.
    expect(ages.changed.has("51 Moved/Edited.md")).toBe(true);
    expect(ages.created.has("51 Moved/Edited.md")).toBe(false);
  });
});

describe("ages from a log", () => {
  const log = [
    {
      commit: "c",
      at: "2026-03-01T00:00:00Z",
      changes: [
        { status: "R" as const, path: "New.md", from: "Old.md", edited: true },
        { status: "M" as const, path: "Plain.md" },
        { status: "A" as const, path: "Fresh.md" },
      ],
    },
    {
      commit: "b",
      at: "2026-02-01T00:00:00Z",
      changes: [{ status: "R" as const, path: "Old.md", from: "Older.md", edited: false }],
    },
    {
      commit: "a",
      at: "2026-01-01T00:00:00Z",
      changes: [
        { status: "A" as const, path: "Older.md" },
        { status: "M" as const, path: "Plain.md" },
      ],
    },
  ];

  it("follows a file back through its renames", () => {
    const ages = agesFrom(log);
    expect(ages.created.get("New.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(ages.changed.get("New.md")).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(ages.created.has("Old.md")).toBe(false);
    expect(ages.created.has("Older.md")).toBe(false);
  });

  it("does not take a move for a change", () => {
    const moved = agesFrom([
      {
        commit: "b",
        at: "2026-02-01T00:00:00Z",
        changes: [{ status: "R" as const, path: "B.md", from: "A.md", edited: false }],
      },
      {
        commit: "a",
        at: "2026-01-01T00:00:00Z",
        changes: [{ status: "A" as const, path: "A.md" }],
      },
    ]);
    expect(moved.changed.get("B.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("leaves out of `created` a file the cut-off log did not see added", () => {
    const ages = agesFrom(log, true);
    expect(ages.created.has("Plain.md")).toBe(false);
    expect(ages.created.get("Fresh.md")).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(ages.created.get("New.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(ages.changed.get("Plain.md")).toBe(Date.parse("2026-03-01T00:00:00Z"));
    // Not cut off: a file first seen in the log is as old as its first sight.
    expect(agesFrom(log).created.get("Plain.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("does not give a file's earlier life to a new one at the same name", () => {
    const ages = agesFrom([
      {
        commit: "c",
        at: "2026-03-01T00:00:00Z",
        changes: [{ status: "A" as const, path: "X.md" }],
      },
      {
        commit: "b",
        at: "2026-02-01T00:00:00Z",
        changes: [{ status: "R" as const, path: "Y.md", from: "X.md", edited: true }],
      },
      {
        commit: "a",
        at: "2026-01-01T00:00:00Z",
        changes: [{ status: "A" as const, path: "X.md" }],
      },
    ]);
    expect(ages.created.get("X.md")).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(ages.created.get("Y.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
});
