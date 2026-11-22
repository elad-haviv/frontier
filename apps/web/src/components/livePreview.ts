/**
 * Live preview: on every line except the one being edited, Markdown marks are hidden and the text
 * is shown as it will read, in the reading font, and image embeds as their images. The
 * frontmatter folds into one line that opens the Properties panel. Showing never changes the
 * document; only dragging an image's edge does, and then only that embed's text (see
 * imageWidget.ts).
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, Facet, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { readFrontmatter } from "@frontier/vault";
import { readImageEmbed } from "./embedWidth.ts";
import { ImageWidget, notePath } from "./imageWidget.ts";
import { isRow } from "./tableEdit.ts";

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });

const HEADING = /^(#{1,6})[ \t]+/;
const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const STRONG = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const EM = /(?<![*\w])(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1(?![*\w])/g;
const CODE = /(`+)[^`\n]+?\1/g;

function inCode(view: EditorView, pos: number): boolean {
  for (
    let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(
      pos,
      1,
    );
    node;
  ) {
    if (/Code/.test(node.name)) return true;
    node = node.parent as { name: string; parent: unknown } | null;
  }
  return false;
}

/** The end of the frontmatter block, or 0 when the note has none. */
export function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    if (doc.line(n).text.trim() === "---") return doc.line(n).to;
  }
  return 0;
}

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) active.add(n);
  }
  const skipUntil = frontmatterEnd(state);

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.to <= skipUntil || line.length === 0) continue;
      // Code and tables keep the fixed-width font, so code reads as code and columns line up.
      if (inCode(view, line.from)) {
        out.push(Decoration.line({ class: "cm-lp-code" }).range(line.from));
        continue;
      }
      if (isRow(line.text)) out.push(Decoration.line({ class: "cm-lp-table" }).range(line.from));

      const h = HEADING.exec(line.text);
      if (h) {
        out.push(Decoration.line({ class: `cm-lp-h cm-lp-h${h[1]!.length}` }).range(line.from));
        if (!active.has(line.number)) out.push(hide.range(line.from, line.from + h[0].length));
      }
      if (active.has(line.number)) continue;

      const taken: [number, number][] = [];
      const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);

      CODE.lastIndex = 0;
      for (let m: RegExpExecArray | null; (m = CODE.exec(line.text));) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        taken.push([start, end]);
        out.push(mark("cm-lp-icode").range(start, end));
      }

      WIKI.lastIndex = 0;
      for (let m: RegExpExecArray | null; (m = WIKI.exec(line.text));) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (inCode(view, start)) continue;
        taken.push([start, end]);
        const open = start + m[1]!.length + 2;
        const inner = m[2]!;
        const pipe = /\\?\|/.exec(inner);
        const shownFrom = pipe ? open + pipe.index + pipe[0].length : open;
        if (m[1] === "!") {
          const image = readImageEmbed(m[0]);
          const from = state.facet(notePath);
          if (image && from) {
            const widget = new ImageWidget(m[0], image, from, isRow(line.text));
            out.push(Decoration.replace({ widget }).range(start, end));
            continue;
          }
          out.push(mark("cm-lp-embed").range(start, end));
          continue;
        }
        if (shownFrom === end - 2) continue;
        out.push(hide.range(start, shownFrom));
        out.push(mark("cm-lp-link").range(shownFrom, end - 2));
        out.push(hide.range(end - 2, end));
      }

      for (const [re, cls] of [
        [STRONG, "cm-lp-strong"],
        [EM, "cm-lp-em"],
      ] as const) {
        re.lastIndex = 0;
        for (let m: RegExpExecArray | null; (m = re.exec(line.text));) {
          const start = line.from + m.index;
          const end = start + m[0].length;
          const len = m[1]!.length;
          if (!free(start, end) || inCode(view, start)) continue;
          taken.push([start, end]);
          out.push(hide.range(start, start + len));
          out.push(mark(cls).range(start + len, end - len));
          out.push(hide.range(end - len, end));
        }
      }
    }
  }
  return Decoration.set(out, true);
}

const marks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Called when the folded frontmatter line is chosen, to open the Properties panel. */
export const openProperties = Facet.define<() => void, (() => void) | null>({
  combine: (values) => values[0] ?? null,
});

/** "Properties: 2 aliases, type", from the frontmatter's keys. */
export function propertiesSummary(data: Record<string, unknown>): string {
  const parts = Object.entries(data).map(([key, value]) =>
    Array.isArray(value) ? `${value.length} ${key}` : key,
  );
  return parts.length ? `Properties: ${parts.join(", ")}` : "Properties";
}

class PropertiesWidget extends WidgetType {
  constructor(readonly summary: string) {
    super();
  }
  override eq(other: PropertiesWidget) {
    return other.summary === this.summary;
  }
  toDOM(view: EditorView) {
    const line = document.createElement("div");
    line.className = "cm-lp-props";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = this.summary;
    button.title = "Open the Properties panel";
    // A press must not move the editor's cursor into the hidden lines, which would unfold them.
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => view.state.facet(openProperties)?.());
    line.append(button);
    return line;
  }
}

function frontmatterDecorations(state: EditorState): DecorationSet {
  const end = frontmatterEnd(state);
  if (end === 0) return Decoration.none;
  const touched = state.selection.ranges.some((r) => r.from <= end);
  const { data, error } = readFrontmatter(state.sliceDoc(0, end));
  // While the cursor is in it, or when it cannot be read, the frontmatter shows as written, in
  // the fixed-width font, so it can be corrected by hand.
  if (touched || error || !data) {
    const lines: Range<Decoration>[] = [];
    for (let n = 1; n <= state.doc.lineAt(end).number; n++) {
      lines.push(Decoration.line({ class: "cm-lp-fm" }).range(state.doc.line(n).from));
    }
    return Decoration.set(lines);
  }
  return Decoration.set([
    Decoration.replace({
      widget: new PropertiesWidget(propertiesSummary(data)),
      block: true,
    }).range(0, end),
  ]);
}

/** Folding lines away must be done from the state, not from a view plugin. */
const frontmatterFold = StateField.define<DecorationSet>({
  create: frontmatterDecorations,
  update: (decorations, tr) =>
    tr.docChanged || tr.selection ? frontmatterDecorations(tr.state) : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

export const livePreview = [
  marks,
  frontmatterFold,
  EditorView.editorAttributes.of({ class: "cm-reading" }),
];
