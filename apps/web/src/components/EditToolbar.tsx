import { startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Brackets,
  Heading2,
  ImagePlus,
  Italic,
  List,
  type LucideIcon,
  MessageSquarePlus,
  Redo2,
  TableColumnsSplit,
  TableRowsSplit,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { useRef } from "react";
import { linePrefix, wrap } from "./editCommands.ts";
import { tableCommand } from "./tableKeys.ts";
import { IconButton } from "./ui/IconButton.tsx";
import { useSheetFloor } from "./shell/panels.tsx";
import { useNeedsConnection } from "../sync/connection.ts";

type Ref = { current: EditorView | null };

const TABLE_BUTTONS: readonly [
  "addRow" | "deleteRow" | "addColumn" | "deleteColumn",
  LucideIcon,
  string,
][] = [
  ["addRow", BetweenHorizontalEnd, "Add a row below"],
  ["deleteRow", TableRowsSplit, "Delete this row"],
  ["addColumn", BetweenVerticalEnd, "Add a column to the right"],
  ["deleteColumn", TableColumnsSplit, "Delete this column"],
];

/**
 * Buttons for the marks that are slow to reach on a phone keyboard. They sit at the bottom of the
 * screen, above the keyboard when it is open. While the cursor is in a table, buttons to add and
 * delete its rows and columns come first.
 */
export function EditToolbar({
  view,
  onFiles,
  inTable = false,
  onWrite,
  onComment,
}: {
  view: Ref;
  onFiles?: (files: File[]) => void;
  inTable?: boolean;
  /** Opens writing help; absent while no model is chosen. */
  onWrite?: () => void;
  /** Opens a new comment on the selection, or on the paragraph the cursor is in. */
  onComment?: () => void;
}) {
  const act = (fn: (v: EditorView) => void) => () => {
    if (view.current) fn(view.current);
  };
  // Buttons must not take the focus from the editor, or the phone keyboard closes.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  const picker = useRef<HTMLInputElement>(null);
  // On a phone the panels' sheet opens above the toolbar, so its buttons stay in reach.
  const bar = useRef<HTMLDivElement>(null);
  useSheetFloor(bar);
  // Images, comments and writing help go straight to the server, so they wait for a connection.
  const offline = useNeedsConnection();

  return (
    <div ref={bar} className="edit-toolbar" role="toolbar" aria-label="Formatting">
      {inTable &&
        TABLE_BUTTONS.map(([action, icon, label]) => (
          <IconButton
            key={action}
            className="edit-toolbar-table"
            label={label}
            icon={icon}
            shortcut={`table.${action}`}
            onPointerDown={keep}
            onClick={act((v) => {
              tableCommand(action)(v);
              v.focus();
            })}
          />
        ))}
      <IconButton
        label="Link to an entry"
        icon={Brackets}
        onPointerDown={keep}
        onClick={act((v) => {
          wrap(v, "[[", "]]");
          startCompletion(v);
        })}
      />
      <IconButton
        label="Heading"
        icon={Heading2}
        onPointerDown={keep}
        onClick={act((v) => linePrefix(v, "## "))}
      />
      <IconButton
        label="List item"
        icon={List}
        onPointerDown={keep}
        onClick={act((v) => linePrefix(v, "- "))}
      />
      <IconButton
        label="Bold"
        icon={Bold}
        shortcut="editor.bold"
        onPointerDown={keep}
        onClick={act((v) => wrap(v, "**", "**"))}
      />
      <IconButton
        label="Italic"
        icon={Italic}
        shortcut="editor.italic"
        onPointerDown={keep}
        onClick={act((v) => wrap(v, "*", "*"))}
      />
      {onFiles && (
        <span className="edit-toolbar-file">
          <IconButton
            label="Add an image"
            icon={ImagePlus}
            disabled={offline !== undefined}
            {...(offline ? { disabledReason: "Images need a connection" } : {})}
            onPointerDown={keep}
            onClick={() => picker.current?.click()}
          />
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              if (picked.length) onFiles(picked);
            }}
          />
        </span>
      )}
      {onComment && (
        <IconButton
          label="Comment"
          icon={MessageSquarePlus}
          disabled={offline !== undefined}
          {...(offline ? { disabledReason: offline } : {})}
          onPointerDown={keep}
          onClick={onComment}
        />
      )}
      {onWrite && (
        <IconButton
          label="Writing help"
          icon={WandSparkles}
          disabled={offline !== undefined}
          {...(offline ? { disabledReason: offline } : {})}
          onPointerDown={keep}
          onClick={onWrite}
        />
      )}
      <span className="edit-toolbar-gap" />
      <IconButton
        label="Undo"
        icon={Undo2}
        shortcut="editor.undo"
        onPointerDown={keep}
        onClick={act((v) => void undo(v))}
      />
      <IconButton
        label="Redo"
        icon={Redo2}
        shortcut="editor.redo"
        onPointerDown={keep}
        onClick={act((v) => void redo(v))}
      />
    </div>
  );
}
