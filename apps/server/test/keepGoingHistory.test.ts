import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WeekResponse } from "@frontier/schema";
import { agesFrom, dayOf, monthsBefore } from "../src/keepGoing/history.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const NOW = new Date("2026-03-15T12:00:00Z");
const WORDS = (n: number) => Array(n).fill("stone").join(" ");

/** Makes a commit on the remote dated `date`, as an outside editor would have. */
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
  // The history works from "now"; the made-up library's own commit is dated later than it, as a
  // clock that is wrong would date one, and counts for nothing.
  (t.services.keepGoingHistory as unknown as { d: { now: () => Date } }).d.now = () => NOW;
  commitOn("2025-03-15T12:00:00Z", {
    "50 Dated/Year.md": `---\ntype: place\n---\n# Year\n\n${WORDS(10)} [[Filled]]\n`,
  });
  commitOn("2025-09-15T12:00:00Z", { "50 Dated/Half.md": `# Half\n\n${WORDS(10)}\n` });
  commitOn("2026-01-15T12:00:00Z", { "50 Dated/Month.md": `# Month\n\n${WORDS(10)}\n` });
  commitOn("2026-02-15T12:00:00Z", { "50 Dated/Month.md": `# Month\n\n${WORDS(20)}\n` });
  commitOn("2026-03-13T12:00:00Z", { "50 Dated/Filled.md": `# Filled\n\n${WORDS(30)}\n` });
  commitOn("2026-03-15T12:00:00Z", {
    "50 Dated/Half.md": `# Half\n\n${WORDS(22)}\n`,
    "README.md": "# Read me\n\nChanged.\n",
  });
  await t.services.sync();
});

const week = async (tz = 0) => {
  const res = await t.get(`/api/keep-going/week?tz=${tz}`);
  expect(res.statusCode, res.body).toBe(200);
  return WeekResponse.parse(res.json());
};

describe("this week", () => {
  it("counts entries touched, words added and links filled over the last 7 days", async () => {
    const { week: w } = await week();
    expect(w.entriesTouched).toBe(2);
    // Filled: "Filled" in its heading and 30 words; Half: 12 more words.
    expect(w.wordsAdded).toBe(31 + 12);
    // Filled was written, and Year, which is older, already linked to it.
    expect(w.linksFilled).toBe(1);
    expect(w.days.map((d) => d.date)).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    expect(w.days.map((d) => d.entries)).toEqual([0, 0, 0, 0, 1, 0, 1]);
    expect(w.days.map((d) => d.words)).toEqual([0, 0, 0, 0, 31, 0, 12]);
  });

  it("lays the days out in the reader's time zone", async () => {
    // Ten hours ahead: noon in London is 22:00 the same day, so the days stay as they are; twelve
    // hours ahead, the commits made at noon fall in the next day.
    expect((await week(600)).week.days.at(-1)!.date).toBe("2026-03-15");
    const far = (await week(720)).week;
    expect(far.days.at(-1)!.date).toBe("2026-03-16");
    expect(far.days.at(-1)!.entries).toBe(1);
  });

  it("is worked out once for each build of the index", async () => {
    const count = () => t.gitCommands.filter((c) => c[0] === "log").length;
    await week();
    const first = count();
    expect(first).toBeGreaterThan(0);
    await week();
    expect(count()).toBe(first);
    commitOn("2026-03-15T13:00:00Z", { "50 Dated/Filled.md": `# Filled\n\n${WORDS(40)}\n` });
    await t.services.sync();
    expect((await week()).week.wordsAdded).toBe(31 + 12 + 10);
    expect(count()).toBeGreaterThan(first);
  });

  it("does not remember a log it could not read", async () => {
    const git = t.services.git;
    const real = git.changeLog.bind(git);
    let fail = true;
    git.changeLog = async (o) => {
      if (fail) throw new Error("no log");
      return real(o);
    };
    expect((await t.get("/api/keep-going/week")).statusCode).toBe(500);
    fail = false;
    expect((await t.get("/api/keep-going/week?tz=0")).statusCode).toBe(200);
  });
});

describe("on this day", () => {
  it("lists entries written, or last changed, a month, six months and a year ago", async () => {
    const { onThisDay } = await week();
    expect(onThisDay).toEqual([
      {
        span: "month",
        date: "2026-02-15",
        kind: "changed",
        path: "50 Dated/Month.md",
        title: "Month",
      },
      {
        span: "sixMonths",
        date: "2025-09-15",
        kind: "written",
        path: "50 Dated/Half.md",
        title: "Half",
      },
      {
        span: "year",
        date: "2025-03-15",
        kind: "written",
        path: "50 Dated/Year.md",
        title: "Year",
      },
    ]);
  });

  it("leaves out entries that are gone, and caps each span", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 6; i++) many[`51 Many/M${i}.md`] = `# M${i}\n\nx\n`;
    commitOn("2025-03-15T15:00:00Z", { ...many, "50 Dated/Year.md": null });
    await t.services.sync();
    const year = (await week()).onThisDay.filter((r) => r.span === "year");
    expect(year.map((r) => r.title)).toEqual(["M0", "M1", "M2", "M3"]);
  });
});

describe("how long an entry has been left alone", () => {
  it("counts an entry untouched for six months as old", async () => {
    const old = await t.services.keepGoingHistory.untouched();
    // The made-up library's own files were all written after "now": none is old.
    expect(old.has("50 Dated/Year.md")).toBe(true);
    expect(old.has("50 Dated/Filled.md")).toBe(false);
    expect(old.has("50 Dated/Half.md")).toBe(false);
    expect(old.has("README.md")).toBe(false);
  });

  it("treats a log that cannot be read as no history", async () => {
    t.services.git.changeLog = async () => {
      throw new Error("no log");
    };
    commitOn("2026-03-15T14:00:00Z", { "50 Dated/Another.md": "# Another\n" });
    await t.services.sync();
    expect((await t.services.keepGoingHistory.untouched()).size).toBeGreaterThan(0);
  });
});

describe("dates", () => {
  it("names a day in a time zone", () => {
    expect(dayOf(Date.parse("2026-03-15T23:30:00Z"), 0)).toBe("2026-03-15");
    expect(dayOf(Date.parse("2026-03-15T23:30:00Z"), 120)).toBe("2026-03-16");
    expect(dayOf(Date.parse("2026-03-15T00:30:00Z"), -60)).toBe("2026-03-14");
  });

  it("goes back whole calendar months, ending the 31st at a month's end", () => {
    expect(monthsBefore("2026-03-15", 1)).toBe("2026-02-15");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2024-03-31", 1)).toBe("2024-02-29");
    expect(monthsBefore("2026-01-10", 1)).toBe("2025-12-10");
    expect(monthsBefore("2026-03-15", 12)).toBe("2025-03-15");
    expect(monthsBefore("2026-08-31", 6)).toBe("2026-02-28");
  });

  it("works out when files were written and last changed from a log, newest first", () => {
    const log = [
      {
        commit: "c",
        at: "2026-03-01T00:00:00Z",
        changes: [{ status: "M" as const, path: "A.md" }],
      },
      {
        commit: "b",
        at: "2026-02-01T00:00:00Z",
        changes: [
          { status: "D" as const, path: "Gone.md" },
          { status: "M" as const, path: "A.md" },
          { status: "M" as const, path: "Old.md" },
        ],
      },
      {
        commit: "a",
        at: "2026-01-01T00:00:00Z",
        changes: [
          { status: "A" as const, path: "A.md" },
          { status: "A" as const, path: "Gone.md" },
        ],
      },
    ];
    const ages = agesFrom(log);
    expect(ages.created.get("A.md")).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(ages.changed.get("A.md")).toBe(Date.parse("2026-03-01T00:00:00Z"));
    // Seen first when it was changed, so it is at least that old.
    expect(ages.created.get("Old.md")).toBe(Date.parse("2026-02-01T00:00:00Z"));
    expect(ages.changed.has("Gone.md")).toBe(true);
  });
});
