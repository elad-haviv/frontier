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
}: {
  /** The id of the visible label that names the choice. */
  labelledBy: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** The placeholder and name of the field that narrows the list, such as "Find a folder". */
  findLabel: string;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
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
          <Command.Input className="ui-combobox-find" placeholder={findLabel} />
          <Command.List className="ui-combobox-list">
            <Command.Empty className="ui-combobox-empty">{empty}</Command.Empty>
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
