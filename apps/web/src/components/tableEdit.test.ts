import { describe, expect, it } from "vitest";
import { applyChanges, editTable, findTable, type TableAction } from "./tableEdit.ts";

/**
 * Runs an action on a text with the cursor marked "‸", and answers the text afterwards with the
 * new cursor marked the same way, or null when the action is refused.
 */
function run(marked: string, action: TableAction): string | null {
  const cursor = marked.indexOf("‸");
  const text = marked.replace("‸", "");
  const all = text.split("\n");
  let n = 0;
  for (let seen = 0; seen + all[n]!.length < cursor; n++) seen += all[n]!.length + 1;
  const table = findTable((k) => all[k - 1] ?? null, n + 1);
  if (!table) throw new Error("not in a table");
  const lineStart = all.slice(0, n).reduce((s, l) => s + l.length + 1, 0);
  const base = all.slice(0, table.start - 1).reduce((s, l) => s + l.length + 1, 0);
  const edit = editTable(table.lines, n + 1 - table.start, cursor - lineStart, action);
  if (!edit) return null;
  const shifted = edit.changes.map((c) => ({ ...c, from: c.from + base, to: c.to + base }));
  const out = applyChanges(text, shifted);
  return out.slice(0, base + edit.cursor) + "‸" + out.slice(base + edit.cursor);
}

const TABLE = [
  "Before.",
  "",
  "| Name | Age |",
  "| :--- | --: |",
  "| Ada | 3 |",
  "| Bo | 4 |",
  "",
  "After.",
];

describe("finding a table", () => {
  it("needs a separator as the second line", () => {
    const lines = ["| a | b |", "| c | d |"];
    expect(findTable((k) => lines[k - 1] ?? null, 1)).toBeNull();
    expect(findTable((k) => TABLE[k - 1] ?? null, 5)).toEqual({
      start: 3,
      lines: TABLE.slice(2, 6),
    });
    expect(findTable((k) => TABLE[k - 1] ?? null, 1)).toBeNull();
  });
});

describe("adding a row", () => {
  it("adds an empty row below the cursor's row with one cell per column", () => {
    expect(run("| a | b |\n| - | - |\n| 1‸ | 2 |\n| 3 | 4 |", "addRow")).toBe(
      "| a | b |\n| - | - |\n| 1 | 2 |\n| ‸ |  |\n| 3 | 4 |",
    );
  });
  it("adds it below the separator when the cursor is in the header", () => {
    expect(run("| a‸ | b |\n| - | - |", "addRow")).toBe("| a | b |\n| - | - |\n| ‸ |  |");
  });
  it("keeps the table's indent and leaves the text around it alone", () => {
    expect(run("x\n  | a |\n  | - |\n  | 1‸ |\ny", "addRow")).toBe(
      "x\n  | a |\n  | - |\n  | 1 |\n  | ‸ |\ny",
    );
  });
});

describe("deleting a row", () => {
  it("deletes the cursor's row only", () => {
    expect(run("| a | b |\n|---|:-:|\n| 1 | 2‸ |\n| 3 | 4 |\nend", "deleteRow")).toBe(
      "| a | b |\n|---|:-:|\n| 3 | ‸4 |\nend",
    );
  });
  it("deletes the last row of a table at the end of the text", () => {
    expect(run("| a |\n| - |\n| 1 |\n| 2‸ |", "deleteRow")).toBe("| a |\n| - |\n| ‸1 |");
  });
  it("never deletes the header or the separator", () => {
    expect(run("| a‸ |\n| - |\n| 1 |", "deleteRow")).toBeNull();
    expect(run("| a |\n| -‸ |\n| 1 |", "deleteRow")).toBeNull();
  });
});

describe("adding a column", () => {
  it("adds an empty cell to the right of the cursor's column in every row", () => {
    expect(run("| a | b |\n| :- | -: |\n| 1‸ | 2 |", "addColumn")).toBe(
      "| a |  | b |\n| :- | --- | -: |\n| 1 | ‸ | 2 |",
    );
  });
  it("adds after the last column, and leaves a row too short for it as written", () => {
    expect(run("| a | b‸ |\n| - | - |\n| 1 |", "addColumn")).toBe(
      "| a | b | ‸ |\n| - | - | --- |\n| 1 |",
    );
  });
  it("does not count an escaped bar as a cell's edge", () => {
    expect(run("| a \\| b‸ | c |\n| - | - |", "addColumn")).toBe(
      "| a \\| b | ‸ | c |\n| - | --- | - |",
    );
  });
});

describe("deleting a column", () => {
  it("deletes the cursor's column and keeps the alignment of the others", () => {
    expect(run("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2‸ | 3 |", "deleteColumn")).toBe(
      "| a | c |\n| :-- | --: |\n| 1 | ‸3 |",
    );
  });
  it("deletes the first and the last column", () => {
    expect(run("| a‸ | b |\n|:-|-:|\n| 1 | 2 |", "deleteColumn")).toBe("| ‸b |\n|-:|\n| 2 |");
    expect(run("| a | b‸ |\n|:-|-:|\n| 1 | 2 |", "deleteColumn")).toBe("| ‸a |\n|:-|\n| 1 |");
  });
  it("never deletes the only column", () => {
    expect(run("| a‸ |\n| - |", "deleteColumn")).toBeNull();
  });
  it("leaves the lines around the table byte for byte", () => {
    const marked = [...TABLE];
    marked[4] = "| Ada‸ | 3 |";
    const out = run(marked.join("\n"), "deleteColumn")!;
    expect(out.split("\n").slice(0, 2)).toEqual(TABLE.slice(0, 2));
    expect(out.split("\n").slice(6)).toEqual(TABLE.slice(6));
    expect(out).toContain("| --: |\n| ‸3 |\n| 4 |");
  });
});
