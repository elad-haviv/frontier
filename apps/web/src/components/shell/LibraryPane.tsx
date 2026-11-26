import type { TreeResponse } from "@frontier/schema";
import { X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import type { Async } from "../../useAsync.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { isEmptyTree, LibraryBody, LibraryTools } from "./LibraryBody.tsx";
import "./DrawerLibrary.css";
import "./LibraryPane.css";

/**
 * Stage 28: the library as a pane beside the side bar on a desktop. Its top bar has the title, the
 * new entry and new folder buttons and a close button; the folders fill the rest and scroll
 * inside it. Docked, it pushes the page; floating (a narrow window), it lies over the page and
 * the shell closes it as an entry is picked. `focus` moves the focus into it as it opens.
 */
export function LibraryPane({
  tree,
  current,
  floating,
  focus,
  onClose,
  onRetry,
  onNewEntryIn,
  paneRef,
}: {
  tree: Async<TreeResponse>;
  current: string;
  floating: boolean;
  focus: boolean;
  /** Closes the pane: the × button. */
  onClose: () => void;
  onRetry: () => void;
  onNewEntryIn: (folder: string) => void;
  /** The shell reads the pane through it, to see whether the focus is inside. */
  paneRef: RefObject<HTMLElement | null>;
}) {
  const [asked, setAsked] = useState(0);

  // Opened by the author (a click or a key), the focus goes in: the tree takes it on the entry in
  // view; a library with no rows to take it (empty, or not read) gives it to its first button.
  const noRows = tree.state === "failed" || isEmptyTree(tree);
  useEffect(() => {
    if (!focus || !noRows) return;
    const frame = requestAnimationFrame(() =>
      paneRef.current?.querySelector<HTMLElement>(".library-body button")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focus, noRows, paneRef]);

  return (
    <section
      ref={paneRef}
      className={`library-pane${floating ? " is-floating" : ""}`}
      aria-label="Library"
    >
      <div className="library-head">
        <h2 className="library-title">Library</h2>
        <LibraryTools
          tree={tree}
          onNewEntryIn={onNewEntryIn}
          onNewFolder={() => setAsked((n) => n + 1)}
          tipSide="bottom"
        />
        <IconButton label="Close Library" icon={X} tipSide="bottom" onClick={onClose} />
      </div>
      <LibraryBody
        tree={tree}
        current={current}
        active
        focusCurrent={focus}
        asked={asked}
        onRetry={onRetry}
        onNewEntryIn={onNewEntryIn}
        {...(floating ? { onOpenCurrent: onClose } : {})}
      />
    </section>
  );
}
