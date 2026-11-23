/**
 * Every keyboard shortcut Frontier binds is declared here once: its id, keys, scope and label.
 * One document listener runs the shortcut of the innermost active scope, the editor's keys are
 * built into a CodeMirror keymap from the same list, and the "?" sheet and the tooltips read
 * their words from it, so what the sheet says is what the keys do.
 *
 * Keys are written as CodeMirror writes them: "Mod-b", "Shift-Mod-z", "Escape", "?". Mod is Cmd
 * on a Mac and Ctrl elsewhere.
 */
import { indentLess, indentMore } from "@codemirror/commands";
import { Prec, type Extension } from "@codemirror/state";
import { type Command, keymap, type KeyBinding } from "@codemirror/view";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  type BlockStyle,
  command,
  indentListItem,
  outdentListItem,
  setBlockStyle,
  toggleInline,
  toggleList,
} from "./components/editCommands.ts";
import { nextCell, previousCell, tableCommand } from "./components/tableKeys.ts";

/**
 * Where a shortcut applies, from the outside in. When two bound shortcuts share keys, the one
 * of the later scope in this list wins: a dialog over a page, a table inside the editor.
 */
export const SCOPES = ["app", "chronicle", "map", "editor", "table", "dialog"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_NAMES: Record<Scope, string> = {
  app: "Everywhere",
  chronicle: "Chronicle",
  map: "Map",
  editor: "Editor",
  table: "In a table",
  dialog: "Dialogs and menus",
};

export interface Shortcut {
  id: string;
  /** One or more ways to press it; the first is the one shown in tooltips. */
  keys: string[];
  scope: Scope;
  label: string;
  /**
   * Set when Frontier does not run the key itself: a control or a library handles it (a dialog,
   * the switcher, a menu). Such entries are listed in the sheet so it is complete, and are never
   * run by the listener.
   */
  handledBy?: string;
}

type Action = () => boolean | void;

interface Binding {
  action: { current: Action };
  /** Later bindings of the same shortcut win, so a nested page can take a key over. */
  order: number;
}

/** The smallest shape of a key event the registry needs, so tests need no browser. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  preventDefault?: () => void;
}

const passed = new WeakSet<object>();

/**
 * Marks a key as passed on: something used it on the way (a tooltip closed on Escape) but it
 * should still do what it does on the page, so one Escape closes the tooltip and the lightbox.
 */
export function passOn(e: object): void {
  passed.add(e);
}

/** Whether a key is still free: not used yet, or used only by something that passed it on. */
export function isFree(e: { defaultPrevented?: boolean }): boolean {
  return !e.defaultPrevented || passed.has(e);
}

const MODIFIERS = new Set(["mod", "ctrl", "cmd", "meta", "alt", "shift"]);

function parse(spec: string) {
  // "Mod--" would be a minus; no shortcut here needs one, so a plain split is enough.
  const parts = spec.split("-");
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) if (!MODIFIERS.has(m)) throw new Error(`Unknown modifier in "${spec}"`);
  return {
    key,
    mod: mods.has("mod") || mods.has("ctrl") || mods.has("cmd") || mods.has("meta"),
    alt: mods.has("alt"),
    shift: mods.has("shift"),
  };
}

/**
 * Whether a key press is this key. Ctrl and Cmd both count as Mod, as the switcher always
 * allowed. A letter compares without case and needs Shift only when asked for; a sign such as
 * "?" ignores Shift, since some keyboards need it to type the sign at all.
 */
export function matches(spec: string, e: KeyPress): boolean {
  const want = parse(spec);
  const letter = /^[a-z]$/i.test(want.key);
  const key = letter ? e.key.toLowerCase() === want.key.toLowerCase() : e.key === want.key;
  if (!key) return false;
  if (want.mod !== (e.ctrlKey || e.metaKey)) return false;
  if (want.alt !== e.altKey) return false;
  if ((letter || want.key.length > 1) && want.shift !== e.shiftKey) return false;
  return true;
}

/** Whether keys typed here are text: an input, a text area, a list, or editable content. */
export function isTyping(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as { tagName?: string; isContentEditable?: boolean; type?: string };
  if (t.isContentEditable) return true;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.tagName === "INPUT") {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      t.type ?? "text",
    );
  }
  return false;
}

const onMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_NAMES: Record<string, string> = {
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "Backspace",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Tab: "Tab",
  " ": "Space",
};

/** A key as people read it: "Ctrl+Shift+Z", or "⇧⌘Z" on a Mac. */
export function displayKey(spec: string, mac = onMac()): string {
  // Several keys in a row, such as "Escape Tab", read as "Esc then Tab".
  if (spec.includes(" ")) {
    return spec
      .split(" ")
      .map((s) => displayKey(s, mac))
      .join(" then ");
  }
  const { key, mod, alt, shift } = parse(spec);
  const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (mac) return `${shift ? "⇧" : ""}${alt ? "⌥" : ""}${mod ? "⌘" : ""}${name}`;
  return [mod && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
}

export function createRegistry() {
  const shortcuts = new Map<string, Shortcut>();
  const bound = new Map<string, Binding[]>();
  const scopes = new Map<Scope, number>();
  const listeners = new Set<() => void>();
  let counter = 0;
  let version = 0;

  const changed = () => {
    version++;
    for (const l of listeners) l();
  };

  return {
    /** Declares shortcuts. An id is declared once; declaring it again replaces it. */
    register(...list: Shortcut[]) {
      for (const s of list) {
        for (const k of s.keys) if (!k.includes(" ")) parse(k);
        shortcuts.set(s.id, s);
      }
      changed();
    },

    get(id: string): Shortcut | undefined {
      return shortcuts.get(id);
    },

    all(): Shortcut[] {
      return [...shortcuts.values()];
    },

    /** Gives a declared shortcut its action until the returned function is called. */
    bind(id: string, action: { current: Action }): () => void {
      const s = shortcuts.get(id);
      if (!s) throw new Error(`No shortcut "${id}" is declared.`);
      if (s.handledBy) throw new Error(`"${id}" is handled by ${s.handledBy}, not by Frontier.`);
      const binding = { action, order: ++counter };
      bound.set(id, [...(bound.get(id) ?? []), binding]);
      const off = this.enter(s.scope);
      return () => {
        bound.set(
          id,
          (bound.get(id) ?? []).filter((b) => b !== binding),
        );
        off();
      };
    },

    /** Marks a scope as active, so the sheet shows its keys, until the returned function runs. */
    enter(scope: Scope): () => void {
      scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
      changed();
      let left = false;
      return () => {
        if (left) return;
        left = true;
        scopes.set(scope, (scopes.get(scope) ?? 1) - 1);
        changed();
      };
    },

    activeScopes(): Scope[] {
      return SCOPES.filter((s) => s === "app" || (scopes.get(s) ?? 0) > 0);
    },

    /** Runs the action bound to a shortcut, as if its keys were pressed. False when none is. */
    run(id: string): boolean {
      const list = bound.get(id) ?? [];
      const top = list[list.length - 1];
      if (!top) return false;
      return top.action.current() !== false;
    },

    /**
     * Finds and runs the shortcut for a key press. In a typing field only app shortcuts that use
     * a modifier run, so typing "?" in a note types a question mark. Answers whether one ran.
     */
    handle(e: KeyPress): boolean {
      if (!isFree(e)) return false;
      const typing = isTyping(e.target);
      const candidates: { s: Shortcut; b: Binding }[] = [];
      for (const [id, list] of bound) {
        const top = list[list.length - 1];
        const s = shortcuts.get(id);
        if (!top || !s) continue;
        // The editor's own keys are run by CodeMirror, inside the text.
        if (s.scope === "editor" || s.scope === "table") continue;
        if (!s.keys.some((k) => matches(k, e))) continue;
        if (typing && !(s.scope === "app" && (e.ctrlKey || e.metaKey || e.altKey))) continue;
        candidates.push({ s, b: top });
      }
      candidates.sort(
        (x, y) => SCOPES.indexOf(y.s.scope) - SCOPES.indexOf(x.s.scope) || y.b.order - x.b.order,
      );
      for (const { b } of candidates) {
        if (b.action.current() !== false) {
          e.preventDefault?.();
          return true;
        }
      }
      return false;
    },

    /**
     * The sheet: the shortcuts of the active scopes, app first, each group in declared order.
     * The keys that dialogs, menus and lists handle themselves apply wherever one opens, so they
     * are always listed.
     */
    sheet(): { scope: Scope; name: string; items: Shortcut[] }[] {
      const active = new Set(this.activeScopes());
      return SCOPES.map((scope) => ({
        scope,
        name: SCOPE_NAMES[scope],
        items: [...shortcuts.values()].filter(
          (s) => s.scope === scope && (active.has(scope) || (scope === "dialog" && s.handledBy)),
        ),
      })).filter((g) => g.items.length > 0);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    version: () => version,
  };
}

export type Registry = ReturnType<typeof createRegistry>;

/** The app's one registry. */
export const keys = createRegistry();

keys.register(
  // Everywhere
  { id: "app.switcher", keys: ["Mod-k"], scope: "app", label: "Go to an entry" },
  { id: "app.keys", keys: ["?"], scope: "app", label: "Show keyboard shortcuts" },
  {
    id: "app.sidebar",
    keys: ["Mod-\\"],
    scope: "app",
    label: "Fold or unfold the side bar",
  },
  {
    id: "switcher.move",
    keys: ["ArrowDown", "ArrowUp"],
    scope: "app",
    label: "Move through the results of Go to an entry",
    handledBy: "the switcher",
  },
  {
    id: "switcher.open",
    keys: ["Enter"],
    scope: "app",
    label: "Open the chosen result",
    handledBy: "the switcher",
  },

  // The editor. Bold to Done are run by CodeMirror from editorKeymap() below.
  { id: "editor.bold", keys: ["Mod-b"], scope: "editor", label: "Bold" },
  { id: "editor.italic", keys: ["Mod-i"], scope: "editor", label: "Italic" },
  { id: "editor.underline", keys: ["Mod-u"], scope: "editor", label: "Underline" },
  { id: "editor.strike", keys: ["Shift-Mod-x"], scope: "editor", label: "Strikethrough" },
  { id: "editor.numbered", keys: ["Shift-Mod-7"], scope: "editor", label: "Numbered list" },
  { id: "editor.bullets", keys: ["Shift-Mod-8"], scope: "editor", label: "Bullet list" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    id: `editor.heading${n}`,
    keys: [`Shift-Mod-${n}`],
    scope: "editor" as const,
    label: `Heading ${n}`,
  })),
  { id: "editor.paragraph", keys: ["Shift-Mod-0"], scope: "editor", label: "Paragraph" },
  { id: "editor.save", keys: ["Mod-s"], scope: "editor", label: "Save now" },
  { id: "editor.done", keys: ["Mod-Enter"], scope: "editor", label: "Done" },
  {
    id: "editor.indent",
    keys: ["Tab"],
    scope: "editor",
    label: "Indent; in a list, put the item under the one above",
  },
  { id: "editor.outdent", keys: ["Shift-Tab"], scope: "editor", label: "Indent less" },
  {
    id: "editor.undo",
    keys: ["Mod-z"],
    scope: "editor",
    label: "Undo",
    handledBy: "CodeMirror",
  },
  {
    id: "editor.redo",
    keys: ["Shift-Mod-z", "Mod-y"],
    scope: "editor",
    label: "Redo",
    handledBy: "CodeMirror",
  },
  {
    id: "editor.leave",
    keys: ["Escape Tab"],
    scope: "editor",
    label: "Leave the text, to the next control",
    handledBy: "CodeMirror",
  },

  // In a table, inside the editor
  { id: "table.next", keys: ["Tab"], scope: "table", label: "Next cell" },
  { id: "table.previous", keys: ["Shift-Tab"], scope: "table", label: "Previous cell" },
  { id: "table.addRow", keys: ["Mod-Enter"], scope: "table", label: "Add a row below" },
  {
    id: "table.addColumn",
    keys: ["Shift-Mod-Enter"],
    scope: "table",
    label: "Add a column to the right",
  },
  {
    id: "table.deleteRow",
    keys: ["Shift-Mod-Backspace"],
    scope: "table",
    label: "Delete this row",
  },
  {
    id: "table.deleteColumn",
    keys: ["Alt-Mod-Backspace"],
    scope: "table",
    label: "Delete this column",
  },

  // The map
  {
    id: "map.stopFocus",
    keys: ["Escape"],
    scope: "map",
    label: "Stop choosing an area to focus on",
  },
  {
    id: "map.turn",
    keys: ["Enter"],
    scope: "map",
    label: "Turn the map to the typed angle",
    handledBy: "the Turn panel",
  },

  // The chronicle
  { id: "chronicle.undo", keys: ["Mod-z"], scope: "chronicle", label: "Undo" },
  { id: "chronicle.redo", keys: ["Shift-Mod-z"], scope: "chronicle", label: "Redo" },

  // Dialogs, menus and the lists that choose
  { id: "lightbox.close", keys: ["Escape"], scope: "dialog", label: "Close the image" },
  { id: "lightbox.next", keys: ["ArrowRight"], scope: "dialog", label: "Next image" },
  { id: "lightbox.previous", keys: ["ArrowLeft"], scope: "dialog", label: "Previous image" },
  {
    id: "dialog.answer",
    keys: ["Enter"],
    scope: "dialog",
    label: "Answer a question with its main button",
    handledBy: "the question box",
  },
  {
    id: "dialog.cancel",
    keys: ["Escape"],
    scope: "dialog",
    label: "Cancel a question, a menu or a list",
    handledBy: "the question box, menus and lists",
  },
  {
    id: "menu.move",
    keys: ["ArrowDown", "ArrowUp"],
    scope: "dialog",
    label: "Move through a menu or a list",
    handledBy: "menus and lists",
  },
  {
    id: "menu.choose",
    keys: ["Enter", " "],
    scope: "dialog",
    label: "Choose the item in a menu or a list",
    handledBy: "menus and lists",
  },
  {
    id: "properties.commit",
    keys: ["Enter"],
    scope: "editor",
    label: "Keep what was typed in a property",
    handledBy: "the Properties panel",
  },
);

/**
 * Binds an action to a declared shortcut while the component is mounted and `enabled` is true.
 * The newest action is always the one run, without binding again on each render.
 */
export function useShortcut(id: string, action: Action, enabled = true, registry = keys): void {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    if (!enabled) return;
    return registry.bind(id, ref);
  }, [id, enabled, registry]);
}

/** Marks a scope as active while the component is mounted, so the sheet lists its keys. */
export function useScope(scope: Scope, enabled = true, registry = keys): void {
  useEffect(() => {
    if (!enabled) return;
    return registry.enter(scope);
  }, [scope, enabled, registry]);
}

/** Re-renders when shortcuts are declared, bound or released. */
export function useRegistry(registry = keys): Registry {
  useSyncExternalStore(registry.subscribe, registry.version);
  return registry;
}

/** The keys of a shortcut as shown beside its name, or "" when it has none. */
export function shortcutText(id: string | undefined, registry = keys): string {
  const s = id ? registry.get(id) : undefined;
  return s?.keys[0] ? displayKey(s.keys[0]) : "";
}

/** Listens for every key press on the page and runs the matching shortcut. Mount once. */
export function useKeyListener(registry = keys): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void registry.handle(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [registry]);
}

/** The binding of an editor shortcut, run by CodeMirror: the page's action, if one is bound. */
const runBound = (id: string, registry: Registry) => (): boolean => registry.run(id);

/**
 * The editor's keys as a CodeMirror keymap, ahead of CodeMirror's own: table keys first, so Tab
 * moves between cells inside a table and indents elsewhere, and Mod-Enter adds a row in a table
 * and means Done elsewhere. Ctrl+I is italic here, not CodeMirror's "select the parent syntax",
 * and Ctrl+U underline, not "undo the selection".
 */
export function editorKeymap(registry = keys): Extension {
  const key = (id: string) => registry.get(id)!.keys;
  const bind = (id: string, run: Command, extra: { preventDefault?: boolean } = {}): KeyBinding[] =>
    key(id).map((k) => ({ key: k, run, ...extra }));
  const bindings: KeyBinding[] = [
    ...bind("table.next", nextCell),
    ...bind("table.previous", previousCell),
    ...bind("table.addRow", tableCommand("addRow")),
    ...bind("table.addColumn", tableCommand("addColumn")),
    ...bind("table.deleteRow", tableCommand("deleteRow")),
    ...bind("table.deleteColumn", tableCommand("deleteColumn")),
    ...bind(
      "editor.bold",
      command((s) => toggleInline(s, "bold")),
    ),
    ...bind(
      "editor.italic",
      command((s) => toggleInline(s, "italic")),
    ),
    ...bind(
      "editor.underline",
      command((s) => toggleInline(s, "underline")),
    ),
    ...bind(
      "editor.strike",
      command((s) => toggleInline(s, "strike")),
    ),
    ...bind(
      "editor.numbered",
      command((s) => toggleList(s, "numbered")),
    ),
    ...bind(
      "editor.bullets",
      command((s) => toggleList(s, "bullet")),
    ),
    ...(["paragraph", "h1", "h2", "h3", "h4", "h5", "h6"] as BlockStyle[]).flatMap((style) =>
      bind(
        style === "paragraph" ? "editor.paragraph" : `editor.heading${style[1]}`,
        command(
          (s) => setBlockStyle(s, style) ?? { changes: s.changes([]), selection: s.selection },
        ),
      ),
    ),
    // The browser's "Save page" never opens from the editor, even before the page binds Save.
    ...bind("editor.save", runBound("editor.save", registry), { preventDefault: true }),
    ...bind("editor.done", runBound("editor.done", registry)),
    // In a list Tab nests the item; elsewhere it indents the line.
    ...bind("editor.indent", (v) => command(indentListItem)(v) || indentMore(v)),
    ...bind("editor.outdent", (v) => command(outdentListItem)(v) || indentLess(v)),
  ];
  return Prec.high(keymap.of(bindings));
}
