/**
 * The passage a finding of Consult is about, highlighted while the finding is chosen. It moves
 * with typing, and goes when the passage is deleted whole.
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const showFinding = StateEffect.define<{ from: number; to: number } | null>();

const mark = Decoration.mark({ class: "cm-consult-passage" });

export const consultMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(showFinding)) {
        marks =
          e.value && e.value.to > e.value.from
            ? Decoration.set([mark.range(e.value.from, e.value.to)])
            : Decoration.none;
      }
    }
    return marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Where the highlight is now, if there is one. */
export function markedRange(view: EditorView): { from: number; to: number } | null {
  const it = view.state.field(consultMark, false)?.iter();
  return it && it.value ? { from: it.from, to: it.to } : null;
}
