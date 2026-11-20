import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { completeLinks } from "./linkComplete.ts";

const theme = EditorView.theme({
  "&": { fontSize: "1rem", backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-content": { fontFamily: "var(--mono)", padding: "1rem 0 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 1rem", lineHeight: "1.6" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent-soft) 45%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
});

/**
 * A plain source editor. The text is edited as written, so nothing the author did not touch can
 * change. `initial` is read once; later changes come from the author's typing only.
 */
export function CodeEditor({
  initial,
  onChange,
  readOnly = false,
}: {
  initial: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          markdown(),
          // Entry names are offered after "[[". This replaces the editor's own word suggestions.
          autocompletion({ override: [completeLinks], icons: false }),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // The editor owns the text after it is created.
  }, []);

  return <div ref={host} className="code-editor" />;
}
