import type { KeyBinding } from "@codemirror/view";

const isRow = (text: string) => /^\s*\|.*\|\s*$/.test(text);

/**
 * In a Markdown table, Tab moves to the next cell and Shift+Tab to the one before.
 * Outside a table the keys do what they always do.
 */
export const tableKeys: KeyBinding[] = [
  {
    key: "Tab",
    run(view) {
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
    },
  },
  {
    key: "Shift-Tab",
    run(view) {
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
    },
  },
];
