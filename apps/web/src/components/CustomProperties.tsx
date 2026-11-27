import {
  checkPropertyName,
  type CustomProperty,
  customProperties,
  isThingKind,
  linkOf,
  PROPERTY_KINDS,
  type PropertyKind,
  propertyText,
  propertyValue,
  removeFrontmatterKey,
  renameFrontmatterKey,
  setFrontmatterKey,
} from "@frontier/vault";
import { SYSTEM_PROPS, type TypeLine, type TypeProp } from "@frontier/schema";
import { Plus, X } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { EntryCombobox } from "./EntryCombobox.tsx";
import { ThingCombobox } from "./ThingCombobox.tsx";
import { linkTarget } from "./linkComplete.ts";
import { IconButton } from "./ui/IconButton.tsx";

export const KIND_NAMES: Record<PropertyKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  list: "List of text",
  link: "Link to an entry",
  map: "Link to a map",
  chronicle: "Link to a chronicle",
  tree: "Link to a tree",
};

const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
  map: null,
  chronicle: null,
  tree: null,
};

/**
 * The author's own properties, below the ones Frontier has fields for: add one with a name and a
 * kind, rename it, change its value, remove it. Each change writes one key of the frontmatter in
 * the editor's text, so it is saved, and sent when it can be, as typing is.
 */
export function CustomProperties({
  read,
  write,
  type,
  onGiveToType,
}: {
  /** The editor's text as it is now. */
  read: () => string;
  /** Changes the editor's text; false when the change could not be made. */
  write: (change: (text: string) => string) => boolean;
  /** The entry's type (stage 34): its properties are shown first, as fields to fill. */
  type?: TypeLine | undefined;
  /** Given to an owner: makes one of the entry's own properties a property of its type. */
  onGiveToType?: ((key: string, kind: PropertyKind) => void) | undefined;
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

  const given = type?.props ?? [];
  const ownOf = (prop: TypeProp) => list.find((p) => sameKey(p.key, prop.key));
  const own = list.filter((p) => !given.some((g) => sameKey(g.key, p.key)));

  /** Writes the entry's value for one of its type's properties; none, or the type's own, is not written. */
  function setGiven(prop: TypeProp, value: unknown) {
    const key = ownOf(prop)?.key ?? prop.key;
    const none = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    change((text) =>
      none || sameValue(value, prop.value)
        ? removeFrontmatterKey(text, key)
        : setFrontmatterKey(text, key, value),
    );
  }

  return (
    <div className="custom-props" ref={box}>
      {type && given.length > 0 && (
        <>
          <h3 className="props-heading">As a {type.name}</h3>
          {given.map((prop) => (
            <GivenRow
              key={prop.key}
              prop={prop}
              own={ownOf(prop)}
              onValue={(value) => setGiven(prop, value)}
              onProblem={setProblem}
              onBack={() => {
                const mine = ownOf(prop);
                if (mine) change((text) => removeFrontmatterKey(text, mine.key));
              }}
            />
          ))}
        </>
      )}
      <h3 className="props-heading">{given.length > 0 ? "This entry's own" : "More properties"}</h3>
      {own.length === 0 && !adding && (
        <p className="muted custom-props-none">None yet. Add one with a name and a value.</p>
      )}
      {own.map((p) => {
        const kind = p.kind === "other" ? "other" : (kinds[p.key] ?? p.kind);
        return (
          <Row
            key={p.key}
            property={p}
            kind={kind}
            onRename={(to) => rename(p.key, to)}
            onValue={(value) => change((text) => setFrontmatterKey(text, p.key, value))}
            onProblem={setProblem}
            onRemove={() => {
              change((text) => removeFrontmatterKey(text, p.key));
              setKinds((k) => without(k, p.key));
            }}
            {...(type && onGiveToType && kind !== "other"
              ? { give: { type: type.name, run: () => onGiveToType(p.key, kind) } }
              : {})}
          />
        );
      })}
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
  give,
}: {
  property: CustomProperty;
  kind: PropertyKind | "other";
  onRename: (to: string) => boolean;
  onValue: (value: unknown) => void;
  onProblem: (problem: string | null) => void;
  onRemove: () => void;
  /** Offers to make this a property of the entry's type. */
  give?: { type: string; run: () => void };
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
      {give && (
        <button type="button" className="plain custom-prop-give" onClick={give.run}>
          Give to every {give.type}
        </button>
      )}
    </div>
  );
}

/** What a property of a type is called on the entry. */
export const propLabel = (key: string) => SYSTEM_PROPS[key.toLowerCase()]?.label ?? key;

/**
 * One of the properties the entry's type gives it: its name, which is the type's to change, and
 * the entry's value. A value the type gives shows until the entry sets its own.
 */
function GivenRow({
  prop,
  own,
  onValue,
  onProblem,
  onBack,
}: {
  prop: TypeProp;
  own: CustomProperty | undefined;
  onValue: (value: unknown) => void;
  onProblem: (problem: string | null) => void;
  onBack: () => void;
}) {
  const valueId = useId();
  const label = propLabel(prop.key);
  const set = own !== undefined && own.value !== null && own.value !== "";
  const value = set ? own.value : prop.value;
  const givesValue = prop.value !== undefined;

  function commit(input: string | boolean | string[]) {
    try {
      const next =
        prop.kind === "choice" ? (input === "" ? null : input) : propertyValue(prop.kind, input);
      if (sameValue(next, value)) return;
      onProblem(null);
      onValue(next);
    } catch (err) {
      onProblem(err instanceof Error ? err.message : "That value cannot be written.");
    }
  }

  return (
    <div className="custom-prop given-prop" data-key={prop.key} data-kind={prop.kind}>
      <span className="custom-prop-name given-prop-name">{label}</span>
      <span className="custom-prop-value" id={valueId}>
        <Value
          key={JSON.stringify(value ?? null)}
          kind={prop.kind}
          name={label}
          value={value}
          labelId={valueId}
          onCommit={commit}
          {...(prop.to ? { preferType: prop.to } : {})}
          {...(prop.options ? { options: prop.options } : {})}
        />
      </span>
      {givesValue &&
        (set ? (
          <button type="button" className="plain given-prop-note" onClick={onBack}>
            Back to the type's
          </button>
        ) : (
          <span className="muted given-prop-note">from the type</span>
        ))}
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
  preferType,
  options,
}: {
  kind: PropertyKind | "choice" | "other";
  name: string;
  value: unknown;
  labelId: string;
  onCommit: (input: string | boolean | string[]) => void;
  /** For a link: the type of entry listed first. */
  preferType?: string;
  /** For a choice: what can be chosen. */
  options?: string[];
}) {
  const [typed, setTyped] = useState(() => propertyText(value));
  const label = `Value of ${name}`;
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onCommit(e.currentTarget.value);
  };
  if (kind !== "other" && kind !== "choice" && isThingKind(kind)) {
    return (
      <span className="custom-prop-link">
        <span className="sr-only" id={`${labelId}-label`}>
          {label}
        </span>
        <ThingCombobox
          kind={kind}
          value={value}
          labelledBy={`${labelId}-label`}
          onChange={(next) => onCommit(next ?? "")}
        />
      </span>
    );
  }
  switch (kind) {
    case "choice": {
      const now = typeof value === "string" ? value : "";
      const all = options ?? [];
      return (
        <select aria-label={label} value={now} onChange={(e) => onCommit(e.target.value)}>
          <option value="">Not chosen</option>
          {(now && !all.includes(now) ? [...all, now] : all).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
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
            {...(preferType ? { preferType } : {})}
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
