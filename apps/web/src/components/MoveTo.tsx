import type { TreeResponse } from "@frontier/schema";
import { useId, useMemo, useState } from "react";
import { DialogFrame } from "./Dialogs.tsx";
import { eachFolder, nameOf, parentOf, type Row } from "./tree/model.ts";
import { Combobox, type ComboboxOption } from "./ui/Combobox.tsx";
import { TOP } from "./folders.ts";

/**
 * Moves a folder or an entry by choosing where it goes: what dragging does, for touch and for
 * keys. A folder cannot go inside itself.
 */
export function MoveTo({
  tree,
  row,
  onMove,
  onClose,
}: {
  tree: TreeResponse;
  row: Row;
  /** Called with the folder it goes into; "" is the top of the library. */
  onMove: (folder: string) => void;
  onClose: () => void;
}) {
  const label = useId();
  const from = parentOf(row.path);
  const [where, setWhere] = useState(from);
  const options = useMemo<ComboboxOption[]>(() => {
    const inside = (p: string) =>
      row.kind === "folder" && (p === row.path || p.startsWith(row.path + "/"));
    return [
      { value: "", label: TOP },
      ...eachFolder(tree)
        .map((f) => f.path)
        .filter((p) => !inside(p))
        .map((p) => ({ value: p, label: p })),
    ];
  }, [tree, row]);
  return (
    <DialogFrame
      title={`Move ${row.name}`}
      onCancel={onClose}
      onSubmit={() => (where === from ? onClose() : onMove(where))}
      className="move-to-dialog"
    >
      <div className="dialog-field">
        <span id={label}>Into</span>
        <Combobox
          labelledBy={label}
          options={options}
          value={where}
          onChange={setWhere}
          findLabel="Find a folder"
          empty="No folder has that name."
        />
      </div>
      <p className="muted small">
        {where === from
          ? `It is in ${from ? nameOf(from) : "the top of the library"} now.`
          : `Links to it are rewritten when you save a version.`}
      </p>
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={where === from}>
          Move
        </button>
      </p>
    </DialogFrame>
  );
}
