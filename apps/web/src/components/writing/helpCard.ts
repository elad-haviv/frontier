/**
 * Writing help's place in the text (stage 17): the passage it works on, highlighted, and a card
 * right under it, in the flow of the text. The passage moves with typing, so the card follows it;
 * the card itself is drawn by React (HelpCard.tsx) into an element this widget only holds, so it
 * keeps what it shows when CodeMirror draws the widget again.
 */
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** A comment for the AI whose suggestion the card shows, instead of one asked for in the card. */
export interface HelpComment {
  id: string;
  text: string;
}

export interface Help {
  /** New for each time help is opened, so the card starts afresh. */
  id: number;
  from: number;
  to: number;
  comment: HelpComment | null;
  /** Raised to put the focus back in the card's box. */
  focus: number;
}

export const openHelp = StateEffect.define<{
  from: number;
  to: number;
  comment?: HelpComment | null;
}>();
export const closeHelp = StateEffect.define<null>();
export const focusHelp = StateEffect.define<null>();

let counter = 0;

/** Where help is open, if it is: the range is mapped through every change to the text. */
export const helpField = StateField.define<Help | null>({
  create: () => null,
  update(help, tr) {
    let next = help;
    if (next && tr.docChanged) {
      // Text typed at either edge stays outside the passage; text typed inside is part of it.
      const from = tr.changes.mapPos(next.from, 1);
      const to = Math.max(from, tr.changes.mapPos(next.to, -1));
      // A passage deleted whole has nothing left to help with.
      next = to > from || next.to === next.from ? { ...next, from, to } : null;
    }
    for (const e of tr.effects) {
      if (e.is(openHelp)) {
        next = {
          id: ++counter,
          from: e.value.from,
          to: e.value.to,
          comment: e.value.comment ?? null,
          focus: 0,
        };
      } else if (e.is(closeHelp)) next = null;
      else if (e.is(focusHelp) && next) next = { ...next, focus: next.focus + 1 };
    }
    return next;
  },
  // Given directly, not through a function: a block widget changes the height of the text.
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => {
      const help = state.field(f);
      return help ? decorations(state, help) : Decoration.none;
    }),
});

const passageMark = Decoration.mark({ class: "cm-help-passage" });

function decorations(state: EditorState, help: Help): DecorationSet {
  const end = state.doc.lineAt(help.to).to;
  const card = Decoration.widget({ widget: new CardWidget(help.id), block: true, side: 1 });
  return Decoration.set(
    help.to > help.from
      ? [passageMark.range(help.from, help.to), card.range(end)]
      : [card.range(end)],
    true,
  );
}

/** The elements the card is drawn into, one per time help is opened, kept while it is open. */
const hosts = new Map<number, HTMLElement>();

export function hostFor(id: number): HTMLElement {
  let host = hosts.get(id);
  if (!host) {
    host = document.createElement("div");
    host.className = "help-card-host";
    hosts.set(id, host);
  }
  return host;
}

export function dropHost(id: number): void {
  hosts.delete(id);
}

class CardWidget extends WidgetType {
  constructor(readonly id: number) {
    super();
  }

  override eq(other: CardWidget): boolean {
    return other.id === this.id;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-help-widget";
    const host = hostFor(this.id);
    wrap.appendChild(host);
    // The card grows as React fills it; the editor measures its lines again.
    const watch = new ResizeObserver(() => view.requestMeasure());
    watch.observe(host);
    (wrap as HTMLElement & { stopWatching?: () => void }).stopWatching = () => watch.disconnect();
    return wrap;
  }

  override destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { stopWatching?: () => void }).stopWatching?.();
  }

  // The card's box and buttons are its own: the editor leaves their keys and clicks alone.
  override ignoreEvent(): boolean {
    return true;
  }
}

type Listener = (help: Help | null, view: EditorView) => void;
const listeners = new WeakMap<EditorView, Set<Listener>>();

/** Tells the page when help opens, closes, moves, or the text changes while it is open. */
export function watchHelp(view: EditorView, listener: Listener): () => void {
  let set = listeners.get(view);
  if (!set) listeners.set(view, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
}

const notifier = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      const before = u.startState.field(helpField, false);
      const now = u.state.field(helpField, false);
      if (before === now && !(now && u.docChanged)) return;
      for (const l of listeners.get(u.view) ?? []) l(now ?? null, u.view);
    }
  },
);

/** The editor extension: the field, its highlight and card, and the page's listeners. */
export const helpCard = [helpField, notifier];

/** The passage help works on: the selection, or else the paragraph the cursor is in. */
export function passageOf(state: EditorState): { from: number; to: number; text: string } {
  const { from, to } = state.selection.main;
  if (from !== to) return { from, to, text: state.sliceDoc(from, to) };
  const doc = state.doc;
  let first = doc.lineAt(from);
  let last = first;
  // A paragraph ends at an empty line or a heading; a heading is a passage of its own.
  const ends = (text: string) => text.trim() === "" || /^#{1,6}\s/.test(text);
  if (!ends(first.text)) {
    while (first.number > 1 && !ends(doc.line(first.number - 1).text)) {
      first = doc.line(first.number - 1);
    }
    while (last.number < doc.lines && !ends(doc.line(last.number + 1).text)) {
      last = doc.line(last.number + 1);
    }
  }
  return { from: first.from, to: last.to, text: state.sliceDoc(first.from, last.to) };
}

/**
 * Opens help on the selection or the cursor's paragraph. Asked again on the passage it is open
 * on, it puts the focus back in the card's box instead of starting over.
 */
export function startHelp(view: EditorView): void {
  const open = view.state.field(helpField, false) ?? null;
  const at = passageOf(view.state);
  const { from, to } = view.state.selection.main;
  const same =
    open !== null &&
    (from === to ? from >= open.from && from <= open.to : from === open.from && to === open.to);
  if (same) {
    view.dispatch({ effects: focusHelp.of(null) });
    return;
  }
  // On an empty line there is no passage; the card still opens, to say what to do.
  view.dispatch({ effects: openHelp.of({ from: at.from, to: at.to }), scrollIntoView: true });
}
