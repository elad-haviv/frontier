import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editTable, findTable, isRow, type TableAction } from "./tableEdit.ts";

/** The table the cursor is in, with the cursor's row in it, or null outside a table. */
function tableHere(state: EditorState) {
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const table = findTable(
    (n) => (n >= 1 && n <= state.doc.lines ? state.doc.line(n).text : null),
    line.number,
  );
  if (!table) return null;
  return { ...table, row: line.number - table.start, at: head - line.from };
}

/** Whether the cursor is in a Markdown table. Cheap enough to ask on every cursor move. */
export function inTable(state: EditorState): boolean {
  return tableHere(state) !== null;
}

/**
 * Adds or removes a row or column of the table the cursor is in. Answers false outside a table;
 * inside one it answers true even when nothing can be done, such as deleting the header row, so
 * the key does not fall through to what it means elsewhere.
 */
export function tableCommand(action: TableAction) {
  return (view: EditorView): boolean => {
    const table = tableHere(view.state);
    if (!table) return false;
    const edit = editTable(table.lines, table.row, table.at, action);
    if (!edit) return true;
    const base = view.state.doc.line(table.start).from;
    view.dispatch({
      changes: edit.changes.map((c) => ({
        from: base + c.from,
        to: base + c.to,
        insert: c.insert,
      })),
      selection: { anchor: base + edit.cursor },
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  };
}

/** In a table, moves to the next cell, or to the first cell of the row below. */
export function nextCell(view: EditorView): boolean {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  if (!isRow(line.text)) return false;
  const next = line.text.indexOf("|", head - line.from);
  const last = line.text.lastIndexOf("|");
  let target: number;
  if (next !== -1 && next < last) {
    target = line.from + next + 1;
  } else if (
    line.number < view.state.doc.lines &&
    isRow(view.state.doc.line(line.number + 1).text)
  ) {
    const below = view.state.doc.line(line.number + 1);
    target = below.from + below.text.indexOf("|") + 1;
  } else {
    return false;
  }
  // Step over the space after the bar, so typing starts inside the cell.
  if (view.state.sliceDoc(target, target + 1) === " ") target++;
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  return true;
}

/** In a table, moves to the cell before. */
export function previousCell(view: EditorView): boolean {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  if (!isRow(line.text)) return false;
  const before = line.text.slice(0, head - line.from);
  const cellStart = before.lastIndexOf("|");
  const previous = cellStart <= 0 ? -1 : before.lastIndexOf("|", cellStart - 1);
  if (previous === -1) return false;
  let target = line.from + previous + 1;
  if (view.state.sliceDoc(target, target + 1) === " ") target++;
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  return true;
}
