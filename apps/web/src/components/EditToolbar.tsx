import type { EditorView } from "@codemirror/view";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  type LucideIcon,
  TableColumnsSplit,
  TableRowsSplit,
} from "lucide-react";
import { useRef } from "react";
import { shortcutText } from "../keys.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { BLOCK_STYLES, type BlockStyle, run, setBlockStyle } from "./editCommands.ts";
import { GROUPS, STYLE_ICONS, type ToolHandlers, tools } from "./editorTools.ts";
import { useSheetFloor } from "./shell/panels.tsx";
import { tableCommand } from "./tableKeys.ts";
import { IconButton } from "./ui/IconButton.tsx";
import { Menu, MenuItem } from "./ui/Menu.tsx";
import "./EditToolbar.css";

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
 * The editor's tools, at the bottom of the screen, above the keyboard when it is open: the style
 * picker, then the groups of formats, lists, things to insert, comment and writing help, and undo.
 * Groups that do not fit are hidden by CSS container queries, last group first, and the "⋯" at
 * the end holds them, so the bar never wraps or scrolls and nothing is measured. While the cursor
 * is in a table, buttons to add and delete its rows and columns come first.
 */
export function EditToolbar({
  view,
  inTable = false,
  style,
  ...handlers
}: {
  view: Ref;
  inTable?: boolean;
  /** The style of the cursor's line, which the style picker shows. */
  style: BlockStyle;
} & ToolHandlers) {
  const act = (fn: (v: EditorView) => void) => () => {
    if (view.current) fn(view.current);
  };
  // Buttons must not take the focus from the editor, or the phone keyboard closes.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  // On a phone the panels' sheet opens above the toolbar, so its buttons stay in reach.
  const bar = useRef<HTMLDivElement>(null);
  useSheetFloor(bar);
  // Images, comments and writing help go straight to the server, so they wait for a connection.
  const offline = useNeedsConnection();
  const list = tools(handlers);
  const current = BLOCK_STYLES.find((s) => s.style === style)!;
  const backToText = () => view.current?.focus();
  // Help keeps its name on the bar: among the assist tools where they fit, else first on the bar.
  const pinned = list.filter((t) => t.pinned);
  const pinnedButton = (t: (typeof list)[number]) => (
    <IconButton
      key={t.id}
      className="edit-toolbar-pinned"
      label={t.label}
      icon={t.icon}
      showLabel
      {...(t.shortcut ? { shortcut: t.shortcut } : {})}
      onPointerDown={keep}
      onClick={act(t.act)}
    />
  );

  return (
    <div
      ref={bar}
      className={`edit-toolbar${inTable ? " has-table" : ""}`}
      role="toolbar"
      aria-label="Formatting"
    >
      <div className="edit-toolbar-row">
        {pinned.length > 0 && (
          <div className="edit-toolbar-group" data-group="pinned">
            {pinned.map(pinnedButton)}
          </div>
        )}
        {inTable && (
          <div className="edit-toolbar-group" data-group="table">
            {TABLE_BUTTONS.map(([action, icon, label]) => (
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
          </div>
        )}
        <div className="edit-toolbar-group edit-toolbar-style" data-group="style">
          <Menu
            label={`Style: ${current.label}`}
            icon={STYLE_ICONS[style]}
            text={current.label}
            align="start"
            side="top"
            onClosed={backToText}
          >
            {BLOCK_STYLES.map((s) => (
              <MenuItem
                key={s.style}
                icon={STYLE_ICONS[s.style]}
                keys={shortcutText(s.shortcut)}
                checked={s.style === style}
                onSelect={act((v) => {
                  run(v, setBlockStyle(v.state, s.style));
                  v.focus();
                })}
              >
                {s.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
        {GROUPS.map(({ group }) => (
          <div key={group} className="edit-toolbar-group" data-group={group}>
            {list
              .filter((t) => t.group === group && !t.menuOnly)
              .map((t) =>
                t.pinned ? (
                  pinnedButton(t)
                ) : (
                  <IconButton
                    key={t.id}
                    label={t.label}
                    icon={t.icon}
                    {...(t.shortcut ? { shortcut: t.shortcut } : {})}
                    disabled={t.online === true && offline !== undefined}
                    {...(t.online && offline ? { disabledReason: t.offlineReason ?? offline } : {})}
                    onPointerDown={keep}
                    onClick={act(t.act)}
                  />
                ),
              )}
          </div>
        ))}
        <Menu
          label="More tools"
          className="edit-toolbar-more-button"
          contentClassName="edit-toolbar-more"
          side="top"
          portal={false}
          onClosed={backToText}
        >
          {GROUPS.map(({ group, label }) => (
            <div key={group} className="edit-toolbar-more-group" data-group={group}>
              <span className="edit-toolbar-more-label">{label}</span>
              {list
                .filter((t) => t.group === group)
                .map((t) => (
                  <MenuItem
                    key={t.id}
                    icon={t.icon}
                    keys={shortcutText(t.shortcut)}
                    disabled={t.online === true && offline !== undefined}
                    disabledReason={t.online && offline ? (t.offlineReason ?? offline) : undefined}
                    onSelect={act(t.act)}
                  >
                    {t.menuLabel ?? t.label}
                  </MenuItem>
                ))}
            </div>
          ))}
        </Menu>
      </div>
    </div>
  );
}
