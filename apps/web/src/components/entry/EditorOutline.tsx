import type { EditorView } from "@codemirror/view";
import { extractHeadings } from "@frontier/vault";
import { TableOfContents } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import type { PanelSpec } from "../shell/panels.tsx";
import { OutlinePanel, plainHeading } from "./OutlinePanel.tsx";

/**
 * The cursor's line, told by the editor each time the text or the cursor changes, for the outline
 * to follow. Only the open panel listens, so the page itself is not drawn again.
 */
class CursorLine {
  line = 1;
  private told = 0;
  private readonly listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.told;
  set = (line: number) => {
    this.line = line;
    this.told++;
    for (const l of [...this.listeners]) l();
  };
}

/** The outline of the text being written: its headings, the one the cursor is under marked. */
function EditorOutlinePanel({ view, cursor }: { view: EditorView; cursor: CursorLine }) {
  useSyncExternalStore(cursor.subscribe, cursor.get);
  const line = cursor.line;
  const doc = view.state.doc;
  // Found again only when the text changed since; the cursor alone moves the mark.
  const headings = useMemo(
    () => extractHeadings(doc.toString()).map((h) => ({ ...h, text: plainHeading(h.text) || "…" })),
    [doc],
  );
  const current = headings.findLastIndex((h) => h.line <= line);
  return (
    <OutlinePanel
      items={headings}
      current={current}
      onChoose={(i) => {
        const at = view.state.doc.line(headings[i]!.line);
        view.dispatch({ selection: { anchor: at.to }, scrollIntoView: true });
        view.focus();
      }}
    />
  );
}

/**
 * The editor's Outline tab. Headings come from the document, and the one marked from the line the
 * cursor is on, told through `onCursor`; choosing a heading puts the cursor at its end.
 */
export function useEditorOutline(view: { current: EditorView | null }): {
  panel: PanelSpec;
  onCursor: (line: number) => void;
} {
  const cursor = useMemo(() => new CursorLine(), []);
  return {
    panel: {
      id: "outline",
      title: "Outline",
      icon: TableOfContents,
      render: () => view.current && <EditorOutlinePanel view={view.current} cursor={cursor} />,
    },
    onCursor: cursor.set,
  };
}
