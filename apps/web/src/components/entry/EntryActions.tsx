import {
  FileDown,
  FoldHorizontal,
  FolderInput,
  History,
  type LucideIcon,
  Pencil,
  Pin,
  TableOfContents,
  TextCursorInput,
  UnfoldHorizontal,
  Network,
  Waypoints,
} from "lucide-react";
import { useWide } from "../../width.ts";
import { IconButton, IconLink } from "../ui/IconButton.tsx";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { WideMenuItem } from "./WideMenuItem.tsx";
import "./EntryActions.css";

/** One of the entry's actions, drawn as an icon in the bar and as an item in its "⋯". */
interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  /** Why it cannot be used now, such as having no connection. */
  blocked?: string | undefined;
  /** Whether its panel is the one open. */
  pressed?: boolean;
}

export interface EntryActionsProps {
  /** The editor's address, for an entry that can be changed; absent for a read-only one. */
  editHref?: string | undefined;
  /** Opens or closes the Outline tab; absent when the entry has no headings. */
  onOutline?: (() => void) | undefined;
  outlineOpen: boolean;
  onGraph: () => void;
  graphOpen: boolean;
  /** Opens or closes the Relations tab (stage 29); absent where it is not offered. */
  onRelations?: (() => void) | undefined;
  relationsOpen?: boolean;
  /** Pin to "Working on"; absent where the entry cannot be pinned. */
  pin?:
    | {
        pinned: boolean;
        onToggle: () => void;
        /** Why it cannot be done now, such as having no connection. */
        blocked?: string | undefined;
      }
    | undefined;
  /** Present for an entry that can be changed. */
  changes?:
    | {
        onRename: () => void;
        onMove: () => void;
        onHistory: () => void;
        onExport: () => void;
        /** Why renaming and moving cannot be done now. */
        offline?: string | undefined;
      }
    | undefined;
}

/** The actions an entry offers, most used first. */
function actionsOf(p: EntryActionsProps): { main: Action[]; rest: Action[] } {
  const main: Action[] = [];
  if (p.onOutline) {
    main.push({
      id: "outline",
      label: "Outline",
      icon: TableOfContents,
      run: p.onOutline,
      pressed: p.outlineOpen,
    });
  }
  if (p.onRelations) {
    main.push({
      id: "relations",
      label: "Relations",
      icon: Network,
      run: p.onRelations,
      pressed: p.relationsOpen ?? false,
    });
  }
  main.push({ id: "graph", label: "Graph", icon: Waypoints, run: p.onGraph, pressed: p.graphOpen });
  const rest: Action[] = [];
  if (p.changes) {
    const c = p.changes;
    rest.push(
      { id: "rename", label: "Rename", icon: TextCursorInput, run: c.onRename, blocked: c.offline },
      { id: "move", label: "Move to…", icon: FolderInput, run: c.onMove, blocked: c.offline },
      { id: "history", label: "History", icon: History, run: c.onHistory },
      { id: "export", label: "Export", icon: FileDown, run: c.onExport },
    );
  }
  return { main, rest };
}

function Tool({ action }: { action: Action }) {
  return (
    <IconButton
      label={action.label}
      icon={action.icon}
      size="sm"
      tipSide="bottom"
      className={`entry-tool entry-tool-${action.id}`}
      disabled={action.blocked !== undefined}
      {...(action.blocked ? { disabledReason: action.blocked } : {})}
      {...(action.pressed !== undefined ? { "aria-pressed": action.pressed } : {})}
      onClick={action.run}
    />
  );
}

function Item({ action }: { action: Action }) {
  return (
    <MenuItem
      icon={action.icon}
      disabled={action.blocked !== undefined}
      disabledReason={action.blocked}
      onSelect={action.run}
    >
      {action.label}
    </MenuItem>
  );
}

/** The pin: an icon that shows whether the entry is pinned. */
function PinTool({ pin }: { pin: NonNullable<EntryActionsProps["pin"]> }) {
  return (
    <IconButton
      label="Pin to Working on"
      icon={Pin}
      size="sm"
      shortcut="entry.pin"
      tipSide="bottom"
      className={`entry-tool entry-tool-pin${pin.pinned ? " is-pinned" : ""}`}
      disabled={pin.blocked !== undefined}
      {...(pin.blocked ? { disabledReason: pin.blocked } : {})}
      aria-pressed={pin.pinned}
      onClick={pin.onToggle}
    />
  );
}

function EditLink({ href }: { href: string }) {
  return (
    <IconLink
      to={href}
      label="Edit"
      icon={Pencil}
      size="sm"
      tipSide="bottom"
      className="edit-link entry-tool entry-tool-edit"
    />
  );
}

/**
 * The entry's actions in the bar at the top of the page, each an icon with its name in a
 * tooltip. Where the bar is narrow, the less used ones (full width, rename, move, history,
 * export) go behind "⋯"; Outline, Graph and Edit stay.
 */
export function EntryToolbar(p: EntryActionsProps) {
  const { main, rest } = actionsOf(p);
  return (
    <div className="entry-tools" role="toolbar" aria-label="Entry actions">
      {p.pin && <PinTool pin={p.pin} />}
      {main.map((a) => (
        <Tool key={a.id} action={a} />
      ))}
      <WideTool />
      {rest.length > 0 && <span className="entry-tools-rule" aria-hidden="true" />}
      {rest.map((a) => (
        <span key={a.id} className="entry-tools-extra">
          <Tool action={a} />
        </span>
      ))}
      <span className="entry-tools-more">
        <Menu label="More actions">
          <WideMenuItem />
          {rest.length > 0 && <MenuSeparator />}
          {rest.map((a) => (
            <Item key={a.id} action={a} />
          ))}
        </Menu>
      </span>
      {p.editHref && <EditLink href={p.editHref} />}
    </div>
  );
}

/**
 * On a phone, in the slim top line: Edit, and "⋯" with everything else, so the line keeps room
 * for the title.
 */
export function EntryPhoneActions(p: EntryActionsProps) {
  const { main, rest } = actionsOf(p);
  return (
    <span className="entry-phone-tools">
      {p.pin && <PinTool pin={p.pin} />}
      <Menu label="More actions">
        {main.map((a) => (
          <Item key={a.id} action={a} />
        ))}
        <WideMenuItem />
        {rest.length > 0 && <MenuSeparator />}
        {rest.map((a) => (
          <Item key={a.id} action={a} />
        ))}
      </Menu>
      {p.editHref && <EditLink href={p.editHref} />}
    </span>
  );
}

/** Full width as an icon, which shows whether it is on. */
function WideTool() {
  const [wide, setWide] = useWide();
  return (
    <span className="entry-tools-extra">
      <IconButton
        label="Full width"
        icon={wide ? FoldHorizontal : UnfoldHorizontal}
        size="sm"
        tipSide="bottom"
        className="entry-tool entry-tool-wide"
        aria-pressed={wide}
        onClick={() => setWide(!wide)}
      />
    </span>
  );
}
