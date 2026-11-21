import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SCHEMA,
  makeEntryId,
  parseSchema,
  readFields,
  SchemaError,
  setTime,
  setType,
  typeFromFolder,
} from "../src/index.js";

const note = `---
aliases: [The White City]
# a comment the author wrote
id: k3f9x2ab
type: settlement
time:
  - what: founded
    when: "c. 340 EM"
  - what: destroyed
    when: "after [[The Nirani Exodus]], within a generation"
    note: disputed
cssclass: wide
---
# Vel Aran

Body.
`;

describe("readFields", () => {
  it("reads id, type and time", () => {
    expect(readFields(note)).toEqual({
      id: "k3f9x2ab",
      type: "settlement",
      time: [
        { what: "founded", when: "c. 340 EM" },
        {
          what: "destroyed",
          when: "after [[The Nirani Exodus]], within a generation",
          extra: { note: "disputed" },
        },
      ],
      problems: [],
    });
  });

  it("gives empty fields for a note without frontmatter", () => {
    expect(readFields("# Plain\n")).toEqual({ id: null, type: null, time: [], problems: [] });
  });

  it("keeps a bare number as text", () => {
    expect(readFields("---\ntime:\n  - what: founded\n    when: 340\n---\n").time).toEqual([
      { what: "founded", when: "340" },
    ]);
  });

  it("lists what it cannot read and keeps the rest", () => {
    const f = readFields(
      "---\nid: TOO-LONG-ID\ntype: [a]\ntime:\n  - when: x\n  - what: born\n  - what: died\n    when: late\n---\n",
    );
    expect(f.id).toBeNull();
    expect(f.type).toBeNull();
    expect(f.time).toEqual([{ what: "died", when: "late" }]);
    expect(f.problems).toHaveLength(4);
    expect(readFields("---\ntime: soon\n---\n").problems).toEqual(["`time` is not a list."]);
    expect(readFields("---\n: : :\n  bad\n---\n").problems).toEqual([
      "The properties block cannot be read.",
    ]);
  });
});

describe("writing fields", () => {
  it("adds a time item and changes no other line", () => {
    const before = readFields(note).time;
    const next = setTime(note, [...before, { what: "changed", when: "in the reign of [[Mira]]" }]);
    expect(readFields(next).time).toHaveLength(3);
    expect(next).toContain('    when: "c. 340 EM"\n');
    expect(next).toContain('    when: "in the reign of [[Mira]]"\n');
    expect(next).toContain("    note: disputed\n");
    const kept = (t: string) => t.split("\n").filter((l) => !/^\s|^time:/.test(l));
    expect(kept(next)).toEqual(kept(note));
    expect(next).toContain("# a comment the author wrote");
    expect(next.endsWith("# Vel Aran\n\nBody.\n")).toBe(true);
  });

  it("removes the key when the list is empty, and adds a block to a plain note", () => {
    expect(setTime(note, [])).not.toContain("time:");
    const made = setTime("# Plain\n", [{ what: "born", when: "long ago" }]);
    expect(made.startsWith("---\ntime:\n")).toBe(true);
    expect(readFields(made).time).toEqual([{ what: "born", when: "long ago" }]);
  });

  it("keeps Windows line endings", () => {
    const crlf = note.replace(/\n/g, "\r\n");
    const next = setTime(crlf, [{ what: "founded", when: "early" }]);
    expect(next.includes("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(next)).toBe(false);
  });

  it("sets and removes the type", () => {
    expect(readFields(setType(note, "place")).type).toBe("place");
    expect(setType(note, null)).not.toContain("type:");
  });
});

describe("schema", () => {
  it("takes the type from the longest matching folder, ignoring case", () => {
    const schema = parseSchema(
      "version: 1\ntypes:\n  place: { folders: ['03 Gaz'] }\n  city: { folders: ['03 Gaz/Cities'] }\nwhat:\n  founded: { begins: true }\n",
    );
    expect(typeFromFolder(schema, "03 gaz/Cities/Vel Aran.md")).toBe("city");
    expect(typeFromFolder(schema, "03 Gaz/Ezob.md")).toBe("place");
    expect(typeFromFolder(schema, "03 Gazetteer/Ezob.md")).toBeNull();
    expect(schema.what).toEqual({ founded: { begins: true } });
  });

  it("has a built-in schema that reads", () => {
    expect(typeFromFolder(BUILT_IN_SCHEMA, "04 Inhabitants/Archdemons/Agolel.md")).toBe("deity");
    expect(BUILT_IN_SCHEMA.what["died"]).toEqual({ ends: true });
  });

  it("refuses a schema that is not in the expected form", () => {
    for (const bad of [
      "[]",
      "types: {}",
      "version: 1",
      "version: 1\nwhat: {}\ntypes: []",
      "version: 1\nwhat: {}\ntypes:\n  a: { folders: x }",
      "a: [",
    ]) {
      expect(() => parseSchema(bad)).toThrow(SchemaError);
    }
  });
});

it("makes entry ids of 8 lower-case letters and digits", () => {
  let n = 0;
  const id = makeEntryId((bytes) => Uint8Array.from({ length: bytes }, () => (n += 37) % 256));
  expect(id).toMatch(/^[a-z0-9]{8}$/);
});
