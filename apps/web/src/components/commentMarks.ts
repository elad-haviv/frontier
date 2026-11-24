/**
 * Highlights of commented passages in the editor. The page sets where they are; typing moves them
 * along with the text.
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const setCommentMarks = StateEffect.define<{ id: string; from: number; to: number }[]>();

const mark = (id: string) =>
  Decoration.mark({ class: "cm-comment", attributes: { "data-comment": id } });

export const commentMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setCommentMarks)) {
        next = Decoration.set(
          e.value
            .filter((r) => r.to > r.from && r.to <= tr.state.doc.length)
            .map((r) => mark(r.id).range(r.from, r.to)),
          true,
        );
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
