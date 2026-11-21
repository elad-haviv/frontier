/**
 * Live preview: on every line except the one being edited, Markdown marks are hidden and the text
 * is shown as it will read. The document itself is never changed; this only affects how it looks.
 */
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });

const HEADING = /^(#{1,6})[ \t]+/;
const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const STRONG = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const EM = /(?<![*\w])(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1(?![*\w])/g;

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
function frontmatterEnd(view: EditorView): number {
  const doc = view.state.doc;
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
  const skipUntil = frontmatterEnd(view);

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.to <= skipUntil || line.length === 0 || inCode(view, line.from)) continue;

      const h = HEADING.exec(line.text);
      if (h) {
        out.push(Decoration.line({ class: `cm-lp-h cm-lp-h${h[1]!.length}` }).range(line.from));
        if (!active.has(line.number)) out.push(hide.range(line.from, line.from + h[0].length));
      }
      if (active.has(line.number)) continue;

      const taken: [number, number][] = [];
      const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);

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

export const livePreview = ViewPlugin.fromClass(
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
