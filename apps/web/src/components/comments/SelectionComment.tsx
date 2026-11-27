import { MessageSquare } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type Anchor } from "../anchor.ts";
import { Icon } from "../ui/Icon.tsx";
import { countSpaced, MOST_QUOTED, sourceAnchor } from "./model.ts";
import "./SelectionComment.css";

interface Chosen {
  /** Where to put the button: just above the end of the selection, in the window. */
  top: number;
  left: number;
  anchor: Anchor;
}

/** The words selected in the page, as the Markdown passage they are, or null while nothing counts. */
function chosen(root: HTMLElement, source: string): Chosen | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const words = sel.toString().replace(/\s+/g, " ").trim();
  if (words.replace(/\s/g, "").length < 3) return null;
  // Which of the repeats of these words on the page was chosen.
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const nth = countSpaced(before.toString(), words.slice(0, MOST_QUOTED));
  const anchor = sourceAnchor(source, words, nth) ?? {
    quote: words.slice(0, MOST_QUOTED),
    prefix: "",
    suffix: "",
  };
  const rects = range.getClientRects();
  const end = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
  return {
    top: Math.max(8, end.top - 44),
    left: Math.min(Math.max(8, end.right - 40), window.innerWidth - 150),
    anchor,
  };
}

/**
 * A small Comment button beside the words selected in the entry's page (stage 31e), for every role:
 * it opens the Comments panel on a form for that passage. Without a selection nothing is drawn.
 */
export function SelectionComment(p: {
  root: RefObject<HTMLElement | null>;
  /** The entry's Markdown, the passage is found in. */
  text: string;
  onComment: (anchor: Anchor) => void;
}) {
  const [at, setAt] = useState<Chosen | null>(null);
  useEffect(() => {
    let wait = 0;
    const look = () => {
      window.clearTimeout(wait);
      // Waits for the selection to settle, so a drag is not measured at every step.
      wait = window.setTimeout(() => {
        const root = p.root.current;
        setAt(root ? chosen(root, p.text) : null);
      }, 150);
    };
    const hide = () => setAt(null);
    document.addEventListener("selectionchange", look);
    document.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(wait);
      document.removeEventListener("selectionchange", look);
      document.removeEventListener("scroll", hide, true);
    };
  }, [p.root, p.text]);
  if (!at) return null;
  return createPortal(
    <button
      type="button"
      className="comment-selection"
      style={{ top: at.top, left: at.left }}
      aria-label="Comment on the selected passage"
      // Pressing must not take the selection away before the click is handled.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        p.onComment(at.anchor);
        setAt(null);
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Icon icon={MessageSquare} size="sm" /> Comment
    </button>,
    document.body,
  );
}
