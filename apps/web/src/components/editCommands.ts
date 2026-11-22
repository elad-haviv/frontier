import type { EditorView } from "@codemirror/view";

/**
 * Text commands shared by the toolbar's buttons and the editor's keys, so Ctrl+B and the Bold
 * button do exactly the same thing.
 */

/** Wraps the selection in a mark, or places the cursor between the two halves of the mark. */
export function wrap(view: EditorView, before: string, after: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

/** Puts a mark at the start of the current line, or removes it when it is already there. */
export function linePrefix(view: EditorView, mark: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const has = line.text.startsWith(mark);
  view.dispatch({
    changes: has
      ? { from: line.from, to: line.from + mark.length, insert: "" }
      : { from: line.from, insert: mark },
  });
  view.focus();
}

/** `wrap` as a CodeMirror command, for a keymap. */
export const wrapCommand =
  (before: string, after: string) =>
  (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    wrap(view, before, after);
    return true;
  };
