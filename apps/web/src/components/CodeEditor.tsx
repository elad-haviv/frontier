import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { commentMarks } from "./commentMarks.ts";
import { completeLinks } from "./linkComplete.ts";
import { notePath } from "./imageWidget.ts";
import { livePreview } from "./livePreview.ts";
import { inTable, tableKeys } from "./tableKeys.ts";

const theme = EditorView.theme({
  "&": { fontSize: "1rem", backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-content": { fontFamily: "var(--mono)", padding: "1rem 0 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 1rem", lineHeight: "1.6" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent-soft) 45%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-comment": {
    backgroundColor: "color-mix(in srgb, #e0b13a 30%, transparent)",
    borderBottom: "2px solid color-mix(in srgb, #c08a12 70%, transparent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
});

/** Hands image files from a paste or a drop to the page. Anything else is left to the editor. */
function takeImages(
  data: DataTransfer | null,
  event: Event,
  handle: ((files: File[]) => void) | undefined,
): boolean {
  const images = [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (!images.length || !handle) return false;
  event.preventDefault();
  handle(images);
  return true;
}

/**
 * A plain source editor. The text is edited as written, so nothing the author did not touch can
 * change. `initial` is read once; later changes come from the author's typing only.
 */
export function CodeEditor({
  initial,
  onChange,
  readOnly = false,
  preview = false,
  viewRef,
  onFiles,
  path = "",
  onTable,
}: {
  initial: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  /** Hide Markdown marks away from the line being edited. */
  preview?: boolean;
  /** Receives the editor, so a toolbar can insert text into it. */
  viewRef?: { current: EditorView | null };
  /** Called with image files pasted or dropped into the editor. */
  onFiles?: (files: File[]) => void;
  /** The note's vault path, so live preview can find the images it embeds. */
  path?: string;
  /** Told whether the cursor is in a table, when the cursor moves. */
  onTable?: (inside: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const files = useRef(onFiles);
  files.current = onFiles;
  const table = useRef(onTable);
  table.current = onTable;
  const previewSlot = useRef(new Compartment());
  const made = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          // Before the standard keys, so Tab moves between table cells before it indents.
          keymap.of(tableKeys),
          basicSetup,
          previewSlot.current.of(preview ? livePreview : []),
          EditorView.domEventHandlers({
            paste(event) {
              return takeImages(event.clipboardData, event, files.current);
            },
            drop(event) {
              return takeImages(event.dataTransfer, event, files.current);
            },
          }),
          markdown(),
          notePath.of(path),
          // Entry names are offered after "[[". This replaces the editor's own word suggestions.
          autocompletion({ override: [completeLinks], icons: false }),
          EditorView.lineWrapping,
          commentMarks,
          EditorState.readOnly.of(readOnly),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current?.(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) table.current?.(inTable(update.state));
          }),
        ],
      }),
    });
    made.current = view;
    if (viewRef) viewRef.current = view;
    return () => {
      made.current = null;
      if (viewRef) viewRef.current = null;
      view.destroy();
    };
    // The editor owns the text after it is created.
  }, []);

  useEffect(() => {
    made.current?.dispatch({
      effects: previewSlot.current.reconfigure(preview ? livePreview : []),
    });
  }, [preview]);

  return <div ref={host} className="code-editor" />;
}
