import * as Popover from "@radix-ui/react-popover";
import {
  FOLDER_COLOR_NAMES,
  FOLDER_ICONS,
  type FolderColor,
  type FolderIcon,
  type FolderLine,
} from "@frontier/schema";
import { Ban, Check } from "lucide-react";
import { type ReactElement, useId } from "react";
import { FOLDER_ICON } from "./tree/folderIcons.ts";
import { Icon } from "./ui/Icon.tsx";
import "./FolderSettings.css";

export type FolderStyle = Pick<FolderLine, "icon" | "color" | "type">;

/**
 * A folder's icon, colour and type, in a popover beside its row. Each choice is kept at once;
 * Escape or a click elsewhere closes it.
 */
export function FolderSettings({
  name,
  value,
  types,
  inherited,
  open,
  onOpenChange,
  onChange,
  anchor,
}: {
  /** The folder's name, for the heading. */
  name: string;
  value: FolderStyle;
  /** The types the schema knows. */
  types: string[];
  /** The type the folder would have from a folder above it, if it set none itself. */
  inherited?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (change: Partial<FolderStyle>) => void;
  /** What the popover is placed beside, such as the folder's row. */
  anchor: { current: Element | null };
}) {
  const heading = useId();
  const typeField = useId();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchor as { current: Element }} />
      <Popover.Portal>
        <Popover.Content
          className="folder-settings"
          side={window.matchMedia("(max-width: 47.99rem)").matches ? "bottom" : "right"}
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-labelledby={heading}
        >
          <h2 id={heading} className="folder-settings-title">
            {name}
          </h2>
          <fieldset className="folder-settings-group">
            <legend>Icon</legend>
            <div className="folder-icons">
              <IconChoice
                label="No icon"
                chosen={value.icon === undefined}
                onPick={() => onChange({ icon: undefined })}
                glyph={<Icon icon={Ban} size="sm" />}
              />
              {FOLDER_ICONS.map((icon: FolderIcon) => (
                <IconChoice
                  key={icon}
                  label={icon.replace(/-/g, " ")}
                  chosen={value.icon === icon}
                  onPick={() => onChange({ icon })}
                  glyph={<Icon icon={FOLDER_ICON[icon]} size="sm" />}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="folder-settings-group">
            <legend>Colour</legend>
            <div className="folder-colors">
              <button
                type="button"
                className="folder-color is-none"
                aria-pressed={value.color === undefined}
                aria-label="No colour"
                title="No colour"
                onClick={() => onChange({ color: undefined })}
              >
                {value.color === undefined && <Icon icon={Check} size="sm" />}
              </button>
              {FOLDER_COLOR_NAMES.map((color: FolderColor) => (
                <button
                  key={color}
                  type="button"
                  className={`folder-color folder-tint-${color}`}
                  aria-pressed={value.color === color}
                  aria-label={color}
                  title={color}
                  onClick={() => onChange({ color })}
                >
                  {value.color === color && <Icon icon={Check} size="sm" />}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="folder-settings-group">
            <label htmlFor={typeField} className="folder-settings-label">
              Type of new entries
            </label>
            <select
              id={typeField}
              value={value.type ?? ""}
              onChange={(e) => onChange({ type: e.target.value || undefined })}
            >
              <option value="">
                {inherited ? `From the folder above (${inherited})` : "No type"}
              </option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p className="folder-settings-note">
              Entries made here get this type in their properties.
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function IconChoice({
  label,
  chosen,
  onPick,
  glyph,
}: {
  label: string;
  chosen: boolean;
  onPick: () => void;
  glyph: ReactElement;
}) {
  return (
    <button
      type="button"
      className="folder-icon-choice"
      aria-pressed={chosen}
      aria-label={label}
      title={label}
      onClick={onPick}
    >
      {glyph}
    </button>
  );
}
