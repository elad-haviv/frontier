/**
 * What the phone's library panel and the desktop's library pane share: the folders (or why they
 * cannot be shown), the empty library, the top bar's two buttons, and bringing the entry in view
 * into sight.
 */
import type { TreeResponse } from "@frontier/schema";
import { FilePlus2, FolderPlus, Plus } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import type { Async } from "../../useAsync.ts";
import { Tree } from "../Tree.tsx";
import { entriesIn } from "../tree/model.ts";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Problem } from "../ui/Problem.tsx";
import { useCanWrite } from "../projectContext.ts";

/** The folders, or why they cannot be shown yet. */
function TreeBody({
  tree,
  current,
  onRetry,
  onNewEntryIn,
  asked,
  replaceNav = false,
  onOpenCurrent,
  focusCurrent = false,
  onFocusTaken,
}: {
  tree: Async<TreeResponse>;
  current: string;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
  asked: number;
  replaceNav?: boolean;
  onOpenCurrent?: () => void;
  focusCurrent?: boolean;
  onFocusTaken?: (() => void) | undefined;
}) {
  if (tree.state === "loading") return <p className="muted pad">Loading…</p>;
  if (tree.state === "failed") return <Problem reason={tree.error.message} onRetry={onRetry} />;
  return (
    <Tree
      tree={tree.value}
      current={current}
      onNewEntry={onNewEntryIn}
      onChanged={onRetry}
      newFolderAsked={asked}
      replaceNav={replaceNav}
      focusCurrent={focusCurrent}
      {...(onFocusTaken ? { onFocusTaken } : {})}
      {...(onOpenCurrent ? { onOpenCurrent } : {})}
    />
  );
}

/** Whether the library has been read and holds nothing at all. */
export const isEmptyTree = (tree: Async<TreeResponse>): boolean =>
  tree.state === "ready" && entriesIn(tree.value) === 0 && tree.value.folders.length === 0;

/**
 * The top bar's new entry and new folder buttons: only once the library is read and has something
 * in it (an empty library has its own New entry button), and only for someone who can write: a
 * reader's library has no control that changes anything.
 */
export function LibraryTools({
  tree,
  onNewEntryIn,
  onNewFolder,
  tipSide,
}: {
  tree: Async<TreeResponse>;
  onNewEntryIn: (folder: string) => void;
  onNewFolder: () => void;
  tipSide: "bottom" | "right";
}) {
  const canWrite = useCanWrite();
  if (!canWrite || tree.state !== "ready" || isEmptyTree(tree)) return null;
  return (
    <>
      {/* A new entry at the top of the library, whatever entry is in view. */}
      <IconButton
        label="New entry"
        icon={FilePlus2}
        tipSide={tipSide}
        className="left-new-entry"
        onClick={() => onNewEntryIn("")}
      />
      <IconButton
        label="New folder"
        icon={FolderPlus}
        tipSide={tipSide}
        className="left-new-folder"
        onClick={onNewFolder}
      />
    </>
  );
}

/**
 * Brings the entry in view into sight in the scrolling `body`: when `active` turns on (centred),
 * and as the entry in view changes (the least scroll that shows it, so a click in the tree does
 * not move the list under the pointer). It waits for the tree to draw the row.
 */
function useShowCurrent(
  body: RefObject<HTMLElement | null>,
  active: boolean,
  ready: boolean,
  current: string,
): void {
  const shown = useRef(false);
  useEffect(() => {
    if (!active) shown.current = false;
  }, [active]);
  useEffect(() => {
    if (!active || !ready) return;
    let tries = 0;
    let frame = 0;
    const show = () => {
      const row = body.current?.querySelector<HTMLElement>(
        ".tree-note.active, .tree-folder.active",
      );
      if (row) {
        row.scrollIntoView({ block: shown.current ? "nearest" : "center" });
        shown.current = true;
      } else if (++tries < 30) frame = requestAnimationFrame(show);
    };
    frame = requestAnimationFrame(show);
    return () => cancelAnimationFrame(frame);
  }, [body, active, ready, current]);
}

/**
 * The scrolling area under a library's top bar: the folders, or "No entries yet" with a New entry
 * button. `drawn` is false while a sliding panel is out of sight and has nothing to keep.
 */
export function LibraryBody({
  tree,
  current,
  active,
  drawn = true,
  asked,
  onRetry,
  onNewEntryIn,
  replaceNav = false,
  onOpenCurrent,
  focusCurrent = false,
  onFocusTaken,
}: {
  tree: Async<TreeResponse>;
  current: string;
  /** Whether the library is open now, for bringing the entry in view into sight. */
  active: boolean;
  drawn?: boolean;
  asked: number;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
  replaceNav?: boolean;
  onOpenCurrent?: () => void;
  /** The tree takes the focus as it is drawn. */
  focusCurrent?: boolean;
  /** The focus went in: the ask is spent. */
  onFocusTaken?: (() => void) | undefined;
}) {
  const body = useRef<HTMLDivElement>(null);
  const canWrite = useCanWrite();
  useShowCurrent(body, active, tree.state === "ready", current);
  return (
    <div ref={body} className="library-body">
      {drawn &&
        (isEmptyTree(tree) ? (
          <div className="library-empty">
            <p>No entries yet.</p>
            {canWrite && (
              <button type="button" className="new-entry" onClick={() => onNewEntryIn("")}>
                <Icon icon={Plus} size="sm" />
                New entry
              </button>
            )}
          </div>
        ) : (
          <TreeBody
            tree={tree}
            current={current}
            onRetry={onRetry}
            onNewEntryIn={onNewEntryIn}
            asked={asked}
            replaceNav={replaceNav}
            focusCurrent={focusCurrent}
            {...(onFocusTaken ? { onFocusTaken } : {})}
            {...(onOpenCurrent ? { onOpenCurrent } : {})}
          />
        ))}
    </div>
  );
}
