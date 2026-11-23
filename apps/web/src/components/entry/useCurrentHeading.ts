import { type RefObject, useEffect, useState } from "react";

/** A heading of the entry as the page draws it. */
export interface PageHeading {
  el: HTMLElement;
  level: number;
  /** The words shown, so marks never show and two headings with the same words stay apart. */
  text: string;
}

/**
 * How far below the top of the page area a heading counts as reached: just past the sticky line,
 * and past the room the area keeps when it scrolls a heading into view (`scroll-padding-top`).
 */
const LINE = 72;

/**
 * Where the reader is in an entry: its headings (levels 1 to 3, found in the drawn text), the one
 * the reader has reached (the last above the top of the page area), and whether the title has
 * scrolled away. One observer watches them all, with the page area as its root; it reports each
 * time a heading or the title crosses the line, and the positions are measured then.
 *
 * `text` is whatever changes the drawn text, so the headings are found again.
 */
export function useCurrentHeading(
  prose: RefObject<HTMLElement | null>,
  title: RefObject<HTMLElement | null>,
  text: unknown,
): { headings: PageHeading[]; current: number; titleGone: boolean } {
  const [headings, setHeadings] = useState<PageHeading[]>([]);
  const [current, setCurrent] = useState(-1);
  const [titleGone, setTitleGone] = useState(false);

  useEffect(() => {
    const box = prose.current;
    const els = box ? [...box.querySelectorAll<HTMLElement>("h1, h2, h3")] : [];
    setHeadings(
      els.map((el) => ({
        el,
        level: Number(el.tagName.slice(1)),
        text: (el.textContent ?? "").trim(),
      })),
    );
    // The shell's page area scrolls; without the shell (as in a test) nothing is watched.
    const root = document.querySelector<HTMLElement>(".content");
    if (!root) return;

    const measure = () => {
      const line = root.getBoundingClientRect().top + LINE;
      let at = -1;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= line) at = i;
      });
      setCurrent(at);
      const head = title.current;
      // Gone once all of it is above the line, where the sticky line would cover it.
      setTitleGone(head ? head.getBoundingClientRect().bottom <= line : false);
    };

    // The observed band runs from far above the page area down to the line, so crossing the
    // line either way is reported, however fast the page scrolls.
    let observer: IntersectionObserver | null = null;
    const watch = () => {
      observer?.disconnect();
      const below = Math.max(0, root.clientHeight - LINE);
      observer = new IntersectionObserver(measure, {
        root,
        rootMargin: `100000px 0px -${below}px 0px`,
        threshold: [0, 1],
      });
      for (const el of els) observer.observe(el);
      if (title.current) observer.observe(title.current);
    };
    // The heading reached, and how far below the top of the area it was, as the reader left it.
    // When the area narrows or widens, as when the side bar opens, the text flows anew; the page
    // then scrolls so that heading is where it was, and the reader keeps the place.
    // A scroll that comes with a new width is the browser's, as the text flows anew; it is not
    // the reader's, so it keeps nothing.
    let kept: { el: HTMLElement; offset: number } | null = null;
    let width = root.clientWidth;
    const keep = () => {
      if (root.clientWidth !== width) return;
      const top = root.getBoundingClientRect().top;
      const el = els.findLast((h) => h.getBoundingClientRect().top <= top + LINE);
      kept = el ? { el, offset: el.getBoundingClientRect().top - top } : null;
    };
    const resize = () => {
      if (kept && root.clientWidth !== width) {
        const now = kept.el.getBoundingClientRect().top - root.getBoundingClientRect().top;
        root.scrollTop += now - kept.offset;
      }
      width = root.clientWidth;
      watch();
      measure();
    };

    watch();
    measure();
    keep();
    // The browser's own scroll anchoring would pick some other element to hold still; this one
    // holds the heading reached instead.
    const anchoring = root.style.overflowAnchor;
    root.style.overflowAnchor = "none";
    root.addEventListener("scroll", keep, { passive: true });
    const resized = new ResizeObserver(resize);
    resized.observe(root);
    return () => {
      observer?.disconnect();
      resized.disconnect();
      root.removeEventListener("scroll", keep);
      root.style.overflowAnchor = anchoring;
    };
  }, [prose, title, text]);

  return { headings, current, titleGone };
}
