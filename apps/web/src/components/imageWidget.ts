/**
 * In live preview, an image embed away from the cursor is shown as the image. A handle on its
 * right edge sets the width: dragging it rewrites the embed as "![[name.png|<width>]]" when the
 * pointer is let go, and a double tap on it, or the small reset button, takes the width away again.
 * Only the embed's own text changes. Mouse, pen and touch all work, through pointer events.
 */
import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { api, imageUrl } from "../api.ts";
import { clampWidth, type ImageEmbed, withWidth } from "./embedWidth.ts";

/** The vault path of the note being edited, which decides where an embed's image is found. */
export const notePath = Facet.define<string, string>({ combine: (values) => values[0] ?? "" });

const found = new Map<string, Promise<string | null>>();

/** The image an embed points at. Answers are kept, except "none", which may change on upload. */
function findImage(name: string, from: string): Promise<string | null> {
  const key = `${from}\n${name}`;
  let answer = found.get(key);
  if (!answer) {
    answer = api.findImage(name, from).then(
      (r) => r.path,
      () => null,
    );
    found.set(key, answer);
    void answer.then((path) => {
      if (path === null) found.delete(key);
    });
  }
  return answer;
}

/** The width the image may take: the line's, less its padding. */
function room(wrap: HTMLElement, view: EditorView): number {
  const line = wrap.closest<HTMLElement>(".cm-line");
  if (!line) return view.contentDOM.clientWidth;
  const style = getComputedStyle(line);
  return line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

const DOUBLE_TAP_MS = 400;

export class ImageWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly embed: ImageEmbed,
    readonly from: string,
    /** The embed is in a table row, where a new bar must be written "\|". */
    readonly inTable: boolean,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.raw === this.raw && other.from === this.from && other.inTable === this.inTable;
  }

  /** Rewrites the embed with a new width, or with none, if its text is still where it was. */
  private write(view: EditorView, wrap: HTMLElement, width: number | null) {
    const pos = view.posAtDOM(wrap);
    if (view.state.sliceDoc(pos, pos + this.raw.length) !== this.raw) return;
    const next = withWidth(this.raw, width, this.inTable);
    if (next === this.raw) return;
    view.dispatch({
      changes: { from: pos, to: pos + this.raw.length, insert: next },
      userEvent: "input",
    });
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image cm-lp-embed";
    // Until the image is found, and when it is not, the embed shows as written.
    wrap.textContent = this.raw;
    void findImage(this.embed.target.trim(), this.from).then((path) => {
      if (path) this.show(view, wrap, path);
    });
    return wrap;
  }

  private show(view: EditorView, wrap: HTMLElement, path: string) {
    wrap.textContent = "";
    wrap.classList.remove("cm-lp-embed");
    const img = document.createElement("img");
    img.src = imageUrl(path, 640);
    img.alt = this.embed.target;
    img.draggable = false;
    if (this.embed.width !== null) img.style.width = `${this.embed.width}px`;
    img.addEventListener("load", () => view.requestMeasure());
    wrap.append(img);
    if (view.state.readOnly || !this.embed.sizable) return;

    const handle = document.createElement("span");
    handle.className = "cm-lp-image-handle";
    handle.title = "Drag to set the width. Double-tap to use the image's own width.";
    handle.setAttribute("aria-hidden", "true");
    wrap.append(handle);

    let lastTap = 0;
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      // Keeps the cursor where it is, and the page from scrolling under a finger.
      down.preventDefault();
      down.stopPropagation();
      handle.setPointerCapture(down.pointerId);
      const start = img.getBoundingClientRect().width;
      const max = room(wrap, view);
      const before = img.style.width;
      let width = start;
      let moved = false;
      wrap.classList.add("cm-lp-image-dragging");

      const move = (e: PointerEvent) => {
        const dx = e.clientX - down.clientX;
        if (Math.abs(dx) > 3) moved = true;
        if (!moved) return;
        width = clampWidth(start + dx, max);
        img.style.width = `${width}px`;
      };
      const end = (e: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        wrap.classList.remove("cm-lp-image-dragging");
        if (e.type === "pointercancel") {
          img.style.width = before;
        } else if (moved) {
          this.write(view, wrap, width);
        } else if (e.timeStamp - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          this.write(view, wrap, null);
        } else {
          lastTap = e.timeStamp;
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });

    if (this.embed.width !== null) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "cm-lp-image-reset";
      reset.textContent = "↺";
      reset.title = "Use the image's own width";
      reset.setAttribute("aria-label", "Use the image's own width");
      // Keeps the cursor in the text, and the phone keyboard as it is.
      reset.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      reset.addEventListener("click", (e) => {
        e.preventDefault();
        this.write(view, wrap, null);
      });
      wrap.append(reset);
    }
  }

  /** The handle and the reset button are the widget's own; a tap on the image moves the cursor. */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as Element | null;
    return !!target?.closest?.(".cm-lp-image-handle, .cm-lp-image-reset");
  }
}
