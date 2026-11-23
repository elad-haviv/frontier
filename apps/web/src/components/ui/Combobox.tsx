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
  onSearch,
  open: openGiven,
  onOpenChange,
  placeholder = "",
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
   * Given, the list is searched elsewhere (by the server): each change of the typed text is
   * passed here, and `options` are shown as they come, with no second filtering.
   */
  onSearch?: (typed: string) => void;
  /** With `onOpenChange`, opens and closes the list from outside, such as from a menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown on the button while nothing is chosen. */
  placeholder?: string;
}) {
  const [openHere, setOpenHere] = useState(false);
  const open = openGiven ?? openHere;
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
        if (!next) {
          setTyped("");
          onSearch?.("");
        }
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
          <span className={`ui-combobox-value${value === "" && !chosen ? " is-empty" : ""}`}>
            {chosen?.label ?? (value || placeholder)}
          </span>
          <Icon icon={ChevronsUpDown} size="sm" />
        </button>
      </Popover.Trigger>
      <Popover.Content className="ui-combobox" align="start" sideOffset={4} collisionPadding={8}>
        <Command label={findLabel} loop shouldFilter={!onSearch}>
          <Command.Input
            className="ui-combobox-find"
            placeholder={findLabel}
            value={typed}
            onValueChange={(next) => {
              setTyped(next);
              onSearch?.(next);
            }}
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
