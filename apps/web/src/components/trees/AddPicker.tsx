import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { addRelation, type AddWhere, addTitle, wordFor } from "../../trees/data.ts";
import { above, below, type Graph, kindNamed, partners, title } from "../../trees/model.ts";
import { useToast } from "../ui/Toast.tsx";

interface Option {
  kind: "entry" | "new" | "name";
  label: string;
  note: string;
  path?: string;
}

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/**
 * Adds a relation to the selected card: a parent, a child or a partner (or, in other trees,
 * what is above or below). Pick an entry, make a new one, or keep just a name. It is saved on the
 * selected card's entry only, and says so.
 */
export function AddPicker({
  g,
  kindName,
  where,
  from,
  anchor,
  phone,
  onDone,
  onClose,
}: {
  g: Graph;
  kindName: string;
  where: AddWhere;
  from: string;
  anchor: DOMRect | null;
  phone: boolean;
  onDone: (key: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ path: string; title: string }[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = kindNamed(g, kindName);
  const k = kind?.name ?? kindName;
  const ps = where === "down" && kind?.family ? partners(g, from) : [];
  const [withWho, setWith] = useState<string | null>(ps.length ? ps[ps.length - 1]! : null);
  const name = title(g, from);
  const heading = addTitle(g, k, where, name);

  // Whatever would make a loop is left out: the card itself, those above it and those below.
  const near = useMemo(() => {
    const s = new Set<string>([from, ...above(g, from, k).keys(), ...below(g, from, k)]);
    if (where === "pair") partners(g, from).forEach((p) => s.add(p));
    return s;
  }, [g, from, k, where]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const wanted = q.trim();
    const wait = window.setTimeout(
      () =>
        api.names(wanted).then(
          (r) => {
            if (!live) return;
            const seen = new Set<string>();
            const rows: { path: string; title: string }[] = [];
            for (const row of r.results) {
              if (seen.has(row.path) || near.has(row.path)) continue;
              seen.add(row.path);
              rows.push({ path: row.path, title: row.title });
              if (rows.length >= 8) break;
            }
            setFound(rows);
          },
          () => undefined,
        ),
      wanted ? 150 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [q, near]);

  const typed = q.trim();
  const options: Option[] = found.map((f) => ({
    kind: "entry" as const,
    label: f.title,
    note: folderOf(f.path),
    path: f.path,
  }));
  if (typed && !found.some((f) => f.title.toLowerCase() === typed.toLowerCase())) {
    options.push({
      kind: "new",
      label: `New entry “${typed}”`,
      note: `in ${folderOf(from) || "the library"}`,
    });
    options.push({ kind: "name", label: "Just the name, no entry yet", note: "a dashed card" });
  }

  async function choose(o: Option | undefined) {
    if (!o || busy) return;
    setBusy(true);
    setError(null);
    const what = wordFor(g, k, where);
    const who = o.kind === "entry" ? o.path! : typed;
    try {
      const made = await addRelation({
        path: from,
        what,
        who,
        ...(withWho ? { with: withWho.startsWith("?") ? withWho.slice(1) : withWho } : {}),
        ...(o.kind === "new" ? { create: true } : {}),
      });
      const key = o.kind === "entry" ? o.path! : (made.made ?? `?${typed}`);
      const shown = o.kind === "entry" ? o.label : typed;
      const also = withWho ? `, with [[${title(g, withWho)}]]` : "";
      const after =
        o.kind === "name"
          ? " The name has no entry yet."
          : o.kind === "new"
            ? ` New entry “${typed}” made.`
            : "";
      toast({ message: `Saved on ${name}'s entry: ${what} [[${shown}]]${also}.${after}` });
      onDone(key);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "It could not be saved.");
      setBusy(false);
    }
  }

  const style =
    phone || !anchor
      ? undefined
      : {
          left: Math.min(
            Math.max(anchor.left + anchor.width / 2 - 160, 8),
            window.innerWidth - 330,
          ),
          ...(where === "up"
            ? { bottom: Math.max(window.innerHeight - anchor.top + 8, 8) }
            : { top: Math.min(anchor.bottom + 8, window.innerHeight - 340) }),
        };

  return (
    <>
      {phone && <div className="tr-scrim" onClick={onClose} />}
      <div
        className={`tr-pop${phone ? " is-sheet" : ""}`}
        role="dialog"
        aria-labelledby={`${id}-t`}
        style={style}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h3 id={`${id}-t`}>{heading}</h3>
        {ps.length > 0 && (
          <div className="tr-with" role="group" aria-label="The other parent">
            <span>With:</span>
            {ps.map((p) => (
              <button
                key={p}
                type="button"
                className="tr-chip-btn"
                aria-pressed={withWho === p}
                onClick={() => setWith(p)}
              >
                {title(g, p)}
              </button>
            ))}
            <button
              type="button"
              className="tr-chip-btn"
              aria-pressed={withWho === null}
              onClick={() => setWith(null)}
            >
              no one shown
            </button>
          </div>
        )}
        <input
          ref={input}
          type="text"
          value={q}
          placeholder="Type a name, or pick an entry"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={options[active] ? `${id}-o${active}` : undefined}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void choose(options[active]);
            }
          }}
        />
        <ul className="tr-options" role="listbox" id={`${id}-list`} aria-label="Choices">
          {options.map((o, i) => (
            <li
              key={`${o.kind}${o.path ?? i}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={`${i === active ? "is-active" : ""}${o.kind === "new" ? " is-first-new" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(o)}
            >
              <span>{o.label}</span>
              <small>{o.note}</small>
            </li>
          ))}
          {options.length === 0 && (
            <li className="tr-none">{typed ? "No entry has that name." : "Type a name."}</li>
          )}
        </ul>
        {error && (
          <p className="tr-error" role="alert">
            {error}
          </p>
        )}
        <p className="tr-hint">
          Saved on {name}&rsquo;s entry only. ↑↓ to choose, Enter to add, Esc to close.
        </p>
      </div>
    </>
  );
}
