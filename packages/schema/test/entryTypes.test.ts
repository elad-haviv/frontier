import { describe, expect, it } from "vitest";
import {
  givenProps,
  isChattable,
  LIBRARY_FILES,
  mergeTypes,
  parseTypes,
  renameDateIn,
  renameTypeIn,
  serialiseTypes,
  TYPES,
  type TypesFile,
  typeNamed,
  typesFromNames,
} from "../src/index.js";

const file: TypesFile = {
  version: 1,
  types: [
    {
      name: "person",
      props: [
        { key: "species", kind: "link", to: "people" },
        { key: "rank", kind: "choice", options: ["low", "high"], value: "low" },
        { key: "chattable", kind: "checkbox", value: true },
      ],
      dates: ["born", "died"],
    },
    { name: "people", props: [], dates: [] },
  ],
  what: [{ name: "born", begins: true }, { name: "died", ends: true }, { name: "happened" }],
};

describe("the types file", () => {
  it("is a library file, written one type to a line and read back the same", () => {
    expect(LIBRARY_FILES.some((k) => k.name === "types")).toBe(true);
    expect(TYPES.path).toBe(".frontier/types.json");
    const text = serialiseTypes(file);
    expect(text.split("\n").filter((l) => l.includes('"name":"person"'))).toHaveLength(1);
    const read = parseTypes(text);
    expect(read).toEqual({ ok: true, file });
    expect(serialiseTypes((read as { file: TypesFile }).file)).toBe(text);
  });

  it("starts from the schema's names, with a person and a deity chattable", () => {
    const made = typesFromNames(["place", "person", "deity"], [{ name: "born", begins: true }]);
    expect(made.types.map((t) => [t.name, t.props.map((p) => p.key)])).toEqual([
      ["place", []],
      ["person", ["chattable"]],
      ["deity", ["chattable"]],
    ]);
    expect(made.what).toEqual([{ name: "born", begins: true }]);
    expect(TYPES.schema.safeParse(made).success).toBe(true);
  });

  it("refuses names it cannot keep apart, and a property with a field of its own", () => {
    const bad = (change: (f: TypesFile) => TypesFile) =>
      TYPES.schema.safeParse(change(structuredClone(file))).success;
    expect(
      bad((f) => ({ ...f, types: [...f.types, { name: "Person", props: [], dates: [] }] })),
    ).toBe(false);
    expect(bad((f) => ({ ...f, types: [{ name: "two words", props: [], dates: [] }] }))).toBe(
      false,
    );
    expect(
      bad((f) => ({
        ...f,
        types: [{ name: "x", props: [{ key: "Type", kind: "text" }], dates: [] }],
      })),
    ).toBe(false);
    expect(
      bad((f) => ({
        ...f,
        types: [
          {
            name: "x",
            props: [
              { key: "a", kind: "text" },
              { key: "A", kind: "text" },
            ],
            dates: [],
          },
        ],
      })),
    ).toBe(false);
    expect(bad((f) => ({ ...f, what: [...f.what, { name: "born" }] }))).toBe(false);
    expect(
      bad((f) => ({
        ...f,
        types: [{ name: "x", props: [{ key: "chattable", kind: "text" }], dates: [] }],
      })),
    ).toBe(false);
  });

  it("merges two people's changes to different types, and names a type both changed", () => {
    const mine = structuredClone(file);
    mine.types[1]!.dates = ["happened"];
    const theirs = structuredClone(file);
    theirs.types[0]!.dates = ["born"];
    const merged = mergeTypes(file, mine, theirs);
    expect(merged.clashes).toEqual([]);
    expect(merged.file.types.map((t) => t.dates)).toEqual([["born"], ["happened"]]);
    const both = structuredClone(file);
    both.types[0]!.dates = [];
    expect(mergeTypes(file, both, theirs).clashes).toEqual(["person"]);
  });
});

describe("what a type gives an entry", () => {
  const person = typeNamed(file, "Person");

  it("finds a type whatever the letter case, and none for no name", () => {
    expect(person?.name).toBe("person");
    expect(typeNamed(file, null)).toBeUndefined();
    expect(typeNamed(file, "ship")).toBeUndefined();
  });

  it("lets the entry's own word decide whether it can be talked with, or else its type's", () => {
    expect(isChattable(person, {})).toBe(true);
    expect(isChattable(person, null)).toBe(true);
    expect(isChattable(person, { chattable: false })).toBe(false);
    expect(isChattable(person, { Chattable: false })).toBe(false);
    expect(isChattable(typeNamed(file, "people"), {})).toBe(false);
    expect(isChattable(undefined, { chattable: true })).toBe(true);
    // A word that is not yes or no is no word.
    expect(isChattable(person, { chattable: "maybe" })).toBe(true);
  });

  it("gives each property the entry's value, or the type's where the entry has none", () => {
    const given = givenProps(person, { species: "[[Tideborn]]", rank: "", chattable: false });
    expect(given.map((g) => [g.prop.key, g.value, g.fromType])).toEqual([
      ["species", "[[Tideborn]]", false],
      ["rank", "low", true],
      ["chattable", false, false],
    ]);
    expect(givenProps(person, {}).map((g) => g.value)).toEqual([undefined, "low", true]);
    expect(givenProps(undefined, { a: 1 })).toEqual([]);
  });
});

describe("renaming in the types file", () => {
  it("renames a type and the links of other types that point at it", () => {
    const next = renameTypeIn(file, "people", "race");
    expect(next.types.map((t) => t.name)).toEqual(["person", "race"]);
    expect(next.types[0]!.props[0]!.to).toBe("race");
  });

  it("renames a date name in the list and in each type's usual dates", () => {
    const next = renameDateIn(file, "born", "hatched");
    expect(next.what.map((w) => w.name)).toEqual(["hatched", "died", "happened"]);
    expect(next.what[0]!.begins).toBe(true);
    expect(next.types[0]!.dates).toEqual(["hatched", "died"]);
  });
});
