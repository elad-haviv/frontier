import { startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

type Ref = { current: EditorView | null };

/** Wraps the selection in a mark, or places the cursor between the two halves of the mark. */
function wrap(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

/** Puts a mark at the start of the current line, or removes it when it is already there. */
function linePrefix(view: EditorView, mark: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const has = line.text.startsWith(mark);
  view.dispatch({
    changes: has
      ? { from: line.from, to: line.from + mark.length, insert: "" }
      : { from: line.from, insert: mark },
  });
  view.focus();
}

/**
 * Buttons for the marks that are slow to reach on a phone keyboard. They sit at the bottom of the
 * screen, above the keyboard when it is open.
 */
export function EditToolbar({ view }: { view: Ref }) {
  const act = (fn: (v: EditorView) => void) => () => {
    if (view.current) fn(view.current);
  };
  // Buttons must not take the focus from the editor, or the phone keyboard closes.
  const keep = (e: React.PointerEvent) => e.preventDefault();

  return (
    <div className="edit-toolbar" role="toolbar" aria-label="Formatting">
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Link to an entry"
        onClick={act((v) => {
          wrap(v, "[[", "]]");
          startCompletion(v);
        })}
      >
        [[ ]]
      </button>
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Heading"
        onClick={act((v) => linePrefix(v, "## "))}
      >
        H
      </button>
      <button
        type="button"
        onPointerDown={keep}
        aria-label="List item"
        onClick={act((v) => linePrefix(v, "- "))}
      >
        •
      </button>
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Bold"
        onClick={act((v) => wrap(v, "**", "**"))}
      >
        <b>B</b>
      </button>
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Italic"
        onClick={act((v) => wrap(v, "*", "*"))}
      >
        <i>I</i>
      </button>
      <span className="edit-toolbar-gap" />
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Undo"
        onClick={act((v) => void undo(v))}
      >
        ↶
      </button>
      <button
        type="button"
        onPointerDown={keep}
        aria-label="Redo"
        onClick={act((v) => void redo(v))}
      >
        ↷
      </button>
    </div>
  );
}
