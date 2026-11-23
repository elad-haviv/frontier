import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";

interface Shown {
  path: string;
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
 * The opening of an entry, for a preview: from the shared cache, else asked of the server once.
 * Null while it is on its way, when it cannot be read, and when there is no path.
 */
export function usePreviewText(path: string | null): string | null {
  const [text, setText] = useState<{ path: string; text: string } | null>(() =>
    path && cache.has(path) ? { path, text: cache.get(path)! } : null,
  );
  useEffect(() => {
    if (!path) return;
    const known = cache.get(path);
    if (known !== undefined) {
      setText({ path, text: known });
      return;
    }
    let live = true;
    api.preview(path).then(
      (p) => {
        cache.set(path, p.text);
        if (live) setText({ path, text: p.text });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path]);
  return path && text?.path === path ? text.text : null;
}

/** An entry's opening as plain text: marks are stripped, nothing is rendered as markup. */
function plainText(text: string): string {
  return text
    .replace(/^#+\s+.*$/m, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The card of a preview: the entry's name and the start of its text. `children` adds lines below,
 * such as the map of a place. It is placed by `style`.
 */
export function PreviewCard({
  path,
  text,
  style,
  className,
  children,
}: {
  path: string;
  text: string;
  style: CSSProperties;
  className?: string;
  children?: ReactNode;
}) {
  const name = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
  const plain = plainText(text);
  return (
    <div
      className={`hover-preview${className ? ` ${className}` : ""}`}
      role="tooltip"
      style={style}
    >
      <strong>{name}</strong>
      <p>
        {plain.slice(0, 280) || "This entry is empty."}
        {plain.length > 280 ? " …" : ""}
      </p>
      {children}
    </div>
  );
}

/**
 * Shows the opening of a linked entry when its link is hovered. For mouse pointers only: on a
 * touch screen a tap follows the link, as expected.
 */
export function HoverPreview({ scope }: { scope: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const text = usePreviewText(shown?.path ?? null);

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
      timer.current = window.setTimeout(() => {
        const box = anchor.getBoundingClientRect();
        const left = Math.min(box.left, window.innerWidth - 22 * 16 - 16);
        setShown({ path, x: Math.max(16, left), y: box.bottom + 8 });
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

  if (!shown || text === null) return null;
  return <PreviewCard path={shown.path} text={text} style={{ left: shown.x, top: shown.y }} />;
}
