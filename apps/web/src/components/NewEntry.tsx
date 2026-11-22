import type { TreeFolder, TreeResponse } from "@frontier/schema";
import { useId, useMemo, useRef, useState } from "react";
import type { Loaded } from "../useAsync.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { Combobox, type ComboboxOption } from "./ui/Combobox.tsx";
import { Problem } from "./ui/Problem.tsx";
import { Progress } from "./ui/Progress.tsx";
import "./NewEntry.css";

const TOP = "Top of the library";

/** Every folder in the tree, in the tree's order, by its full path. */
function foldersOf(tree: TreeResponse): string[] {
  const out: string[] = [];
  const walk = (folders: TreeFolder[]) => {
    for (const f of [...folders].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }),
    )) {
      out.push(f.path);
      walk(f.folders);
    }
  };
  walk(tree.folders);
  return out;
}

/** A name that is safe as a file name: no path signs, no ".md" typed by habit. */
export function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\.md$/i, "")
    .trim();
}

/**
 * Asks for a new entry's name and folder. The folder starts as the one in view and can be any
 * folder of the library, chosen by typing part of its name.
 */
export function NewEntry({
  tree,
  folder,
  onMake,
  onRetry,
  onClose,
}: {
  tree: Loaded<TreeResponse>;
  /** The folder in view, offered first. "" is the top of the library. */
  folder: string;
  /** Called with the new entry's path. */
  onMake: (path: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState(folder);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const folderLabel = useId();

  const options = useMemo<ComboboxOption[]>(() => {
    const paths = tree.state === "ready" ? foldersOf(tree.value) : [];
    // The folder in view is offered even before the tree has arrived.
    if (folder && !paths.includes(folder)) paths.unshift(folder);
    return [{ value: "", label: TOP }, ...paths.map((p) => ({ value: p, label: p }))];
  }, [tree, folder]);

  function make() {
    const safe = safeName(name);
    if (!safe) {
      setProblem("Give the entry a name.");
      field.current?.focus();
      return;
    }
    onMake(`${where ? where + "/" : ""}${safe}.md`);
  }

  return (
    <DialogFrame
      title="New entry"
      onCancel={onClose}
      onSubmit={make}
      initialFocus={field}
      className="new-entry-dialog"
    >
      <label className="dialog-field">
        <span>Name</span>
        <input
          ref={field}
          type="text"
          value={name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      <div className="dialog-field">
        <span id={folderLabel}>Folder</span>
        <Combobox
          labelledBy={folderLabel}
          options={options}
          value={where}
          onChange={setWhere}
          findLabel="Find a folder"
          empty="No folder has that name."
        />
        {tree.state === "loading" && <Progress label="Loading the folders" />}
      </div>
      {tree.state === "failed" && (
        <Problem
          reason={`The folders could not be loaded: ${tree.error.message}`}
          onRetry={onRetry}
        />
      )}
      {problem && (
        <p className="error new-entry-problem" role="alert">
          {problem}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Make the entry
        </button>
      </p>
    </DialogFrame>
  );
}
