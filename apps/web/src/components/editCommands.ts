import {
  ChangeSet,
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Text,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Text commands shared by the toolbar, the right-click menu and the editor's keys, so Ctrl+B and
 * the Bold button do exactly the same thing. Each is written as a function of the editor's state
 * that answers the change to make, so it can be tested without a view; `run` makes it in a view.
 * A command answers null when it does not apply, so a key can fall through to what it means
 * elsewhere.
 */

const rangeOf = (anchor: number, head = anchor) => EditorSelection.range(anchor, head);

/** A change to make, in one undo step. */
export interface Edit {
  changes: ChangeSet;
  selection: EditorState["selection"];
}

/** Makes an edit in the view and gives the text the focus back. False when there was none. */
export function run(view: EditorView, edit: Edit | null): boolean {
  if (!edit || view.state.readOnly) return false;
  view.dispatch({ ...edit, scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

/** A command for a keymap: the edit, or nothing so the key falls through. */
export const command =
  (make: (state: EditorState) => Edit | null) =>
  (view: EditorView): boolean =>
    run(view, make(view.state));

/** Changes, with the selection carried along: a cursor at an insertion moves past it. */
function edit(state: EditorState, specs: ChangeSpec | ChangeSet): Edit {
  const changes = specs instanceof ChangeSet ? specs : state.changes(specs);
  return { changes, selection: state.selection.map(changes, 1) };
}

/** The lines the selection touches, from first to last. */
function selectedLines(state: EditorState) {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
  return lines;
}

// ---- Block styles ------------------------------------------------------------------------------

export type BlockStyle = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";

/** The styles the style picker offers, in its order, with their names. */
export const BLOCK_STYLES: { style: BlockStyle; label: string; shortcut?: string }[] = [
  { style: "paragraph", label: "Paragraph", shortcut: "editor.paragraph" },
  { style: "h1", label: "Heading 1", shortcut: "editor.heading1" },
  { style: "h2", label: "Heading 2", shortcut: "editor.heading2" },
  { style: "h3", label: "Heading 3", shortcut: "editor.heading3" },
  { style: "h4", label: "Heading 4", shortcut: "editor.heading4" },
  { style: "h5", label: "Heading 5", shortcut: "editor.heading5" },
  { style: "h6", label: "Heading 6", shortcut: "editor.heading6" },
  { style: "quote", label: "Quote" },
  { style: "code", label: "Code block" },
];

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+/;
const QUOTE = /^ {0,3}>[ \t]?/;
/** What a line starts with that a block style puts there: a heading's or a quote's mark. */
const BLOCK_MARK = /^ {0,3}(?:#{1,6}[ \t]+|>[ \t]?)/;

/** The fenced code block around a line: its opening and closing line numbers, or null. */
export function fenceAround(
  doc: Text,
  line: number,
): { open: number; close: number | null } | null {
  let open: number | null = null;
  let mark = "";
  for (let n = 1; n <= doc.lines; n++) {
    const m = FENCE.exec(doc.line(n).text);
    if (open === null) {
      if (m) [open, mark] = [n, m[1]!];
    } else if (m && m[1]![0] === mark[0] && m[1]!.length >= mark.length) {
      if (line >= open && line <= n) return { open, close: n };
      open = null;
    }
    if (open === null && n >= line) return null;
  }
  return open !== null ? { open, close: null } : null;
}

/** The style of the line the cursor is on, for the style picker to show. */
export function lineStyle(state: EditorState): BlockStyle {
  const line = state.doc.lineAt(state.selection.main.head);
  if (fenceAround(state.doc, line.number)) return "code";
  const heading = HEADING.exec(line.text);
  if (heading) return `h${heading[1]!.length}` as BlockStyle;
  return QUOTE.test(line.text) ? "quote" : "paragraph";
}

/**
 * Gives the selected lines a block style. A heading or quote replaces the mark a line had; a code
 * block puts fences around the lines, and any other style takes the fences of the block the
 * cursor is in away again.
 */
export function setBlockStyle(state: EditorState, style: BlockStyle): Edit | null {
  const { doc } = state;
  const lines = selectedLines(state);
  const fence = fenceAround(doc, lines[0]!.number);
  if (style === "code") {
    if (fence) return null;
    const first = lines[0]!;
    const last = lines[lines.length - 1]!;
    const changes = state.changes([
      { from: first.from, insert: "```\n" },
      { from: last.to, insert: "\n```" },
    ]);
    // The selection stays on the text, now inside the fences.
    return { changes, selection: state.selection.map(changes, 1) };
  }
  const specs: ChangeSpec[] = [];
  let inner = lines;
  if (fence) {
    const open = doc.line(fence.open);
    specs.push({ from: open.from, to: Math.min(open.to + 1, doc.length) });
    inner = [];
    const end = fence.close ?? doc.lines + 1;
    for (let n = fence.open + 1; n < end; n++) inner.push(doc.line(n));
    if (fence.close === fence.open + 1) {
      // An empty block goes altogether.
      specs[0] = { from: open.from, to: doc.line(fence.close).to };
    } else if (fence.close !== null) {
      const close = doc.line(fence.close);
      specs.push({ from: close.from - 1, to: close.to });
    }
  }
  const mark = style === "quote" ? "> " : style === "paragraph" ? "" : "#".repeat(+style[1]!) + " ";
  for (const line of inner) {
    // Blank lines between headings stay blank; a quote keeps its blank lines inside it.
    if (line.text.trim() === "" && style !== "quote" && inner.length > 1) continue;
    const old = fence ? 0 : (BLOCK_MARK.exec(line.text)?.[0].length ?? 0);
    if (line.text.slice(0, old) === mark) continue;
    specs.push({ from: line.from, to: line.from + old, insert: mark });
  }
  return specs.length ? edit(state, specs) : null;
}

// ---- Inline marks ------------------------------------------------------------------------------

export type InlineMark = "bold" | "italic" | "strike" | "underline" | "code";

export const INLINE_MARKS: Record<InlineMark, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  underline: ["<u>", "</u>"],
  code: ["`", "`"],
};

/** How many of one character run back from `at`, or forward from it. */
function run_(doc: Text, at: number, step: -1 | 1, char: string): number {
  let n = 0;
  for (let i = at; ; i += step) {
    const pos = step === -1 ? i - 1 : i;
    if (pos < 0 || pos >= doc.length || doc.sliceString(pos, pos + 1) !== char) return n;
    n++;
  }
}

/**
 * Whether a mark already wraps [from, to] from outside. Bold and italic share the asterisk: two
 * or more on both sides is bold, an odd number is italic, so `***x***` is both.
 */
function wrapsOutside(doc: Text, from: number, to: number, mark: InlineMark): boolean {
  const [before, after] = INLINE_MARKS[mark];
  if (mark === "bold" || mark === "italic") {
    const stars = Math.min(run_(doc, from, -1, "*"), run_(doc, to, 1, "*"));
    return mark === "bold" ? stars >= 2 : stars % 2 === 1;
  }
  return (
    from >= before.length &&
    doc.sliceString(from - before.length, from) === before &&
    doc.sliceString(to, to + after.length) === after
  );
}

/** The same, for marks just inside the ends of [from, to]. */
function wrapsInside(doc: Text, from: number, to: number, mark: InlineMark): boolean {
  const [before, after] = INLINE_MARKS[mark];
  if (to - from < before.length + after.length) return false;
  if (mark === "bold" || mark === "italic") {
    const text = doc.sliceString(from, to);
    const lead = /^\**/.exec(text)![0].length;
    const trail = /\**$/.exec(text)![0].length;
    const stars = Math.min(lead, trail);
    if (lead === text.length) return false;
    return mark === "bold" ? stars >= 2 : stars % 2 === 1;
  }
  return (
    doc.sliceString(from, from + before.length) === before &&
    doc.sliceString(to - after.length, to) === after
  );
}

/**
 * Puts a mark around the selection, or around the word at the cursor; when the mark is already
 * there, takes it away. With no selection and no word, the cursor goes between the two halves.
 */
export function toggleInline(state: EditorState, mark: InlineMark): Edit {
  const { doc } = state;
  const [before, after] = INLINE_MARKS[mark];
  const range = state.selection.main;
  const word = range.empty ? state.wordAt(range.head) : null;
  const from = word?.from ?? range.from;
  const to = word?.to ?? range.to;
  if (wrapsOutside(doc, from, to, mark)) {
    return edit(state, [
      { from: from - before.length, to: from },
      { from: to, to: to + after.length },
    ]);
  }
  if (!range.empty && wrapsInside(doc, from, to, mark)) {
    const changes = state.changes([
      { from, to: from + before.length },
      { from: to - after.length, to },
    ]);
    return {
      changes,
      selection: state.selection.replaceRange(rangeOf(from, to - before.length - after.length)),
    };
  }
  const changes = state.changes([
    { from, insert: before },
    { from: to, insert: after },
  ]);
  const shift = before.length;
  return {
    changes,
    selection: state.selection.replaceRange(
      word ? rangeOf(range.head + shift) : rangeOf(range.anchor + shift, range.head + shift),
    ),
  };
}

// ---- Lists ---------------------------------------------------------------------------------

export type ListKind = "bullet" | "numbered" | "task";

const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;

interface Item {
  indent: number;
  kind: ListKind;
  /** The marker and the spaces after it, without a task's box: what a nested item indents by. */
  width: number;
  /** The whole prefix, box included. */
  length: number;
  number: number | null;
}

function itemOf(text: string): Item | null {
  const m = ITEM.exec(text);
  if (!m) return null;
  const numbered = /\d/.test(m[2]!);
  return {
    indent: m[1]!.length,
    kind: numbered ? "numbered" : m[4] ? "task" : "bullet",
    width: m[2]!.length + m[3]!.length,
    length: m[0].length,
    number: numbered ? Number.parseInt(m[2]!, 10) : null,
  };
}

const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].length;

/**
 * Makes the selected lines items of one kind of list, or plain lines again when they all are.
 * Numbers count on from a numbered item just above.
 */
export function toggleList(state: EditorState, kind: ListKind): Edit {
  const { doc } = state;
  const lines = selectedLines(state).filter((l) => l.text.trim() !== "");
  const targets = lines.length ? lines : [doc.lineAt(state.selection.main.head)];
  const specs: ChangeSpec[] = [];
  if (targets.every((l) => itemOf(l.text)?.kind === kind)) {
    for (const line of targets) {
      const item = itemOf(line.text)!;
      specs.push({ from: line.from + item.indent, to: line.from + item.length });
    }
    return renumbered(state, state.changes(specs), targets[0]!.number);
  }
  const above = targets[0]!.number > 1 ? itemOf(doc.line(targets[0]!.number - 1).text) : null;
  let n = above?.number != null && kind === "numbered" ? above.number + 1 : 1;
  for (const line of targets) {
    const item = itemOf(line.text);
    const indent = item?.indent ?? indentOf(line.text);
    const marker = kind === "numbered" ? `${n++}. ` : kind === "task" ? "- [ ] " : "- ";
    specs.push({
      from: line.from + indent,
      to: line.from + (item?.length ?? indent),
      insert: marker,
    });
  }
  return renumbered(state, state.changes(specs), targets[0]!.number);
}

/**
 * The numbers of a numbered list counted again after a change: each run of items at one depth
 * counts up from its first, which keeps its number at the top of the list and is 1 when nested.
 */
function renumbered(state: EditorState, first: ChangeSet, around: number): Edit {
  const doc = first.apply(state.doc);
  const line = Math.min(around, doc.lines);
  // The list around the line: items, and the indented lines between them.
  const belongs = (n: number) => {
    const text = doc.line(n).text;
    return itemOf(text) !== null || (text.trim() !== "" && indentOf(text) > 0);
  };
  let start = line;
  while (start > 1 && belongs(start - 1)) start--;
  let end = line;
  while (end < doc.lines && belongs(end + 1)) end++;
  const runs: { indent: number; next: number | null }[] = [];
  const specs: ChangeSpec[] = [];
  for (let n = start; n <= end; n++) {
    const text = doc.line(n).text;
    const item = itemOf(text);
    if (!item) continue;
    while (runs.length && runs[runs.length - 1]!.indent > item.indent) runs.pop();
    let top = runs[runs.length - 1];
    if (top && top.indent === item.indent && (top.next === null) !== (item.number === null)) {
      runs.pop();
      top = undefined;
    }
    if (!top || top.indent < item.indent) {
      top = {
        indent: item.indent,
        next: item.number === null ? null : runs.length ? 1 : item.number,
      };
      runs.push(top);
    }
    if (item.number === null || top.next === null) continue;
    const want = top.next++;
    if (want !== item.number) {
      const from = doc.line(n).from + item.indent;
      specs.push({ from, to: from + String(item.number).length, insert: String(want) });
    }
  }
  const changes = first.compose(ChangeSet.of(specs, doc.length));
  return { changes, selection: state.selection.map(changes, 1) };
}

/** The lines that move with an item: it, and the deeper lines below it. */
function withChildren(doc: Text, first: number, last: number, indent: number): number[] {
  const out: number[] = [];
  for (let n = first; n <= last; n++) out.push(n);
  for (let n = last + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (text.trim() === "") {
      // A blank line belongs to the item only when deeper text follows it.
      const next = n < doc.lines ? doc.line(n + 1).text : "";
      if (next.trim() === "" || indentOf(next) <= indent) break;
      continue;
    }
    if (indentOf(text) <= indent) break;
    out.push(n);
  }
  return out;
}

/** Moves lines sideways by `delta` spaces, never past their start. */
function shift(doc: Text, numbers: number[], delta: number): ChangeSpec[] {
  return numbers.flatMap((n): ChangeSpec[] => {
    const line = doc.line(n);
    if (line.text.trim() === "") return [];
    if (delta > 0) return [{ from: line.from, insert: " ".repeat(delta) }];
    return [{ from: line.from, to: line.from + Math.min(-delta, indentOf(line.text)) }];
  });
}

/**
 * Tab in a list: the item goes under the item above it, indented by that item's marker ("- " is
 * 2, "1. " is 3). The first item of a list cannot go under anything and stays. Null outside a
 * list, so Tab indents as it does elsewhere.
 */
export function indentListItem(state: EditorState): Edit | null {
  const { doc } = state;
  const lines = selectedLines(state);
  const item = itemOf(lines[0]!.text);
  if (!item) return null;
  let sibling: Item | null = null;
  for (let n = lines[0]!.number - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    const above = itemOf(text);
    if (above && above.indent <= item.indent) {
      if (above.indent === item.indent) sibling = above;
      break;
    }
    if (!above && text.trim() !== "" && indentOf(text) === 0) break;
  }
  if (!sibling) return { changes: state.changes([]), selection: state.selection };
  const delta = sibling.indent + sibling.width - item.indent;
  const moving = withChildren(doc, lines[0]!.number, lines[lines.length - 1]!.number, item.indent);
  return renumbered(state, state.changes(shift(doc, moving, delta)), lines[0]!.number);
}

/** Shift+Tab in a list: the item comes out to the depth of the item it was under. */
export function outdentListItem(state: EditorState): Edit | null {
  const { doc } = state;
  const lines = selectedLines(state);
  const item = itemOf(lines[0]!.text);
  if (!item) return null;
  if (item.indent === 0) return { changes: state.changes([]), selection: state.selection };
  let parent = 0;
  for (let n = lines[0]!.number - 1; n >= 1; n--) {
    const above = itemOf(doc.line(n).text);
    if (above && above.indent < item.indent) {
      parent = above.indent;
      break;
    }
  }
  const moving = withChildren(doc, lines[0]!.number, lines[lines.length - 1]!.number, item.indent);
  return renumbered(
    state,
    state.changes(shift(doc, moving, parent - item.indent)),
    lines[0]!.number,
  );
}

// ---- Inserting ---------------------------------------------------------------------------------

/** Text put in at the cursor, in place of the selection, with the cursor after it. */
export function insertText(state: EditorState, text: string): Edit {
  const { from, to } = state.selection.main;
  const changes = state.changes({ from, to, insert: text });
  return { changes, selection: state.selection.replaceRange(rangeOf(from + text.length)) };
}

/**
 * A horizontal rule on a line of its own, with a blank line above it: under a line of text,
 * "---" would make that line a heading.
 */
export function insertRule(state: EditorState): Edit {
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.text.trim() === "") {
    const above = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : "";
    const insert = `${above === "" ? "" : "\n"}---\n`;
    const changes = state.changes({ from: line.from, to: line.to, insert });
    return {
      changes,
      selection: state.selection.replaceRange(rangeOf(line.from + insert.length)),
    };
  }
  const insert = "\n\n---\n";
  const changes = state.changes({ from: line.to, insert });
  return { changes, selection: state.selection.replaceRange(rangeOf(line.to + insert.length)) };
}

/**
 * A link to an entry at the cursor. With words selected, they stay as what the link shows:
 * `[[name|words]]`.
 */
export function insertLink(state: EditorState, name: string): Edit {
  const { from, to } = state.selection.main;
  const words = state.sliceDoc(from, to).trim();
  return insertText(state, words && words !== name ? `[[${name}|${words}]]` : `[[${name}]]`);
}

/** Image embeds at the cursor, one per line. */
export function insertEmbeds(state: EditorState, names: string[]): Edit {
  return insertText(state, names.map((n) => `![[${n}]]`).join("\n"));
}

/** What an embed or a link names a file by: its name when no other file has it, else its path. */
export function linkName(path: string, others: Iterable<string>, keepExtension: boolean): string {
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.md$/i, "");
  const key = stem.toLowerCase();
  let count = 0;
  for (const p of others) {
    if ((p.split("/").pop() ?? p).replace(/\.md$/i, "").toLowerCase() === key) count++;
  }
  const unique = count <= 1;
  if (keepExtension) return unique ? base : path;
  return unique ? stem : path.replace(/\.md$/i, "");
}
