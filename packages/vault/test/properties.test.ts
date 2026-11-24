import { describe, expect, it } from "vitest";
import {
  checkPropertyName,
  customProperties,
  FrontmatterError,
  linkOf,
  propertyKind,
  propertyText,
  propertyValue,
  readFrontmatter,
  removeFrontmatterKey,
  renameFrontmatterKey,
  setFrontmatterKey,
} from "../src/index.js";

const NOTE = `---
id: ab12cd34
type: place
aliases: [Greywater]
# how many live there
population: 1200
founded: 2026-03-01
walled: true
rulers:
  - Mira
  - Oren
capital: "[[Harbor]]"
motto: Salt and stone
shape: { a: 1 }
---
# Harbor
`;

describe("custom properties", () => {
  it("reads the author's own keys with their kinds, leaving out the ones with fields", () => {
    expect(customProperties(NOTE)).toEqual([
      { key: "population", kind: "number", value: 1200 },
      { key: "founded", kind: "date", value: "2026-03-01" },
      { key: "walled", kind: "checkbox", value: true },
      { key: "rulers", kind: "list", value: ["Mira", "Oren"] },
      { key: "capital", kind: "link", value: "[[Harbor]]" },
      { key: "motto", kind: "text", value: "Salt and stone" },
      { key: "shape", kind: "other", value: { a: 1 } },
    ]);
  });

  it("gives none for a note without frontmatter, and null for one that cannot be read", () => {
    expect(customProperties("# Plain\n")).toEqual([]);
    expect(customProperties("---\na: [\n---\n")).toBeNull();
  });

  it("reads a YAML 1.1 timestamp as a date", () => {
    // `yaml` reads dates as strings, but a Date can still arrive from other readers.
    expect(propertyKind(new Date("2026-03-01"))).toBe("date");
  });

  it("tells the kind of every value", () => {
    expect(propertyKind(null)).toBe("text");
    expect(propertyKind(undefined)).toBe("text");
    expect(propertyKind(Number.NaN)).toBe("other");
    expect(propertyKind([])).toBe("list");
    expect(propertyKind([1, "a"])).toBe("list");
    expect(propertyKind([{}])).toBe("other");
  });

  it("turns what was typed into the value to write", () => {
    expect(propertyValue("text", "Salt")).toBe("Salt");
    expect(propertyValue("text", "  ")).toBeNull();
    expect(propertyValue("number", "3.5")).toBe(3.5);
    expect(propertyValue("number", "")).toBeNull();
    expect(() => propertyValue("number", "many")).toThrow("Write a number");
    expect(propertyValue("date", "2026-03-01")).toBe("2026-03-01");
    expect(propertyValue("date", "")).toBeNull();
    expect(() => propertyValue("date", "March")).toThrow("year-month-day");
    expect(propertyValue("checkbox", true)).toBe(true);
    expect(propertyValue("checkbox", "true")).toBe(true);
    expect(propertyValue("checkbox", false)).toBe(false);
    expect(propertyValue("list", "a, b,, c ")).toEqual(["a", "b", "c"]);
    expect(propertyValue("list", ["x", " "])).toEqual(["x"]);
    expect(propertyValue("link", "Harbor")).toBe("[[Harbor]]");
    expect(propertyValue("link", "[[Harbor]]")).toBe("[[Harbor]]");
    expect(propertyValue("link", "")).toBeNull();
  });

  it("shows a value as text for a field", () => {
    expect(propertyText(null)).toBe("");
    expect(propertyText(["a", "b"])).toBe("a, b");
    expect(propertyText("[[Harbor]]")).toBe("Harbor");
    expect(propertyText(12)).toBe("12");
    expect(linkOf("Harbor")).toBeNull();
    expect(linkOf(3)).toBeNull();
  });

  it("checks a new name", () => {
    expect(checkPropertyName(" Ruler ", ["motto"])).toEqual({ ok: true, name: "Ruler" });
    expect(checkPropertyName(" ", [])).toMatchObject({ ok: false, problem: /a name/ });
    expect(checkPropertyName("a\nb", [])).toMatchObject({ ok: false, problem: /one line/ });
    expect(checkPropertyName("x".repeat(101), [])).toMatchObject({ ok: false });
    expect(checkPropertyName("Tags", [])).toMatchObject({ ok: false, problem: /of its own/ });
    expect(checkPropertyName("Motto", ["motto"])).toMatchObject({
      ok: false,
      problem: /already/,
    });
  });
});

describe("writing properties", () => {
  it("writes an empty value as the key alone, as Obsidian does", () => {
    const text = setFrontmatterKey("# A\n", "ruler", null);
    expect(text).toBe("---\nruler:\n---\n# A\n");
    expect(customProperties(text)).toEqual([{ key: "ruler", kind: "text", value: null }]);
  });

  it("writes each kind so it reads back the same", () => {
    let text = "---\ntype: place\n---\nBody\n";
    for (const [key, value] of [
      ["founded", "2026-03-01"],
      ["walled", false],
      ["population", 12],
      ["rulers", ["Mira"]],
      ["capital", "[[Harbor]]"],
    ] as const) {
      text = setFrontmatterKey(text, key, value);
    }
    expect(customProperties(text)!.map((p) => p.kind)).toEqual([
      "date",
      "checkbox",
      "number",
      "list",
      "link",
    ]);
    expect(text).toContain("founded: 2026-03-01\n");
    expect(text).toContain('capital: "[[Harbor]]"\n');
    expect(removeFrontmatterKey(text, "rulers")).not.toContain("rulers");
  });

  it("renames a key in place, keeping its value, comments and the other lines", () => {
    const text = renameFrontmatterKey(NOTE, "population", "people");
    expect(text).toBe(NOTE.replace("population: 1200", "people: 1200"));
    const keys = Object.keys(readFrontmatter(text).data!);
    expect(keys.indexOf("people")).toBe(keys.indexOf("aliases") + 1);
    // A name that needs quotes is quoted.
    expect(renameFrontmatterKey(NOTE, "motto", "motto: old")).toContain(
      '"motto: old": Salt and stone',
    );
    // The value of a list stays as written.
    expect(renameFrontmatterKey(NOTE, "rulers", "lords")).toContain("lords:\n  - Mira\n  - Oren");
  });

  it("keeps Windows line endings when renaming", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    expect(renameFrontmatterKey(crlf, "motto", "saying")).toBe(
      crlf.replace("motto: Salt", "saying: Salt"),
    );
  });

  it("changes nothing for a missing key, the same name, or a note without frontmatter", () => {
    expect(renameFrontmatterKey(NOTE, "nothing", "x")).toBe(NOTE);
    expect(renameFrontmatterKey(NOTE, "motto", "motto")).toBe(NOTE);
    expect(renameFrontmatterKey("# A\n", "a", "b")).toBe("# A\n");
  });

  it("refuses a name another key has, and a block that cannot be read", () => {
    expect(() => renameFrontmatterKey(NOTE, "motto", "walled")).toThrow(FrontmatterError);
    expect(() => renameFrontmatterKey("---\na: [\n---\n", "a", "b")).toThrow(FrontmatterError);
  });
});
