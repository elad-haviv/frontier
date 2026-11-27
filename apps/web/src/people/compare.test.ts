import { describe, expect, it } from "vitest";
import type { DraftCompareResponse, PublishPlan } from "@frontier/schema";
import {
  clashOfCompare,
  clashOfConflict,
  clashOfMerge,
  clockText,
  partialSaveText,
  savedItems,
  reasonOf,
  savedAgainText,
  savedByOtherText,
  startOfMerged,
  textFor,
  theirsTitle,
} from "./compare.ts";

type Conflict = PublishPlan["conflicts"][number];

const conflict = (over: Partial<Conflict> = {}): Conflict => ({
  draftId: "d1",
  path: "01 Places/Harbor.md",
  reason: "saved_by_other",
  mine: "my text",
  theirs: "their text",
  base: "base text",
  theirsBy: { id: "p1", name: "Wren" },
  theirsAt: "2026-11-27T14:02:00.000Z",
  theirsBlob: "blob1",
  ...over,
});

describe("the compare screen's data", () => {
  it("takes the plan's conflict, with who saved the other version", () => {
    const c = clashOfConflict(conflict({ mergedText: "merged" }));
    expect(c).toMatchObject({
      draftId: "d1",
      mine: "my text",
      theirs: "their text",
      theirsName: "Wren",
      theirsBlob: "blob1",
      mergedText: "merged",
    });
  });

  it("keeps 'no file' (a null blob) apart from 'not told' (undefined)", () => {
    expect(clashOfConflict(conflict({ theirsBlob: null })).theirsBlob).toBeNull();
    const old = conflict();
    delete old.theirsBlob;
    expect(clashOfConflict(old).theirsBlob).toBeUndefined();
  });

  it("takes a name that is blank as nobody known", () => {
    expect(clashOfConflict(conflict({ theirsBy: { id: null, name: " " } })).theirsName).toBeNull();
    expect(clashOfConflict(conflict({ theirsBy: null })).theirsName).toBeNull();
  });

  it("takes a merge to confirm as a clash with the merged text", () => {
    const c = clashOfMerge(
      {
        id: "m1",
        draftId: "d1",
        path: "x.md",
        mergedText: "both",
        mainText: "theirs",
        baseText: "base",
        theirsBy: { id: "p1", name: "Wren" },
        theirsBlob: "b",
      },
      "mine",
    );
    expect(c).toMatchObject({
      reason: "merge",
      mine: "mine",
      theirs: "theirs",
      mergedText: "both",
    });
  });

  it("reads a compare answer, and is nothing when nothing differs any more", () => {
    const answer = (over: Partial<DraftCompareResponse>): DraftCompareResponse => ({
      draftId: "d1",
      path: "x.md",
      outcome: "none",
      ...over,
    });
    expect(clashOfCompare(answer({ outcome: "none" }), "")).toBeNull();
    expect(clashOfCompare(answer({ outcome: "ready" }), "")).toBeNull();
    expect(clashOfCompare(answer({ outcome: "conflict", conflict: conflict() }), "")).toMatchObject(
      {
        reason: "saved_by_other",
      },
    );
  });
});

describe("what each choice sends", () => {
  const clash = clashOfConflict(conflict({ mergedText: "merged" }));

  it("sends the person's own text for 'keep mine'", () => {
    expect(textFor("mine", clash, "")).toBe("my text");
  });

  it("sends theirs for 'keep theirs', and nothing for a file that is gone", () => {
    expect(textFor("theirs", clash, "")).toBe("their text");
    expect(textFor("theirs", clashOfConflict(conflict({ theirs: null })), "")).toBe("");
  });

  it("sends the merged text as it stands in the editor", () => {
    expect(textFor("merged", clash, "merged and edited")).toBe("merged and edited");
  });

  it("starts the merged text from the merge, else from the person's own text", () => {
    expect(startOfMerged(clash)).toBe("merged");
    expect(startOfMerged(clashOfConflict(conflict()))).toBe("my text");
  });
});

describe("the words", () => {
  const NOON = new Date("2026-11-27T20:00:00");

  it("titles their text with who and when", () => {
    const at = new Date("2026-11-27T14:02:00");
    const clash = clashOfConflict(conflict({ theirsAt: at.toISOString() }));
    expect(theirsTitle(clash, NOON)).toBe(
      `Wren saved this at ${clockText(at.toISOString(), NOON)}`,
    );
    expect(clockText(at.toISOString(), NOON)).toMatch(/\d/);
    expect(theirsTitle(clashOfConflict(conflict({ theirsBy: null, theirsAt: null })), NOON)).toBe(
      "Someone saved this",
    );
  });

  it("says that someone saved a newer version, naming them", () => {
    expect(savedByOtherText({ theirsName: "Wren", theirsAt: null })).toBe(
      "Wren saved a newer version of this entry, while you were working on it. Compare the two and choose.",
    );
    expect(savedByOtherText({ theirsName: null, theirsAt: null })).toContain("Someone saved");
  });

  it("says that they saved again while the person compared", () => {
    expect(savedAgainText("Rex")).toContain("Rex saved again while you were comparing");
    expect(savedAgainText("Rex")).toContain("your text is still here");
    expect(savedAgainText(null)).toContain("Someone saved again");
  });

  it("says plainly which entries were saved and which need comparing", () => {
    expect(
      partialSaveText(
        ["01 Places/Harbor.md", "02 People/Mira.md"],
        [{ path: "03 Things/Rope.md" }],
        true,
      ),
    ).toBe(
      "2 entries saved (Harbor, Mira). 1 entry needs comparing, because someone saved a newer version first: Rope.",
    );
    expect(partialSaveText([], [{ path: "a.md" }, { path: "b.md" }], false)).toBe(
      "Nothing. 2 entries need comparing, because someone saved a newer version first: a, b.",
    );
  });

  it("counts what a save wrote and deleted, of any kind, minus what was left", () => {
    expect(
      savedItems(
        ["01 Places/Old.md", "05 Images/pic.png", "a/New.md", "a/New.md", "01 Places/Left.md"],
        ["01 Places/Left.md"],
      ),
    ).toEqual(["01 Places/Old.md", "05 Images/pic.png", "a/New.md"]);
    expect(partialSaveText(["05 Images/pic.png", "a/Old.md"], [{ path: "b.md" }], true)).toBe(
      "2 changes saved (pic.png, Old). 1 entry needs comparing, because someone saved a newer version first: b.",
    );
  });

  it("does not blame a newer version for a map clash", () => {
    const text = partialSaveText(
      ["a.md"],
      [{ path: ".frontier/maps/abcd1234.json", reason: "map_changed_on_both" }],
      true,
    );
    expect(text).toBe("1 entry saved (a). 1 change waits for you: a map.");
  });

  it("gives a reason for a newer version by someone else, and names who deleted an entry", () => {
    expect(reasonOf(conflict())).toContain("Wren saved a newer version of this entry");
    expect(reasonOf(conflict({ reason: "deleted_on_main" }))).toContain("Wren deleted this entry");
    expect(reasonOf(conflict({ reason: "deleted_on_main", theirsBy: null }))).toBe(
      "This entry was deleted from the library while you were working on it. Your text is kept here.",
    );
    expect(reasonOf(conflict({ reason: "created_on_main" }))).toContain(
      "Wren added an entry with this name",
    );
  });

  it("keeps the older reasons as they were", () => {
    expect(reasonOf(conflict({ reason: "overlap" }))).toBe(
      "You and someone else changed the same lines.",
    );
    expect(reasonOf({ reason: "unheard_of" })).toBeUndefined();
  });
});
