import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Icon } from "./Icon.tsx";
import "./Combobox.css";

export interface ComboboxOption {
  value: string;
  /** What the list shows, and what typing is matched against. Unique within a list. */
  label: string;
}

/**
 * Chooses one of many: a button showing the choice, which opens a list with a field to narrow
 * it. Used to choose a folder, an entry or a map. The list is drawn inside the page by default,
 * so it stays above a question box it sits in.
 */
export function Combobox({
  labelledBy,
  options,
  value,
  onChange,
  findLabel,
  empty = "Nothing matches.",
  create,
  open: openAsked,
  onOpenChange,
}: {
  /** The id of the visible label that names the choice. */
  labelledBy: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** The placeholder and name of the field that narrows the list, such as "Find a folder". */
  findLabel: string;
  empty?: string;
  /**
   * Offers to make a new choice from what was typed when no choice has that name, such as
   * "New folder 'Islands'". `label` words the offer; `onCreate` is given the typed text.
   */
  create?: { label: (typed: string) => string; onCreate: (typed: string) => void };
  /**
   * Whether the list is open, for a list opened from elsewhere, such as a menu's "Move to…".
   * Without it the list opens and closes by itself.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openHere, setOpenHere] = useState(false);
  const open = openAsked ?? openHere;
  const setOpen = (next: boolean) => {
    setOpenHere(next);
    onOpenChange?.(next);
  };
  const [typed, setTyped] = useState("");
  const wanted = typed.trim();
  const offer =
    create && wanted !== "" && !options.some((o) => o.label.toLowerCase() === wanted.toLowerCase());
  const chosen = options.find((o) => o.value === value);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={labelledBy}
          className="ui-combobox-trigger"
        >
          <span className="ui-combobox-value">{chosen?.label ?? value}</span>
          <Icon icon={ChevronsUpDown} size="sm" />
        </button>
      </Popover.Trigger>
      <Popover.Content className="ui-combobox" align="start" sideOffset={4} collisionPadding={8}>
        <Command label={findLabel} loop>
          <Command.Input
            className="ui-combobox-find"
            placeholder={findLabel}
            value={typed}
            onValueChange={setTyped}
          />
          <Command.List className="ui-combobox-list">
            <Command.Empty className="ui-combobox-empty">{empty}</Command.Empty>
            {offer && (
              <Command.Item
                forceMount
                value={`\u0000new ${wanted}`}
                className="ui-combobox-item ui-combobox-create"
                onSelect={() => {
                  create.onCreate(wanted);
                  setOpen(false);
                  setTyped("");
                }}
              >
                <span>{create.label(wanted)}</span>
              </Command.Item>
            )}
            {options.map((o) => (
              <Command.Item
                key={o.value}
                // cmdk narrows the list by this; labels are unique, as values are.
                value={o.label}
                className="ui-combobox-item"
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {o.value === value && <Icon icon={Check} size="sm" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Popover.Content>
    </Popover.Root>
  );
}
