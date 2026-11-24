/**
 * Adding and removing rows and columns of a Markdown table. Only the cells that change are
 * touched: every other character of every row stays as written, so nothing is padded or realigned.
 *
 * A table here is a run of lines that start and end with "|", whose second line is the separator
 * ("| --- | :-: |"). The first line is the header.
 */

/** A change to the table's text, in offsets into its lines joined with "\n". */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export type TableAction = "addRow" | "deleteRow" | "addColumn" | "deleteColumn";

export interface TableEdit {
  changes: TextChange[];
  /** Where the cursor goes afterwards, in offsets into the changed text. */
  cursor: number;
}

export const isRow = (text: string) => /^\s*\|.*\|\s*$/.test(text);
const isSeparator = (text: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(text);

/** The positions of the bars that divide a row into cells. A bar written "\|" is text. */
export function bars(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") out.push(i);
  }
  return out;
}

/**
 * The table around line `n` (counted from 1), read through `lineAt`, which answers null past
 * either end of the text. Answers null when line `n` is not in a table.
 */
export function findTable(
  lineAt: (n: number) => string | null,
  n: number,
): { start: number; lines: string[] } | null {
  const here = lineAt(n);
  if (here === null || !isRow(here)) return null;
  let start = n;
  for (let t = lineAt(start - 1); t !== null && isRow(t); t = lineAt(start - 1)) start--;
  const lines: string[] = [];
  for (let k = start, t = lineAt(k); t !== null && isRow(t); t = lineAt(++k)) lines.push(t);
  if (lines.length < 2 || !isSeparator(lines[1]!)) return null;
  return { start, lines };
}

/** The cell the offset `at` in `line` falls in, counted from 0. */
function cellAt(line: string, at: number): number {
  const b = bars(line);
  const before = b.filter((p) => p < at).length;
  return Math.max(0, Math.min(before - 1, b.length - 2));
}

/** Just inside cell `c` of a row: after its bar and the space that follows it. */
function insideCell(line: string, c: number): number {
  const b = bars(line);
  const bar = b[Math.min(c, b.length - 2)] ?? 0;
  return line[bar + 1] === " " ? bar + 2 : bar + 1;
}

/**
 * Applies `action` to the table `lines`, with the cursor in row `row` (counted from 0, the header
 * being 0 and the separator 1) at offset `at` in that row. Answers null when it cannot be done:
 * the header and separator are not deleted as rows, and the last column is not deleted.
 */
export function editTable(
  lines: string[],
  row: number,
  at: number,
  action: TableAction,
): TableEdit | null {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const line = lines[row]!;
  const col = cellAt(line, at);
  const columns = bars(lines[0]!).length - 1;

  if (action === "addRow") {
    // Below the separator at the earliest, so a new row is never made part of the header.
    const after = Math.max(row, 1);
    const indent = /^\s*/.exec(lines[after]!)![0];
    const added = indent + "|" + "  |".repeat(Math.max(columns, 1));
    const end = starts[after]! + lines[after]!.length;
    return {
      changes: [{ from: end, to: end, insert: "\n" + added }],
      cursor: end + 1 + indent.length + 2,
    };
  }

  if (action === "deleteRow") {
    if (row < 2) return null;
    const last = row === lines.length - 1;
    // The row and one line break: its own, or the one before it when it ends the table.
    const from = last ? starts[row]! - 1 : starts[row]!;
    const to = last ? starts[row]! + line.length : starts[row + 1]!;
    const next = last ? row - 1 : row + 1;
    const nextStart = last ? starts[next]! : starts[row]!;
    return {
      changes: [{ from, to, insert: "" }],
      cursor: nextStart + insideCell(lines[next]!, col),
    };
  }

  const changes: TextChange[] = [];
  let cursor = 0;

  if (action === "addColumn") {
    lines.forEach((text, r) => {
      const b = bars(text);
      // A row too short to have this cell is left alone; Markdown reads its missing cells as empty.
      if (b.length < col + 2) return;
      const at = starts[r]! + b[col + 1]! + 1;
      changes.push({ from: at, to: at, insert: r === 1 ? " --- |" : "  |" });
    });
    // The new cell follows the bar that closed the cursor's cell.
    const shift = changes
      .filter((c) => c.from < starts[row]!)
      .reduce((n, c) => n + c.insert.length, 0);
    cursor = starts[row]! + shift + bars(line)[col + 1]! + 2;
    return { changes, cursor };
  }

  // deleteColumn
  if (columns <= 1) return null;
  lines.forEach((text, r) => {
    const b = bars(text);
    if (b.length < col + 2) return;
    // From the cell's opening bar up to the next bar, which stays to close the cell before it.
    changes.push({ from: starts[r]! + b[col]!, to: starts[r]! + b[col + 1]!, insert: "" });
  });
  const removed = changes
    .filter((c) => c.from < starts[row]!)
    .reduce((n, c) => n + (c.to - c.from), 0);
  const b = bars(line);
  const after = b.length >= col + 2 ? line.slice(0, b[col]) + line.slice(b[col + 1]) : line;
  const target = Math.min(col, bars(after).length - 2);
  cursor = starts[row]! - removed + insideCell(after, Math.max(target, 0));
  return { changes, cursor };
}

/** Applies changes given in offsets into the original text. */
export function applyChanges(text: string, changes: TextChange[]): string {
  let out = "";
  let last = 0;
  for (const c of [...changes].sort((a, b) => a.from - b.from)) {
    out += text.slice(last, c.from) + c.insert;
    last = c.to;
  }
  return out + text.slice(last);
}
