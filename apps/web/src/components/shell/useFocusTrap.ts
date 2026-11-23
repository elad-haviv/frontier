import { type RefObject, useEffect, useRef } from "react";
import { isFree } from "../../keys.ts";

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab and Shift+Tab inside an element while `active`, closes on Escape, and gives the
 * focus back to where it was when it ends. The first control takes the focus when it starts,
 * unless `initial` says otherwise.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  initial: "first" | "none" = "first",
): void {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const before = document.activeElement as HTMLElement | null;
    if (initial === "first" && !root.contains(document.activeElement)) {
      (focusables(root)[0] ?? root).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      // A key a tooltip used on the way (Escape closing it) still closes the trap.
      if (!isFree(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        escape.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const now = document.activeElement;
      if (e.shiftKey && (now === first || !root.contains(now))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (now === last || !root.contains(now))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      // Back to the control that opened it, if it is still on the page.
      if (before && before.isConnected && before !== document.body) before.focus();
    };
  }, [ref, active, initial]);
}
