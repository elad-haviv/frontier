// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { resetKeysForTests } from "./aiKeys.ts";
import { forgetRun, runFolder, runLeft } from "./folderRun.ts";
import { setCurrentProject } from "./project.ts";

// Every test runs in one project: its calls go to `/api/p/avalymia/...`.
setCurrentProject({ id: "avalymia01", slug: "avalymia" });

const start = { folder: "01 Places", total: 3, done: 0, made: 0, failed: [] };

beforeEach(() => {
  localStorage.clear();
  resetKeysForTests();
});

class Coded extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

describe("a run over a folder, driven from the browser", () => {
  it("asks for one entry at a time, reports progress and each failure, and keeps nothing once done", async () => {
    const seen: string[] = [];
    const progress: number[] = [];
    const end = await runFolder(
      start,
      ["a.md", "b.md", "c.md"],
      async (path) => {
        seen.push(path);
        if (path === "b.md") throw new Error("Not a note.");
        return { made: 2 };
      },
      new AbortController().signal,
      (p) => progress.push(p.done),
    );
    expect(end).toEqual({ state: "done" });
    expect(seen).toEqual(["a.md", "b.md", "c.md"]);
    expect(progress).toEqual([1, 2, 3]);
    expect(runLeft()).toBeNull();
  });

  it("stops when the key goes missing or is turned away, as for a model that is off, and keeps the rest", async () => {
    for (const code of ["ai_key_missing", "ai_key_rejected", "ai_off"]) {
      forgetRun();
      const asked: string[] = [];
      const end = await runFolder(
        start,
        ["a.md", "b.md", "c.md"],
        async (path) => {
          asked.push(path);
          if (path === "b.md") throw new Coded(code, "Nothing to call.");
          return { made: 1 };
        },
        new AbortController().signal,
        () => undefined,
      );
      expect(end).toEqual({ state: "stopped", why: "Nothing to call." });
      expect(asked).toEqual(["a.md", "b.md"]);
      expect(runLeft()).toMatchObject({ remaining: ["b.md", "c.md"], done: 1, made: 1 });
    }
  });

  it("stops between two entries when the page is left, and can carry on from what was left", async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const end = await runFolder(
      start,
      ["a.md", "b.md", "c.md"],
      async (path) => {
        asked.push(path);
        // The page is left while the first entry is being read.
        controller.abort();
        return { made: 1 };
      },
      controller.signal,
      () => undefined,
    );
    expect(end).toEqual({ state: "cancelled" });
    // No further call is made after the page is gone: nothing is left running with a key.
    expect(asked).toEqual(["a.md"]);
    const left = runLeft()!;
    expect(left).toMatchObject({
      folder: "01 Places",
      remaining: ["b.md", "c.md"],
      done: 1,
      made: 1,
    });

    const more: string[] = [];
    const resumed = await runFolder(
      left,
      left.remaining,
      async (path) => {
        more.push(path);
        return { made: 1 };
      },
      new AbortController().signal,
      () => undefined,
    );
    expect(resumed).toEqual({ state: "done" });
    expect(more).toEqual(["b.md", "c.md"]);
    expect(runLeft()).toBeNull();
  });
});
