import { describe, expect, it } from "vitest";
import {
  aliasesOf,
  FrontmatterError,
  readFrontmatter,
  removeFrontmatterKey,
  setFrontmatterKey,
  splitFrontmatter,
} from "../src/index.js";
import { changedLines, fixture, fixtureFiles } from "./helpers.js";

const notes = fixtureFiles().filter((p) => p.endsWith(".md"));

describe("splitting", () => {
  it("returns the same bytes when joined, for every fixture note", () => {
    for (const path of notes) {
      const raw = fixture(path);
      const { frontmatter, body } = splitFrontmatter(raw);
      expect((frontmatter ?? "") + body, path).toBe(raw);
    }
  });

  it("finds a block only at the very start with a closing line", () => {
    expect(splitFrontmatter(fixture("03 Things/Plain.md")).frontmatter).toBeNull();
    expect(splitFrontmatter(fixture("03 Things/Unclosed.md")).frontmatter).toBeNull();
    expect(splitFrontmatter("text\n---\na: 1\n---\n").frontmatter).toBeNull();
    expect(splitFrontmatter(fixture("03 Things/Empty.md")).frontmatter).toBe("---\n---\n");
    expect(splitFrontmatter("---\na: 1\n---").frontmatter).toBe("---\na: 1\n---");
    expect(splitFrontmatter("---\na: 1\n").frontmatter).toBeNull();
    expect(splitFrontmatter("---\na: 1").frontmatter).toBeNull();
  });

  it("keeps Windows endings inside the block", () => {
    const { frontmatter } = splitFrontmatter(fixture("03 Things/Lantern.md"));
    expect(frontmatter).toBe("---\r\naliases:\r\n  - Lamp\r\n---\r\n");
  });
});

describe("reading", () => {
  it("reads keys and aliases", () => {
    expect(readFrontmatter(fixture("01 Places/Harbor/Harbor.md"))).toEqual({
      data: { aliases: ["The Port", "Greywater"] },
      error: null,
    });
    expect(aliasesOf(fixture("01 Places/Harbor/Harbor.md"))).toEqual(["The Port", "Greywater"]);
    expect(aliasesOf(fixture("03 Things/Lantern.md"))).toEqual(["Lamp"]);
    expect(aliasesOf("---\naliases: Solo\n---\n")).toEqual(["Solo"]);
    expect(aliasesOf("---\naliases: [a, 3, b]\n---\n")).toEqual(["a", "b"]);
    expect(aliasesOf("---\naliases: 3\n---\n")).toEqual([]);
    expect(aliasesOf(fixture("03 Things/Plain.md"))).toEqual([]);
  });

  it("reports a note without frontmatter and an empty block", () => {
    expect(readFrontmatter(fixture("03 Things/Plain.md"))).toEqual({ data: null, error: null });
    expect(readFrontmatter(fixture("03 Things/Empty.md"))).toEqual({ data: {}, error: null });
  });

  it("reports malformed frontmatter without throwing", () => {
    const broken = readFrontmatter(fixture("03 Things/Broken.md"));
    expect(broken.data).toBeNull();
    expect(broken.error).toBeTruthy();
    const scalar = readFrontmatter(fixture("03 Things/Scalar.md"));
    expect(scalar.data).toBeNull();
    expect(scalar.error).toMatch(/not a list of keys/);
  });
});

describe("setting one key", () => {
  it("changes only that key's lines and keeps comments, order and unknown keys", () => {
    const raw = fixture("03 Things/Ledger.md");
    const out = setFrontmatterKey(raw, "keeper", "Shade");
    expect(changedLines(raw, out)).toEqual({ removed: ["keeper: Mira"], added: ["keeper: Shade"] });
  });

  it("replaces a multi-line value and leaves the comment above the next key", () => {
    const raw = fixture("03 Things/Ledger.md");
    const out = setFrontmatterKey(raw, "custom", { nested: false });
    expect(changedLines(raw, out)).toEqual({
      removed: ["  nested: true", "  list:", "    - a", "    - b"],
      added: ["  nested: false"],
    });
    expect(out).toContain("\n\n# a trailing comment before the last key\nweight: 3\n");
  });

  it("replaces the last key", () => {
    const raw = fixture("03 Things/Ledger.md");
    const out = setFrontmatterKey(raw, "weight", 4);
    expect(changedLines(raw, out)).toEqual({ removed: ["weight: 3"], added: ["weight: 4"] });
  });

  it("adds a new key as the last line of the block", () => {
    const raw = fixture("03 Things/Ledger.md");
    const out = setFrontmatterKey(raw, "id", "k3f9x2ab");
    expect(changedLines(raw, out)).toEqual({ removed: [], added: ["id: k3f9x2ab"] });
    expect(readFrontmatter(out).data?.["id"]).toBe("k3f9x2ab");
  });

  it("adds a key to an empty block and to a block without a final line break", () => {
    expect(setFrontmatterKey("---\n---\nbody\n", "a", 1)).toBe("---\na: 1\n---\nbody\n");
    expect(setFrontmatterKey("---\nb: 2\n---", "a", 1)).toBe("---\nb: 2\na: 1\n---");
  });

  it("creates a block when the note has none", () => {
    expect(setFrontmatterKey("# Plain\n", "id", "x")).toBe("---\nid: x\n---\n# Plain\n");
    expect(setFrontmatterKey("# Plain\r\ntext\r\n", "id", "x")).toBe(
      "---\r\nid: x\r\n---\r\n# Plain\r\ntext\r\n",
    );
  });

  it("keeps Windows endings on every line", () => {
    const raw = fixture("03 Things/Lantern.md");
    const out = setFrontmatterKey(raw, "aliases", ["Lamp", "Light"]);
    expect(out.startsWith("---\r\naliases:\r\n  - Lamp\r\n  - Light\r\n---\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    const added = setFrontmatterKey(raw, "id", "x");
    expect(added.startsWith("---\r\naliases:\r\n  - Lamp\r\nid: x\r\n---\r\n")).toBe(true);
  });

  it("is undone by removing the key, for every fixture note it can parse", () => {
    for (const path of notes) {
      const raw = fixture(path);
      const { frontmatter } = splitFrontmatter(raw);
      if (frontmatter === null || readFrontmatter(raw).error !== null) continue;
      const out = setFrontmatterKey(raw, "zz_probe", "x");
      expect(changedLines(raw, out).removed, path).toEqual([]);
      expect(removeFrontmatterKey(out, "zz_probe"), path).toBe(raw);
    }
  });

  it("throws on a block it cannot parse", () => {
    expect(() => setFrontmatterKey(fixture("03 Things/Broken.md"), "a", 1)).toThrow(
      FrontmatterError,
    );
    expect(() => setFrontmatterKey(fixture("03 Things/Scalar.md"), "a", 1)).toThrow(
      /not a list of keys/,
    );
    expect(() => removeFrontmatterKey(fixture("03 Things/Broken.md"), "a")).toThrow(
      FrontmatterError,
    );
  });
});

describe("removing one key", () => {
  it("removes only that key's lines", () => {
    const raw = fixture("03 Things/Ledger.md");
    const out = removeFrontmatterKey(raw, "zeta");
    expect(changedLines(raw, out)).toEqual({ removed: ["zeta: last-first"], added: [] });
  });

  it("removes a key with Windows endings", () => {
    expect(removeFrontmatterKey(fixture("03 Things/Lantern.md"), "aliases")).toBe(
      "---\r\n---\r\n# Lantern\r\n\r\nCarried by [[Twin]] at the [[Harbor]].\r\n",
    );
  });

  it("changes nothing when the key or the block is missing", () => {
    const raw = fixture("03 Things/Ledger.md");
    expect(removeFrontmatterKey(raw, "absent")).toBe(raw);
    expect(removeFrontmatterKey("# Plain\n", "a")).toBe("# Plain\n");
    expect(removeFrontmatterKey("---\n---\nx\n", "a")).toBe("---\n---\nx\n");
  });
});
