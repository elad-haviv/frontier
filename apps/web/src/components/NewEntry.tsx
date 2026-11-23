import { FOLDERS, type TreeResponse } from "@frontier/schema";
import { checkEntryName } from "@frontier/vault";
import { libraryFileClient } from "../sync/libraryFile.ts";
import { findFolder } from "./tree/model.ts";
import { foldersOf, TOP } from "./folders.ts";
import { useId, useMemo, useRef, useState } from "react";
import type { Loaded } from "../useAsync.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { Combobox, type ComboboxOption } from "./ui/Combobox.tsx";
import { Problem } from "./ui/Problem.tsx";
import { Progress } from "./ui/Progress.tsx";
import "./NewEntry.css";

/** A folder path that is safe: each part a safe name, no empty parts. */
export function safeFolder(path: string): string {
  return path
    .split("/")
    .map((p) => p.replace(/[\\:*?"<>|#^[\]]/g, "").trim())
    .filter((p) => p !== "" && p !== "." && p !== ".." && !p.startsWith("."))
    .join("/");
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
  /** Called with the new entry's path, and the type its folder gives its entries, if any. */
  onMake: (path: string, type?: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState(folder);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const folderLabel = useId();

  /** A folder made here, from the name typed into the folder list. */
  const [made, setMade] = useState<string | null>(null);
  const options = useMemo<ComboboxOption[]>(() => {
    const paths = tree.state === "ready" ? foldersOf(tree.value) : [];
    // The folder in view is offered even before the tree has arrived.
    if (folder && !paths.includes(folder)) paths.unshift(folder);
    if (made && !paths.includes(made)) paths.push(made);
    return [{ value: "", label: TOP }, ...paths.map((p) => ({ value: p, label: p }))];
  }, [tree, folder, made]);

  function make() {
    const checked = checkEntryName(name);
    if (!checked.ok) {
      setProblem(checked.problem);
      field.current?.focus();
      return;
    }
    const path = `${where ? where + "/" : ""}${checked.name}.md`;
    // A folder made here is kept as a line of the folder file, so it stays if the entry does not.
    if (made && where === made) {
      void libraryFileClient(FOLDERS)
        .change((f) =>
          f.folders.some((l) => l.path === made)
            ? f
            : { ...f, folders: [...f.folders, { path: made }] },
        )
        .catch(() => undefined);
    }
    onMake(path, typeOf(where));
  }

  /** The type a folder gives its entries: its own, or the nearest one above it. */
  function typeOf(path: string): string | undefined {
    if (tree.state !== "ready") return undefined;
    for (let p = path; p !== ""; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") {
      const type = findFolder(tree.value, p)?.type;
      if (type) return type;
    }
    return undefined;
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
          create={{
            label: (typed) => `New folder "${safeFolder(typed)}"`,
            onCreate: (typed) => {
              const path = safeFolder(typed);
              if (!path) return;
              setMade(path);
              setWhere(path);
            },
          }}
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
