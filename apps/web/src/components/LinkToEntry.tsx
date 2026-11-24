import type { EditorView } from "@codemirror/view";
import { useId, useLayoutEffect, useState } from "react";
import { insertLink, run } from "./editCommands.ts";
import { EntryCombobox } from "./EntryCombobox.tsx";
import { linkTarget } from "./linkComplete.ts";
import "./LinkToEntry.css";

/**
 * The link tool: the entry combobox, opened at once beside the cursor. The chosen entry is written
 * as `[[name]]` where the cursor is; closing the list without a choice leaves the text as it was.
 */
export function LinkToEntry({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const label = useId();
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const at = view.coordsAtPos(view.state.selection.main.head);
    const box = view.dom.getBoundingClientRect();
    // Under the cursor's line, kept on the screen.
    const left = Math.max(8, Math.min((at?.left ?? box.left) - 8, window.innerWidth - 296));
    const top = Math.min((at?.bottom ?? box.top) + 4, window.innerHeight - 56);
    setPlace({ left, top });
  }, [view]);

  if (!place) return null;
  return (
    <div className="link-to-entry" style={place} role="group" aria-labelledby={label}>
      <span id={label} className="link-to-entry-label">
        Link to an entry
      </span>
      <EntryCombobox
        labelledBy={label}
        value={null}
        open
        onOpenChange={(open) => {
          if (open) return;
          onClose();
          view.focus();
        }}
        onChange={(path, title) => {
          if (!path) return;
          void linkTarget(path, title).then((name) => {
            run(view, insertLink(view.state, name));
          });
        }}
      />
    </div>
  );
}
