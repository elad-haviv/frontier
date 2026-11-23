import { describe, expect, it } from "vitest";
import { folderTypeOf, openOrCreate } from "./openOrCreate.ts";

const GULL = "02 People/Gull.md";
const index = ["02 People/Mira.md", "01 Places/Gull.md"];

describe("opening an entry with no connection", () => {
  it("opens a change not sent yet first, even where the index has an entry", () => {
    expect(
      openOrCreate({
        path: "02 People/Mira.md",
        hasRecord: true,
        indexPaths: index,
        creating: true,
      }),
    ).toBe("record");
  });

  it("then an entry in the index, whose text is not on this device", () => {
    expect(
      openOrCreate({
        path: "02 People/Mira.md",
        hasRecord: false,
        indexPaths: index,
        creating: true,
      }),
    ).toBe("not-on-device");
  });

  it("then a new entry; one of the same name in another folder does not stop it", () => {
    expect(openOrCreate({ path: GULL, hasRecord: false, indexPaths: index, creating: true })).toBe(
      "create",
    );
    expect(openOrCreate({ path: GULL, hasRecord: false, indexPaths: null, creating: true })).toBe(
      "create",
    );
  });

  it("is missing, as a 404, when no new entry was asked for", () => {
    expect(openOrCreate({ path: GULL, hasRecord: false, indexPaths: index, creating: false })).toBe(
      "missing",
    );
  });
});

describe("the type of a new entry's folder", () => {
  const file = {
    version: 1 as const,
    folders: [{ path: "02 People", type: "person" }, { path: "02 People/Crew" }, { path: "03" }],
  };

  it("is the folder's own, or the nearest above it", () => {
    expect(folderTypeOf("02 People/Gull.md", file)).toBe("person");
    expect(folderTypeOf("02 People/Crew/Gull.md", file)).toBe("person");
    expect(folderTypeOf("03/Gull.md", file)).toBeNull();
    expect(folderTypeOf("Gull.md", file)).toBeNull();
    expect(folderTypeOf("02 People/Gull.md", null)).toBeNull();
  });
});
