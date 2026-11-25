import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Brackets,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  MessageSquarePlus,
  MessagesSquare,
  Minus,
  Pilcrow,
  Redo2,
  Scale,
  Sparkles,
  SquareCode,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import {
  type BlockStyle,
  indentListItem,
  insertRule,
  outdentListItem,
  run,
  toggleInline,
  toggleList,
} from "./editCommands.ts";

/** What the page gives the tools that open something of its own. */
export interface ToolHandlers {
  onLink: () => void;
  onImage: () => void;
  onComment?: (() => void) | undefined;
  /** Writing help on the selection or the cursor's paragraph; shown even with no model chosen. */
  onHelp?: (() => void) | undefined;
  /** The AI's opinion of the entry (stage 24), in the side bar. */
  onConsult?: (() => void) | undefined;
  /** Asks the lore about the selection or the cursor's paragraph, on the Ask page. */
  onAsk?: (() => void) | undefined;
}

export type ToolGroup = "inline" | "lists" | "insert" | "assist" | "history";

export interface Tool {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The id of its shortcut in the keys registry. */
  shortcut?: string;
  group: ToolGroup;
  /** Goes to the server, so it waits for a connection. */
  online?: boolean;
  /** Why it is disabled with no connection, when it is said more plainly than "Needs a connection". */
  offlineReason?: string;
  /** Its name in a menu, when that differs from the button's. */
  menuLabel?: string;
  /** Offered in the menus only, not as a button in the toolbar. */
  menuOnly?: boolean;
  /** Always on the toolbar with its name, never folded into "⋯". */
  pinned?: boolean;
  act: (view: EditorView) => void;
}

/** The style picker's icons, one per style. */
export const STYLE_ICONS: Record<BlockStyle, LucideIcon> = {
  paragraph: Pilcrow,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  quote: TextQuote,
  code: SquareCode,
};

const mark =
  (m: Parameters<typeof toggleInline>[1]) =>
  (v: EditorView): void =>
    void run(v, toggleInline(v.state, m));

/** The formats, shared by the toolbar, its "⋯" and the right-click menu. */
export const FORMATS: Tool[] = [
  {
    id: "bold",
    label: "Bold",
    icon: Bold,
    shortcut: "editor.bold",
    group: "inline",
    act: mark("bold"),
  },
  {
    id: "italic",
    label: "Italic",
    icon: Italic,
    shortcut: "editor.italic",
    group: "inline",
    act: mark("italic"),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: Strikethrough,
    shortcut: "editor.strike",
    group: "inline",
    act: mark("strike"),
  },
  {
    id: "underline",
    label: "Underline",
    icon: Underline,
    shortcut: "editor.underline",
    group: "inline",
    act: mark("underline"),
  },
  { id: "code", label: "Inline code", icon: Code, group: "inline", act: mark("code") },
];

/** Every tool of the toolbar after the style picker, in its groups' order. */
export function tools(h: ToolHandlers): Tool[] {
  const list: Tool[] = [
    ...FORMATS,
    {
      id: "bullets",
      label: "Bullet list",
      icon: List,
      shortcut: "editor.bullets",
      group: "lists",
      act: (v) => void run(v, toggleList(v.state, "bullet")),
    },
    {
      id: "numbered",
      label: "Numbered list",
      icon: ListOrdered,
      shortcut: "editor.numbered",
      group: "lists",
      act: (v) => void run(v, toggleList(v.state, "numbered")),
    },
    {
      id: "task",
      label: "Task list",
      icon: ListTodo,
      group: "lists",
      act: (v) => void run(v, toggleList(v.state, "task")),
    },
    {
      id: "indent",
      label: "Indent",
      icon: IndentIncrease,
      shortcut: "editor.indent",
      group: "lists",
      act: (v) => {
        if (!run(v, indentListItem(v.state))) indentMore(v);
        v.focus();
      },
    },
    {
      id: "outdent",
      label: "Indent less",
      icon: IndentDecrease,
      shortcut: "editor.outdent",
      group: "lists",
      act: (v) => {
        if (!run(v, outdentListItem(v.state))) indentLess(v);
        v.focus();
      },
    },
    { id: "link", label: "Link to an entry", icon: Brackets, group: "insert", act: h.onLink },
    {
      id: "image",
      label: "Add an image",
      icon: ImagePlus,
      group: "insert",
      online: true,
      offlineReason: "Images need a connection",
      act: h.onImage,
    },
    {
      id: "rule",
      label: "Horizontal rule",
      icon: Minus,
      group: "insert",
      act: (v) => void run(v, insertRule(v.state)),
    },
  ];
  if (h.onComment) {
    const open = h.onComment;
    list.push({
      id: "comment",
      label: "Comment",
      icon: MessageSquarePlus,
      group: "assist",
      online: true,
      act: open,
    });
  }
  if (h.onHelp) {
    // Not marked online: with no connection it still opens, to say so.
    list.push({
      id: "help",
      label: "Help",
      menuLabel: "Help with this…",
      icon: Sparkles,
      shortcut: "editor.help",
      group: "assist",
      pinned: true,
      act: h.onHelp,
    });
  }
  if (h.onConsult) {
    // Not marked online: with no connection it still opens, to say so.
    list.push({
      id: "consult",
      label: "Consult",
      menuLabel: "Consult on this…",
      icon: Scale,
      shortcut: "editor.consult",
      group: "assist",
      act: h.onConsult,
    });
  }
  if (h.onAsk) {
    list.push({
      id: "ask",
      label: "Ask the lore about this…",
      icon: MessagesSquare,
      group: "assist",
      online: true,
      menuOnly: true,
      act: h.onAsk,
    });
  }
  list.push(
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      shortcut: "editor.undo",
      group: "history",
      act: (v) => void undo(v),
    },
    {
      id: "redo",
      label: "Redo",
      icon: Redo2,
      shortcut: "editor.redo",
      group: "history",
      act: (v) => void redo(v),
    },
  );
  return list;
}

export const GROUPS: { group: ToolGroup; label: string }[] = [
  { group: "inline", label: "Text" },
  { group: "lists", label: "Lists" },
  { group: "insert", label: "Insert" },
  { group: "assist", label: "Comment and help" },
  { group: "history", label: "Undo and redo" },
];
