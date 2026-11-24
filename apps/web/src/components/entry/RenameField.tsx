import type { EntryResponse } from "@frontier/schema";
import { checkEntryName, dirname, stem } from "@frontier/vault";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { queue } from "../../sync/queue.ts";
import { useAsync } from "../../useAsync.ts";
import { folderOptions } from "../folders.ts";
import { useRefresh, useWords } from "../Shell.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { Progress } from "../ui/Progress.tsx";
import { useToast } from "../ui/Toast.tsx";
import "./RenameField.css";

const WAIT = "Wait until your changes are sent";

/** Where an entry will be once its rename is saved: the rename's path, or where it is. */
export const pendingPath = (e: EntryResponse): string => e.rename?.to ?? e.path;

/**
 * Renames or moves the entry on the page, to a path in the library. It is a direct call, as all
 * renames are, since the server works out which links change; so it waits for a connection and
 * for this entry's changes to be sent. An entry keeps one rename: going back to where it is in
 * the library takes the rename away. Gives the reason it could not, or null; a toast tells what
 * changed, with Undo.
 */
export function useRelocate(
  entry: EntryResponse | null,
  onDone: () => void,
): (to: string) => Promise<string | null> {
  const offline = useNeedsConnection();
  const toast = useToast();
  const refresh = useRefresh();
  const words = useWords();
  const saving = words.own ? "save a version" : "publish";

  return async (to: string) => {
    // Only an entry on the page offers renaming.
    if (!entry) return null;
    const e = entry;
    const now = pendingPath(e);
    if (to === now) return null;
    if (offline) return offline;
    if (queue.current().some((r) => r.key === `entry:${e.path}`)) return WAIT;
    const what =
      stem(to) !== stem(now)
        ? `Renamed to ${stem(to)}`
        : `Moved to ${dirname(to) || "the top of the library"}`;
    const done = () => {
      refresh();
      onDone();
    };
    const undoFailed = (err: unknown) =>
      toast({ message: err instanceof ApiFailure ? err.message : "It could not be undone." });
    try {
      if (to === e.path && e.rename) {
        // Back where it is in the library: no rename is left.
        const earlier = e.rename.to;
        await api.cancelRename(e.rename.id);
        done();
        toast({
          message: `${what}, as it is saved.`,
          action: {
            label: "Undo",
            run: () => void api.rename(e.path, earlier).then(done, undoFailed),
          },
        });
        return null;
      }
      const made = await api.rename(e.path, to);
      done();
      const n = made.affected.length;
      toast({
        message:
          n === 0
            ? `${what}; no other entry links to it.`
            : `${what}; links in ${n} other ${n === 1 ? "entry" : "entries"} change when you ${saving}.`,
        action: {
          label: "Undo",
          run: () =>
            void (async () => {
              await api.cancelRename(made.id);
              // The rename this one replaced comes back.
              if (made.replaced) await api.rename(made.replaced.from, made.replaced.to);
            })().then(done, undoFailed),
        },
      });
      return null;
    } catch (err) {
      return err instanceof ApiFailure ? err.message : "The entry could not be renamed.";
    }
  };
}

/**
 * The entry's title as a field, to rename it in place. Enter checks the name and renames; Escape
 * or leaving the field changes nothing. A name refused shows under the field.
 */
export function RenameField({
  name,
  onRename,
  onClose,
}: {
  name: string;
  /** Renames to the name, giving the reason it could not, or null. */
  onRename: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problemId = useId();

  async function submit(typed: string) {
    const checked = checkEntryName(typed);
    if (!checked.ok) return setProblem(checked.problem);
    if (checked.name === name) return onClose();
    setBusy(true);
    const refused = await onRename(checked.name);
    setBusy(false);
    if (refused) setProblem(refused);
    else onClose();
  }

  function onKey(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      void submit(ev.currentTarget.value);
    }
  }

  return (
    <div className="rename-field">
      <input
        className="rename-field-input"
        aria-label={`New name for ${name}`}
        aria-invalid={problem !== null || undefined}
        aria-describedby={problem ? problemId : undefined}
        defaultValue={name}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        readOnly={busy}
        onFocus={(ev) => ev.currentTarget.select()}
        onChange={() => setProblem(null)}
        onKeyDown={onKey}
        onBlur={() => !busy && onClose()}
      />
      {busy && <Progress label="Renaming" />}
      {problem ? (
        <p className="error rename-field-problem" id={problemId} role="alert">
          {problem}
        </p>
      ) : (
        <p className="muted rename-field-hint">Enter to rename, Escape to leave it.</p>
      )}
    </div>
  );
}

/**
 * "Move to…": the folder list, opened at once from the entry's menu. Choosing a folder moves the
 * entry there under the same name; closing the list changes nothing.
 */
export function MoveField({
  folder,
  onMove,
  onClose,
}: {
  /** The folder it is in, or will be in once its rename is saved. */
  folder: string;
  /** Moves into the folder, giving the reason it could not, or null. */
  onMove: (folder: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const label = useId();
  const tree = useAsync(() => api.tree(), "move-to-tree");
  const options = useMemo(
    () => folderOptions(tree.state === "ready" ? tree.value : null, [folder]),
    [tree, folder],
  );
  const [open, setOpen] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  // Choosing closes the list as well; while the move is made, that closes nothing else.
  const moving = useRef(false);
  const [busy, setBusy] = useState(false);

  async function choose(to: string) {
    if (to === folder) return onClose();
    moving.current = true;
    setBusy(true);
    setProblem(null);
    const refused = await onMove(to);
    moving.current = false;
    setBusy(false);
    if (refused) setProblem(refused);
    else onClose();
  }

  return (
    <div className="move-field">
      <span id={label} className="move-field-label">
        Move to
      </span>
      <Combobox
        labelledBy={label}
        options={options}
        value={folder}
        onChange={(to) => void choose(to)}
        findLabel="Find a folder"
        empty="No folder has that name."
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Closed without a choice: the line goes.
          if (!next && !moving.current) onClose();
        }}
      />
      {(busy || tree.state === "loading") && <Progress label="Moving" />}
      {problem && (
        <p className="error move-field-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
