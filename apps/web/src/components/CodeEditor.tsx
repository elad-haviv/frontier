import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { commentMarks } from "./commentMarks.ts";
import { helpCard } from "./writing/helpCard.ts";
import { completeLinks } from "./linkComplete.ts";
import { notePath } from "./imageWidget.ts";
import { editorKeymap } from "../keys.ts";
import { frontmatterEnd, livePreview, openProperties } from "./livePreview.ts";
import { inTable } from "./tableKeys.ts";

const theme = EditorView.theme({
  "&": { fontSize: "1rem", backgroundColor: "transparent", color: "var(--ink)" },
  // Source is fixed-width; live preview sets the reading font instead (styles.css, .cm-reading).
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
  // The passage writing help works on, while its card is open.
  ".cm-help-passage": {
    backgroundColor: "var(--accent-soft)",
    boxShadow: "0 0 0 2px var(--accent-soft)",
    borderRadius: "2px",
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
  onProperties,
  onCursor,
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
  /** Called when the folded frontmatter line is chosen in live preview. */
  onProperties?: () => void;
  /** Told the cursor's line (from 1) when the text or the cursor changes, as for the outline. */
  onCursor?: (line: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const files = useRef(onFiles);
  files.current = onFiles;
  const table = useRef(onTable);
  table.current = onTable;
  const properties = useRef(onProperties);
  properties.current = onProperties;
  const cursor = useRef(onCursor);
  cursor.current = onCursor;
  const previewSlot = useRef(new Compartment());
  const made = useRef<EditorView | null>(null);

  useEffect(() => {
    const frontmatter = frontmatterEnd(EditorState.create({ doc: initial }));
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        // The cursor starts where the writing does, after the frontmatter.
        selection: { anchor: frontmatter ? Math.min(frontmatter + 1, initial.length) : 0 },
        extensions: [
          // Ahead of the standard keys: Bold, Italic, Save, Done, and Tab between table cells.
          editorKeymap(),
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
          openProperties.of(() => properties.current?.()),
          // Entry names are offered after "[[". This replaces the editor's own word suggestions.
          autocompletion({ override: [completeLinks], icons: false }),
          EditorView.lineWrapping,
          commentMarks,
          helpCard,
          EditorState.readOnly.of(readOnly),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current?.(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              table.current?.(inTable(update.state));
              const { doc, selection } = update.state;
              cursor.current?.(doc.lineAt(selection.main.head).number);
            }
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
