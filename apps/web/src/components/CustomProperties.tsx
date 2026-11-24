import {
  checkPropertyName,
  type CustomProperty,
  customProperties,
  linkOf,
  PROPERTY_KINDS,
  type PropertyKind,
  propertyText,
  propertyValue,
  removeFrontmatterKey,
  renameFrontmatterKey,
  setFrontmatterKey,
} from "@frontier/vault";
import { Plus, X } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { EntryCombobox } from "./EntryCombobox.tsx";
import { linkTarget } from "./linkComplete.ts";
import { IconButton } from "./ui/IconButton.tsx";

export const KIND_NAMES: Record<PropertyKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  list: "List of text",
  link: "Link to an entry",
};

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}

/** What a new property of each kind starts as, before the author gives it a value. */
const START: Record<PropertyKind, unknown> = {
  text: null,
  number: null,
  date: null,
  checkbox: false,
  list: [],
  link: null,
};

/**
 * The author's own properties, below the ones Frontier has fields for: add one with a name and a
 * kind, rename it, change its value, remove it. Each change writes one key of the frontmatter in
 * the editor's text, so it is saved, and sent when it can be, as typing is.
 */
export function CustomProperties({
  read,
  write,
}: {
  /** The editor's text as it is now. */
  read: () => string;
  /** Changes the editor's text; false when the change could not be made. */
  write: (change: (text: string) => string) => boolean;
}) {
  const [list, setList] = useState<CustomProperty[] | null>(() => customProperties(read()));
  /**
   * The kind chosen for each property while the panel is open. An empty value says nothing of its
   * kind in the file (Obsidian keeps kinds in its own settings), so a new date stays a date here.
   */
  const [kinds, setKinds] = useState<Record<string, PropertyKind>>({});
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const reload = () => setList(customProperties(read()));

  /** Writes one change and reads the properties back from the text. */
  function change(run: (text: string) => string): boolean {
    let failed: string | null = null;
    const ok = write((text) => {
      try {
        return run(text);
      } catch (err) {
        failed = err instanceof Error ? err.message : "That could not be written.";
        return text;
      }
    });
    setProblem(failed);
    reload();
    return ok && failed === null;
  }

  function add(name: string, kind: PropertyKind): boolean {
    const keys = list?.map((p) => p.key) ?? [];
    const checked = checkPropertyName(name, keys);
    if (!checked.ok) {
      setProblem(checked.problem);
      return false;
    }
    if (!change((text) => setFrontmatterKey(text, checked.name, START[kind]))) return false;
    setKinds((k) => ({ ...k, [checked.name]: kind }));
    setAdding(false);
    // The new property's value is the next thing to fill in.
    setTimeout(() => {
      const rows = box.current?.querySelectorAll<HTMLElement>(".custom-prop");
      rows?.[rows.length - 1]
        ?.querySelector<HTMLElement>(".custom-prop-value input, .custom-prop-value button")
        ?.focus();
    });
    return true;
  }

  function rename(from: string, to: string): boolean {
    if (to.trim() === from) return true;
    const others = (list ?? []).map((p) => p.key).filter((k) => k !== from);
    const checked = checkPropertyName(to, others);
    if (!checked.ok) {
      setProblem(checked.problem);
      return false;
    }
    if (!change((text) => renameFrontmatterKey(text, from, checked.name))) return false;
    setKinds((k) => (k[from] ? { ...without(k, from), [checked.name]: k[from] } : k));
    return true;
  }

  if (list === null) {
    return (
      <p className="error">
        The properties block at the top of this note cannot be read. Fix it in the text.
      </p>
    );
  }

  return (
    <div className="custom-props" ref={box}>
      <h3 className="props-heading">More properties</h3>
      {list.length === 0 && !adding && (
        <p className="muted custom-props-none">None yet. Add one with a name and a value.</p>
      )}
      {list.map((p) => (
        <Row
          key={p.key}
          property={p}
          kind={p.kind === "other" ? "other" : (kinds[p.key] ?? p.kind)}
          onRename={(to) => rename(p.key, to)}
          onValue={(value) => change((text) => setFrontmatterKey(text, p.key, value))}
          onProblem={setProblem}
          onRemove={() => {
            change((text) => removeFrontmatterKey(text, p.key));
            setKinds((k) => without(k, p.key));
          }}
        />
      ))}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {adding ? (
        <AddForm
          onAdd={add}
          onCancel={() => {
            setAdding(false);
            setProblem(null);
          }}
        />
      ) : (
        <button type="button" className="quiet custom-props-add" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden="true" /> Add a property
        </button>
      )}
    </div>
  );
}

/** Asks for a new property's name and kind. */
function AddForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, kind: PropertyKind) => boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PropertyKind>("text");
  function submit(e: FormEvent) {
    e.preventDefault();
    onAdd(name, kind);
  }
  return (
    <form className="custom-props-new" onSubmit={submit}>
      <label className="props-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          autoFocus
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      </label>
      <label className="props-field">
        <span>Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as PropertyKind)}>
          {PROPERTY_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <p className="change-actions">
        <button type="submit" className="primary">
          Add
        </button>
        <button type="button" className="plain" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}

/** One property: its name, which renames it when changed, its value, and Remove. */
function Row({
  property,
  kind,
  onRename,
  onValue,
  onProblem,
  onRemove,
}: {
  property: CustomProperty;
  kind: PropertyKind | "other";
  onRename: (to: string) => boolean;
  onValue: (value: unknown) => void;
  onProblem: (problem: string | null) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(property.key);
  const valueId = useId();

  function commitName() {
    if (!onRename(name)) setName(property.key);
  }

  /** Writes what was typed, as a value of the property's kind. */
  function commit(input: string | boolean | string[]) {
    if (kind === "other") return;
    try {
      const value = propertyValue(kind, input);
      if (JSON.stringify(value) === JSON.stringify(property.value ?? null)) return;
      onValue(value);
    } catch (err) {
      onProblem(err instanceof Error ? err.message : "That value cannot be written.");
    }
  }

  return (
    <div className="custom-prop" data-key={property.key} data-kind={kind}>
      <input
        type="text"
        className="custom-prop-name"
        aria-label={`Name of ${property.key}`}
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            setName(property.key);
          }
        }}
      />
      <span className="custom-prop-value" id={valueId}>
        <Value
          key={JSON.stringify(property.value ?? null)}
          kind={kind}
          name={property.key}
          value={property.value}
          labelId={valueId}
          onCommit={commit}
        />
      </span>
      <IconButton
        label={`Remove ${property.key}`}
        icon={X}
        size="sm"
        tipSide="left"
        className="custom-prop-remove"
        onClick={onRemove}
      />
    </div>
  );
}

/** The field for a value, by its kind. Typed values are written on leaving the field or Enter. */
function Value({
  kind,
  name,
  value,
  labelId,
  onCommit,
}: {
  kind: PropertyKind | "other";
  name: string;
  value: unknown;
  labelId: string;
  onCommit: (input: string | boolean | string[]) => void;
}) {
  const [typed, setTyped] = useState(() => propertyText(value));
  const label = `Value of ${name}`;
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onCommit(e.currentTarget.value);
  };
  switch (kind) {
    case "other":
      return (
        <span className="muted custom-prop-other" title="Change this one in the text">
          {JSON.stringify(value)}
        </span>
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          onChange={(e) => onCommit(e.target.checked)}
        />
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={label}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            // A date picker gives a whole date or none; either is written at once.
            if (e.target.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
              onCommit(e.target.value);
            }
          }}
        />
      );
    case "link":
      return (
        <span className="custom-prop-link">
          <span className="sr-only" id={`${labelId}-label`}>
            {label}
          </span>
          <EntryCombobox
            labelledBy={`${labelId}-label`}
            value={linkOf(value)}
            allowNone
            onChange={(path, title) => {
              if (!path) onCommit("");
              else void linkTarget(path, title).then((target) => onCommit(target));
            }}
          />
        </span>
      );
    default:
      return (
        <input
          type="text"
          inputMode={kind === "number" ? "decimal" : undefined}
          aria-label={label}
          placeholder={kind === "list" ? "Separate with commas" : "Empty"}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={enter}
        />
      );
  }
}
