import type { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Brackets, ClipboardPaste, Copy, ImagePlus, Pilcrow, Scissors } from "lucide-react";
import { type ReactElement, useRef, useState, useSyncExternalStore } from "react";
import { shortcutText } from "../keys.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { BLOCK_STYLES, run, setBlockStyle } from "./editCommands.ts";
import { FORMATS, STYLE_ICONS, type ToolHandlers, tools } from "./editorTools.ts";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
} from "./ui/ContextMenu.tsx";
import "./EditorContextMenu.css";

const canRead = () => typeof navigator !== "undefined" && !!navigator.clipboard?.read;

/** A phone, or any screen without a mouse to hover with: no right-click menu there. */
const TOUCH = "(max-width: 47.99rem), (hover: none)";

function useTouch(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(TOUCH);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(TOUCH).matches,
  );
}

/**
 * The editor's right-click menu, on desktop only: on a phone a long press belongs to the phone's
 * own text selection, and the toolbar's "⋯" holds the same tools. Shift+right-click is left to
 * the browser, for its spelling suggestions. The selection is kept from the moment of the click,
 * and the focus goes back to the text when the menu closes.
 */
export function EditorContextMenu({
  view,
  onFiles,
  children,
  ...handlers
}: {
  view: { current: EditorView | null };
  /** Image files pasted from the menu, for the page to upload. */
  onFiles: (files: File[]) => void;
  children: ReactElement;
} & ToolHandlers) {
  const phone = useTouch();
  const kept = useRef<EditorSelection | null>(null);
  // Once the browser has refused to let the page read the clipboard, Paste says to use the keys.
  const [pasteRefused, setPasteRefused] = useState(() => !canRead());
  const offline = useNeedsConnection();
  const list = tools(handlers);
  const assist = list.filter((t) => t.group === "assist");
  const insert = list.filter((t) => t.id === "link" || t.id === "image");

  /** Runs an action on the text, with the selection it had when the menu was opened. */
  const on = (fn: (v: EditorView) => void | Promise<void>) => () => {
    const v = view.current;
    if (!v) return;
    if (kept.current) v.dispatch({ selection: kept.current });
    void fn(v);
  };

  async function cut(v: EditorView) {
    const { from, to } = v.state.selection.main;
    if (from === to) return;
    try {
      await navigator.clipboard.writeText(v.state.sliceDoc(from, to));
    } catch {
      return;
    }
    // Deleted only once the words are safely on the clipboard, in one undo step.
    v.dispatch({ changes: { from, to }, userEvent: "delete.cut", scrollIntoView: true });
    v.focus();
  }

  async function copy(v: EditorView) {
    const { from, to } = v.state.selection.main;
    await navigator.clipboard.writeText(v.state.sliceDoc(from, to)).catch(() => undefined);
    v.focus();
  }

  async function paste(v: EditorView) {
    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch {
      // Some browsers give text alone; only when that is refused too does Paste say to use keys.
      const plain = await navigator.clipboard.readText().catch(() => null);
      if (plain === null) {
        setPasteRefused(true);
        v.focus();
        return;
      }
      items = [new ClipboardItem({ "text/plain": new Blob([plain], { type: "text/plain" }) })];
    }
    const images: File[] = [];
    let text = "";
    for (const item of items) {
      const image = item.types.find((t) => t.startsWith("image/"));
      if (image) {
        const blob = await item.getType(image);
        images.push(
          new File([blob], `Pasted image.${image.split("/")[1] ?? "png"}`, { type: image }),
        );
      } else if (item.types.includes("text/plain")) {
        text += await (await item.getType("text/plain")).text();
      }
    }
    if (images.length) onFiles(images);
    else if (text) {
      const { from, to } = v.state.selection.main;
      const insert = text.replace(/\r\n?/g, "\n");
      v.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
    }
    v.focus();
  }

  const selected = () => {
    const s = kept.current?.main ?? view.current?.state.selection.main;
    return !!s && !s.empty;
  };
  const [hasSelection, setHasSelection] = useState(false);

  const items = (
    <>
      <ContextMenuItem icon={Scissors} disabled={!hasSelection} onSelect={on(cut)}>
        Cut
      </ContextMenuItem>
      <ContextMenuItem icon={Copy} disabled={!hasSelection} onSelect={on(copy)}>
        Copy
      </ContextMenuItem>
      <ContextMenuItem
        icon={ClipboardPaste}
        disabled={pasteRefused}
        disabledReason="Use Ctrl+V"
        onSelect={on(paste)}
      >
        Paste
      </ContextMenuItem>
      <ContextMenuSeparator />
      {FORMATS.map((t) => (
        <ContextMenuItem
          key={t.id}
          icon={t.icon}
          keys={shortcutText(t.shortcut)}
          onSelect={on(t.act)}
        >
          {t.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSub label="Style" icon={Pilcrow}>
        {BLOCK_STYLES.map((s) => (
          <ContextMenuItem
            key={s.style}
            icon={STYLE_ICONS[s.style]}
            keys={shortcutText(s.shortcut)}
            onSelect={on((v) => {
              run(v, setBlockStyle(v.state, s.style));
              v.focus();
            })}
          >
            {s.label}
          </ContextMenuItem>
        ))}
      </ContextMenuSub>
      <ContextMenuSeparator />
      {insert.map((t) => (
        <ContextMenuItem
          key={t.id}
          icon={t.id === "link" ? Brackets : ImagePlus}
          disabled={t.online === true && offline !== undefined}
          disabledReason={t.online && offline ? (t.offlineReason ?? offline) : undefined}
          onSelect={on(t.act)}
        >
          {t.label}
        </ContextMenuItem>
      ))}
      {assist.length > 0 && <ContextMenuSeparator />}
      {assist.map((t) => (
        <ContextMenuItem
          key={t.id}
          icon={t.icon}
          keys={shortcutText(t.shortcut)}
          disabled={t.online === true && offline !== undefined}
          disabledReason={t.online ? offline : undefined}
          onSelect={on(t.act)}
        >
          {t.menuLabel ?? t.label}
        </ContextMenuItem>
      ))}
    </>
  );

  return (
    <ContextMenu
      disabled={phone}
      className="editor-context-menu"
      items={items}
      onOpenChange={(open) => {
        if (open) setHasSelection(selected());
      }}
      onCloseAutoFocus={(e) => {
        // An action that opened something, such as the comment form, keeps the focus there.
        e.preventDefault();
        const now = document.activeElement;
        if (!now || now === document.body) view.current?.focus();
        kept.current = null;
      }}
    >
      <div
        className="editor-context-area"
        onPointerDownCapture={(e) => {
          if (e.button === 2) kept.current = view.current?.state.selection ?? null;
        }}
        onContextMenuCapture={(e) => {
          // Shift+right-click is the browser's own menu.
          if (e.shiftKey) e.stopPropagation();
          else if (!kept.current) kept.current = view.current?.state.selection ?? null;
        }}
      >
        {children}
      </div>
    </ContextMenu>
  );
}
