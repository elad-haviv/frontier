import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { NEEDS_CONNECTION } from "../sync/connection.ts";

interface Shown {
  path: string;
  text: string;
  x: number;
  y: number;
}

const cache = new Map<string, string>();

/** The vault path a reader link points at, or null for any other link. */
function pathOf(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("/e/")) return null;
  return href
    .slice(3)
    .split("#")[0]!
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

/**
 * Shows the opening of a linked entry when its link is hovered. For mouse pointers only: on a
 * touch screen a tap follows the link, as expected.
 */
export function HoverPreview({ scope }: { scope: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const root = document.querySelector(scope);
    if (!root) return;

    const over = (e: Event) => {
      const anchor = (e.target as Element).closest?.("a.link-resolved") as HTMLAnchorElement | null;
      if (!anchor) return;
      const path = pathOf(anchor);
      if (!path) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        const at = () => {
          const box = anchor.getBoundingClientRect();
          const left = Math.min(box.left, window.innerWidth - 22 * 16 - 16);
          return { x: Math.max(16, left), y: box.bottom + 8 };
        };
        try {
          const text = cache.get(path) ?? (await api.preview(path)).text;
          cache.set(path, text);
          setShown({ path, text, ...at() });
        } catch (err) {
          // Previews are not kept on the device: with no server, the card says why it is empty.
          const lost = err instanceof ApiFailure && err.status === 0;
          setShown(lost ? { path, text: NEEDS_CONNECTION, ...at() } : null);
        }
      }, 350);
    };
    const out = () => {
      window.clearTimeout(timer.current);
      setShown(null);
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", out);
    // The page scrolls in its own area, so scrolls are heard on the way down to it.
    document.addEventListener("scroll", out, { passive: true, capture: true });
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", out);
      document.removeEventListener("scroll", out, { capture: true });
      window.clearTimeout(timer.current);
    };
  }, [scope]);

  if (!shown) return null;
  const name = (shown.path.split("/").pop() ?? "").replace(/\.md$/i, "");
  // Shown as plain text: marks are stripped, nothing from the note is rendered as markup.
  const plain = shown.text
    .replace(/^#+\s+.*$/m, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    <div className="hover-preview" role="tooltip" style={{ left: shown.x, top: shown.y }}>
      <strong>{name}</strong>
      <p>
        {plain.slice(0, 280) || "This entry is empty."}
        {plain.length > 280 ? " …" : ""}
      </p>
    </div>
  );
}
