import { describe, expect, it } from "vitest";
import { folderTypeOf } from "../../components/Properties.tsx";
import { givenValue, typeNameProblem, withKind, wordProblem } from "./Types.tsx";

describe("names on the types page", () => {
  it("takes one word for a type, once", () => {
    expect(typeNameProblem("vessel", ["place"])).toBeNull();
    expect(typeNameProblem("", [])).toBe("Give it a name.");
    expect(typeNameProblem("two words", [])).toBe("One word, without spaces.");
    expect(typeNameProblem("a/b", [])).toBe("One word, without spaces.");
    expect(typeNameProblem("Place", ["place"])).toBe("“Place” is already on the list.");
  });

  it("takes any words for a property or a date, but not a name with a field of its own", () => {
    expect(wordProblem("home port", ["captain"])).toBeNull();
    expect(wordProblem("Tags", [])).toBe("“Tags” has a field of its own.");
    expect(wordProblem("Captain", ["captain"])).toBe("“Captain” is already on the list.");
    expect(wordProblem("", [])).toBe("Give it a name.");
  });
});

describe("a property of a type", () => {
  it("drops what belonged to its old kind when the kind changes", () => {
    const link = { key: "home", kind: "link" as const, to: "place", value: "x" };
    expect(withKind(link, "text")).toEqual({ key: "home", kind: "text" });
    expect(withKind(link, "choice")).toEqual({ key: "home", kind: "choice", options: [] });
  });

  it("reads the value a type gives by the property's kind", () => {
    expect(givenValue({ key: "n", kind: "number" }, " 12.5 ")).toBe(12.5);
    expect(givenValue({ key: "n", kind: "number" }, "many")).toBeUndefined();
    expect(givenValue({ key: "l", kind: "list" }, "a, b,, c")).toEqual(["a", "b", "c"]);
    expect(givenValue({ key: "t", kind: "text" }, "  Harbor ")).toBe("Harbor");
    expect(givenValue({ key: "t", kind: "text" }, "   ")).toBeUndefined();
  });
});

describe("the type a folder gives", () => {
  const file = {
    version: 1 as const,
    folders: [
      { path: "04 Inhabitants", type: "creature" },
      { path: "04 Inhabitants/Notable Individuals", type: "person" },
      { path: "05 Society" },
    ],
  };
  it("is that of the nearest folder above the entry that has one", () => {
    expect(folderTypeOf(file, "04 Inhabitants/Notable Individuals/Mira.md")).toBe("person");
    expect(folderTypeOf(file, "04 inhabitants/Beasts/Eel.md")).toBe("creature");
    expect(folderTypeOf(file, "05 Society/Guild.md")).toBeNull();
    expect(folderTypeOf(file, "04 Inhabitants.md")).toBeNull();
    expect(folderTypeOf(null, "a/b.md")).toBeNull();
  });
});
