import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { Combobox, type ComboboxOption } from "./ui/Combobox.tsx";

interface Found {
  path: string;
  title: string;
  shared?: boolean;
}

const NONE = "\u0000none";
const titleOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/**
 * Chooses an entry by typing part of its name or another name it goes by. The names search runs
 * on the server, as for the quick switcher, and its answers are shown as they are. With
 * `allowNone`, "No entry" comes first. Used by the editor's link tool and by the map's features.
 */
export function EntryCombobox({
  labelledBy,
  value,
  onChange,
  allowNone = false,
  open,
  onOpenChange,
}: {
  labelledBy: string;
  value: string | null;
  onChange: (path: string | null, title: string) => void;
  allowNone?: boolean;
  /** With `onOpenChange`, opens the list from outside, as the link tool does at once. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const titles = useRef(new Map<string, string>());

  useEffect(() => {
    let live = true;
    const wanted = query.trim();
    // Nothing typed lists every name; a short pause keeps the server from a request a key.
    const wait = window.setTimeout(
      () => {
        api.names(wanted).then(
          (r) => {
            if (!live) return;
            const seen = new Set<string>();
            const rows: Found[] = [];
            // A name and its other names come as rows of their own; one row per entry is enough.
            for (const row of r.results) {
              if (seen.has(row.path)) continue;
              seen.add(row.path);
              rows.push({
                path: row.path,
                title: row.title,
                ...(row.shared ? { shared: true } : {}),
              });
              if (rows.length >= 50) break;
            }
            setFound(rows);
          },
          () => undefined,
        );
      },
      wanted ? 150 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [query]);

  const options = useMemo<ComboboxOption[]>(() => {
    const list: ComboboxOption[] = found.map((f) => {
      // Two entries with one name are told apart by their folder.
      const folder = f.path.split("/").slice(0, -1).join("/");
      const label = f.shared && folder ? `${f.title} (${folder})` : f.title;
      titles.current.set(f.path, f.title);
      return { value: f.path, label };
    });
    // The chosen entry is always shown on the button, found by the search or not.
    if (value && !list.some((o) => o.value === value)) {
      list.unshift({ value, label: titles.current.get(value) ?? titleOf(value) });
    }
    return allowNone ? [{ value: NONE, label: "No entry" }, ...list] : list;
  }, [found, value, allowNone]);

  return (
    <Combobox
      labelledBy={labelledBy}
      options={options}
      value={value ?? (allowNone ? NONE : "")}
      onChange={(chosen) => {
        if (chosen === NONE) onChange(null, "");
        else onChange(chosen, titles.current.get(chosen) ?? titleOf(chosen));
      }}
      findLabel="Find an entry"
      empty="No entry has that name."
      placeholder="Choose an entry"
      onSearch={setQuery}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    />
  );
}
