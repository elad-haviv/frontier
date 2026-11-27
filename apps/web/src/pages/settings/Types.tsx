import {
  type DateName,
  type FolderFile,
  type FolderLine,
  FOLDERS,
  type SchemaResponse,
  SYSTEM_PROPS,
  type TreeFolder,
  TYPE_PROP_KIND_NAMES,
  TYPE_PROP_KINDS,
  type TypeLine,
  type TypeProp,
  type TypePropKind,
  TYPES,
  type TypesFile,
  typesFromNames,
} from "@frontier/schema";
import { BUILT_IN_SCHEMA } from "@frontier/vault";
import { Check, ChevronLeft, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { useRole } from "../../components/projectContext.ts";
import { Combobox } from "../../components/ui/Combobox.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { useLibraryFile } from "../../sync/libraryFile.ts";
import { useAsync } from "../../useAsync.ts";
import { useWide } from "./shared.tsx";
import "./types.css";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why a new name for a type cannot be used, or null. */
export function typeNameProblem(name: string, taken: string[]): string | null {
  if (name === "") return "Give it a name.";
  if (/[\s/:]/.test(name)) return "One word, without spaces.";
  if (name.length > 60) return "That name is too long.";
  if (taken.some((t) => same(t, name))) return `“${name}” is already on the list.`;
  return null;
}

/** Why a new name for a property or a date cannot be used, or null. */
export function wordProblem(name: string, taken: string[]): string | null {
  if (name === "") return "Give it a name.";
  if (name.length > 60) return "That name is too long.";
  if (["id", "type", "time", "aliases", "tags", "relations"].includes(name.toLowerCase())) {
    return `“${name}” has a field of its own.`;
  }
  if (taken.some((t) => same(t, name))) return `“${name}” is already on the list.`;
  return null;
}

/** A property with its kind changed: what belonged to the old kind is dropped. */
export function withKind(prop: TypeProp, kind: TypePropKind): TypeProp {
  return { key: prop.key, kind, ...(kind === "choice" ? { options: [] } : {}) };
}

/** The value a type gives, from what was typed, for the property's kind; undefined for none. */
export function givenValue(prop: TypeProp, typed: string): TypeProp["value"] {
  const raw = typed.trim();
  if (raw === "") return undefined;
  if (prop.kind === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (prop.kind === "list") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

const textOf = (value: TypeProp["value"]) =>
  value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);

/** Every folder of the library, by path. */
function foldersOf(tree: TreeFolder[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeFolder[]) => {
    for (const f of list) {
      out.push(f.path);
      walk(f.folders);
    }
  };
  walk(tree);
  return out;
}

/** The folder file with a folder given a type, or with its type taken away. */
function withFolderType(file: FolderFile, path: string, type: string | undefined): FolderFile {
  const known = file.folders.some((l) => l.path === path);
  const lines = known
    ? file.folders.map((l) => (l.path === path ? { ...l, type } : l))
    : [...file.folders, { path, type }];
  return {
    ...file,
    folders: lines.map(
      (l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as FolderLine,
    ),
  };
}

/**
 * Settings → This project → Types and dates (stage 34). A type says what its entries are and
 * which properties they have; a date name says what happened and whether it starts or ends the
 * entry's span. An owner changes them, and each change is kept with the unsaved changes, as a
 * folder change is. Anyone else reads the lists.
 */
export function Types() {
  const { isOwner } = useRole();
  // Two columns need room: with the library pane open, or on a phone, a type opens by itself.
  const screenWide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => setRoomy((entry?.contentRect.width ?? 0) >= 620));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const wide = screenWide && roomy;
  const types = useLibraryFile(TYPES);
  const folders = useLibraryFile(FOLDERS);
  const usage = useAsync(() => api.schema(), "schema");
  const tree = useAsync(() => api.tree(), "tree");
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const keptTimer = useRef(0);

  const file = types.value;
  const counts: SchemaResponse["counts"] | null =
    usage.state === "ready" ? usage.value.counts : null;
  const strays = usage.state === "ready" ? usage.value.strays : { types: [], what: [] };
  const allFolders = useMemo(
    () => (tree.state === "ready" ? foldersOf(tree.value.folders) : []),
    [tree],
  );

  if (types.state === "failed") {
    return <Problem reason={types.error ?? "The types could not be read."} />;
  }
  if (!file) {
    return (
      <div ref={box}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const said = (err: unknown, fallback: string) =>
    setProblem(err instanceof ApiFailure ? err.message : fallback);
  const markKept = () => {
    setProblem(null);
    setKept(true);
    window.clearTimeout(keptTimer.current);
    keptTimer.current = window.setTimeout(() => setKept(false), 2500);
  };
  /** A change to the types file, kept by the save queue. */
  const change = (fn: (file: TypesFile) => TypesFile) =>
    types.client.change(fn).then(markKept, (err) => said(err, "The types could not be changed."));
  const changeType = (name: string, fn: (type: TypeLine) => TypeLine) =>
    change((f) => ({ ...f, types: f.types.map((t) => (t.name === name ? fn(t) : t)) }));
  const changeFolders = (fn: (file: FolderFile) => FolderFile) =>
    folders.client
      .change(fn)
      .then(markKept, (err) => said(err, "The folders could not be changed."));

  /** Renames on the server, which rewrites the entries, then reads everything again. */
  async function rename(body: Parameters<typeof api.renameTypes>[0]): Promise<boolean> {
    try {
      // What waits to be sent goes first, so the server renames in the file as it is here.
      await types.client.flush();
      await folders.client.flush();
      await api.renameTypes(body);
      await Promise.all([types.client.reload(), folders.client.reload()]);
      usage.retry();
      if (body.what === "type" && open !== null && same(open, body.from)) setOpen(body.to);
      markKept();
      return true;
    } catch (err) {
      said(err, "That could not be renamed.");
      return false;
    }
  }

  async function removeType(type: TypeLine) {
    // The folders first: a folder may only name a type the list has.
    await changeFolders((f) => {
      if (!f.folders.some((l) => l.type !== undefined && same(l.type, type.name))) return f;
      return {
        ...f,
        folders: f.folders.map((l) => {
          if (l.type === undefined || !same(l.type, type.name)) return l;
          const rest = { ...l };
          delete rest.type;
          return rest;
        }),
      };
    });
    await change((f) => ({
      ...f,
      types: f.types
        .filter((t) => t.name !== type.name)
        .map((t) => ({
          ...t,
          props: t.props.map((p) => {
            if (!p.to || !same(p.to, type.name)) return p;
            const rest = { ...p };
            delete rest.to;
            return rest;
          }),
        })),
    }));
    setOpen(null);
  }

  const shown = file.types.find((t) => t.name === open) ?? (wide ? file.types[0] : undefined);
  const foldersWith = (type: string) =>
    (folders.value?.folders ?? [])
      .filter((l) => l.type !== undefined && same(l.type, type))
      .map((l) => l.path);

  const alone = !wide && open !== null && file.types.some((t) => t.name === open);
  const head = (
    <>
      <p className="muted types-lead">
        {!alone && (
          <>
            A type says what its entries are and which properties they have.{" "}
            {isOwner
              ? "A change here is kept with your unsaved changes."
              : "Only an owner of the project can change these."}{" "}
          </>
        )}
        <span className={`saved-mark types-kept${kept ? " is-on" : ""}`} role="status">
          {kept && (
            <>
              <Icon icon={Check} size="sm" /> Kept
            </>
          )}
        </span>
      </p>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </>
  );

  const detail = shown && (
    <TypeDetail
      key={shown.name}
      type={shown}
      file={file}
      canChange={isOwner}
      entries={counts?.types[shown.name] ?? null}
      folders={foldersWith(shown.name)}
      allFolders={allFolders}
      folderTypes={folders.value}
      onBack={wide ? null : () => setOpen(null)}
      onChange={(fn) => changeType(shown.name, fn)}
      onRename={(to) => rename({ what: "type", from: shown.name, to })}
      onRenameProp={(from, to) => rename({ what: "prop", type: shown.name, from, to })}
      onCount={(to) => api.renameTypes({ what: "type", from: shown.name, to, dryRun: true })}
      onRemove={() => removeType(shown)}
      onFolder={(path, on) =>
        changeFolders((f) => withFolderType(f, path, on ? shown.name : undefined))
      }
    />
  );

  // On a phone a type opens by itself, with a way back to the lists.
  if (alone && detail) {
    return (
      <section className="settings-block types-page">
        <div ref={box}>
          {head}
          {detail}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-block types-page">
      <div ref={box} />
      {head}
      <Strays
        strays={strays}
        canChange={isOwner}
        onAddType={(name) =>
          change((f) => ({ ...f, types: [...f.types, { name, props: [], dates: [] }] }))
        }
        onAddDate={(name) => change((f) => ({ ...f, what: [...f.what, { name }] }))}
      />
      <h2>Types</h2>
      <p className="muted">An entry takes the type of its folder unless it names its own.</p>
      <div className={wide ? "types-columns" : undefined}>
        <div>
          <ul className="types-list" aria-label="Types">
            {file.types.length === 0 && (
              <li className="types-empty">
                No types. Entries work without one; a type gives its entries their properties.
                {isOwner && (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      change((f) => ({
                        ...f,
                        types: typesFromNames(Object.keys(BUILT_IN_SCHEMA.types), []).types,
                      }))
                    }
                  >
                    Put back the usual nine
                  </button>
                )}
              </li>
            )}
            {file.types.map((t) => {
              const n = counts?.types[t.name];
              return (
                <li key={t.name}>
                  <button
                    type="button"
                    className="types-row"
                    aria-current={wide && shown?.name === t.name ? "true" : undefined}
                    onClick={() => setOpen(t.name)}
                  >
                    <b>{t.name}</b>
                    <span className="types-count">
                      {n === undefined ? "" : n === 0 ? "unused" : plural(n, "entry", "entries")}
                    </span>
                    {!wide && <Icon icon={ChevronRight} size="sm" />}
                    <small>
                      {t.props.length
                        ? t.props
                            .map((p) => SYSTEM_PROPS[p.key.toLowerCase()]?.label ?? p.key)
                            .join(", ")
                        : "no properties"}
                    </small>
                  </button>
                </li>
              );
            })}
            {isOwner && (
              <li>
                <AddWord
                  label="Add a type"
                  placeholder="such as vessel"
                  check={(name) =>
                    typeNameProblem(
                      name,
                      file.types.map((t) => t.name),
                    )
                  }
                  onAdd={(name) => {
                    void change((f) => ({
                      ...f,
                      types: [...f.types, { name, props: [], dates: [] }],
                    }));
                    setOpen(name);
                  }}
                />
              </li>
            )}
          </ul>
          {counts && counts.untyped > 0 && (
            <p className="field-hint">
              {plural(counts.untyped, "entry has", "entries have")} no type.
            </p>
          )}
        </div>
        {wide && detail}
      </div>
      <DateNames
        names={file.what}
        counts={counts?.what ?? null}
        canChange={isOwner}
        onChange={(fn) => change((f) => ({ ...f, what: fn(f.what) }))}
        onRename={(from, to) => rename({ what: "date", from, to })}
        onRemove={(name) =>
          change((f) => ({
            ...f,
            what: f.what.filter((w) => w.name !== name),
            types: f.types.map((t) => ({ ...t, dates: t.dates.filter((d) => d !== name) })),
          }))
        }
        onUsual={() =>
          change((f) => ({
            ...f,
            what: typesFromNames(
              [],
              Object.entries(BUILT_IN_SCHEMA.what).map(([name, w]) => ({ name, ...w })),
            ).what,
          }))
        }
      />
      <p className="field-hint types-foot">
        Kept in the library as <code>.frontier/types.json</code>, so it travels with exports and
        backups.
      </p>
    </section>
  );
}

/** Words that entries carry and the lists do not have, each with a way to add it. */
function Strays({
  strays,
  canChange,
  onAddType,
  onAddDate,
}: {
  strays: SchemaResponse["strays"];
  canChange: boolean;
  onAddType: (name: string) => void;
  onAddDate: (name: string) => void;
}) {
  if (strays.types.length + strays.what.length === 0) return null;
  return (
    <ul className="types-strays">
      {strays.types.map((s) => (
        <li key={`t-${s.name}`} className="settings-note">
          <span>
            {plural(s.entries, "entry has", "entries have")} the type <b>{s.name}</b>, which is not
            on the list.
          </span>
          {canChange && typeNameProblem(s.name, []) === null && (
            <button type="button" className="quiet" onClick={() => onAddType(s.name)}>
              Add “{s.name}”
            </button>
          )}
        </li>
      ))}
      {strays.what.map((s) => (
        <li key={`w-${s.name}`} className="settings-note">
          <span>
            {plural(s.entries, "date says", "dates say")} <b>{s.name}</b>, which is not on the list.
          </span>
          {canChange && (
            <button type="button" className="quiet" onClick={() => onAddDate(s.name)}>
              Add “{s.name}”
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A field and a button that add one word to a list; Enter adds too. */
function AddWord({
  label,
  placeholder,
  check,
  onAdd,
  children,
}: {
  label: string;
  placeholder: string;
  check: (name: string) => string | null;
  onAdd: (name: string) => void;
  children?: ReactNode;
}) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const word = name.trim();
    const bad = check(word);
    setProblem(bad);
    if (bad) return;
    onAdd(word);
    setName("");
  }
  return (
    <form className="types-add" onSubmit={submit}>
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={name}
        maxLength={60}
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
          setProblem(null);
        }}
      />
      {children}
      <button type="submit" className="quiet">
        {label}
      </button>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** A name that turns into a field to rename it: Enter keeps the new name, Escape leaves it. */
function Renamer({
  name,
  label,
  check,
  onRename,
  onClose,
}: {
  name: string;
  label: string;
  check: (name: string) => string | null;
  onRename: (to: string) => Promise<boolean> | void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const word = typed.trim();
    if (word === name) return onClose();
    const bad = check(word);
    setProblem(bad);
    if (bad) return;
    setBusy(true);
    const ok = await onRename(word);
    setBusy(false);
    if (ok !== false) onClose();
  }
  return (
    <form className="types-add types-rename" onSubmit={(e) => void submit(e)}>
      <input
        type="text"
        aria-label={label}
        value={typed}
        maxLength={60}
        autoFocus
        autoComplete="off"
        onChange={(e) => {
          setTyped(e.target.value);
          setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <button type="submit" className="quiet" disabled={busy}>
        {busy ? "Renaming…" : "Rename"}
      </button>
      <button type="button" className="plain" onClick={onClose}>
        Cancel
      </button>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** One type: its name, its folders, the properties it gives and the dates it usually has. */
function TypeDetail({
  type,
  file,
  canChange,
  entries,
  folders,
  allFolders,
  folderTypes,
  onBack,
  onChange,
  onRename,
  onRenameProp,
  onCount,
  onRemove,
  onFolder,
}: {
  type: TypeLine;
  file: TypesFile;
  canChange: boolean;
  entries: number | null;
  folders: string[];
  allFolders: string[];
  folderTypes: FolderFile | null;
  onBack: (() => void) | null;
  onChange: (fn: (type: TypeLine) => TypeLine) => void;
  onRename: (to: string) => Promise<boolean>;
  onRenameProp: (from: string, to: string) => Promise<boolean>;
  onCount: (to: string) => Promise<{ entries: number; folders: number }>;
  onRemove: () => void;
  onFolder: (path: string, on: boolean) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [renamingProp, setRenamingProp] = useState<string | null>(null);
  const [reach, setReach] = useState<string | null>(null);
  const folderLabel = useId();
  const others = file.types.map((t) => t.name).filter((n) => n !== type.name);
  const setProp = (key: string, fn: (prop: TypeProp) => TypeProp) =>
    onChange((t) => ({ ...t, props: t.props.map((p) => (p.key === key ? fn(p) : p)) }));
  const offers = Object.keys(SYSTEM_PROPS).filter((k) => !type.props.some((p) => same(p.key, k)));
  const freeDates = file.what.map((w) => w.name).filter((d) => !type.dates.includes(d));
  const typeOfFolder = (path: string) => folderTypes?.folders.find((l) => l.path === path)?.type;
  const freeFolders = allFolders.filter((f) => !folders.includes(f));

  return (
    <div className="type-detail" aria-label={`The type ${type.name}`} role="group">
      {onBack && (
        <button type="button" className="plain settings-back" onClick={onBack}>
          <Icon icon={ChevronLeft} size="sm" /> Types and dates
        </button>
      )}
      {renaming ? (
        <Renamer
          name={type.name}
          label={`New name for ${type.name}`}
          check={(name) => typeNameProblem(name, others)}
          onClose={() => {
            setRenaming(false);
            setReach(null);
          }}
          onRename={async (to) => {
            // Said before it is done: a rename reaches into entries and folders.
            if (reach === null) {
              const n = await onCount(to).catch(() => null);
              if (n && n.entries + n.folders > 0) {
                const parts = [
                  n.entries > 0 && plural(n.entries, "entry", "entries"),
                  n.folders > 0 && plural(n.folders, "folder", "folders"),
                ].filter(Boolean);
                setReach(`${parts.join(" and ")} will say “${to}”. Press Rename again to do it.`);
                return false;
              }
            }
            return onRename(to);
          }}
        />
      ) : (
        <h3 className="type-name">
          {type.name}
          {canChange && (
            <>
              <IconButton
                label={`Rename ${type.name}`}
                icon={Pencil}
                size="sm"
                onClick={() => setRenaming(true)}
              />
              <IconButton
                label={`Delete ${type.name}`}
                icon={Trash2}
                size="sm"
                onClick={() => setRemoving(true)}
              />
            </>
          )}
        </h3>
      )}
      {reach && renaming && <p className="settings-note">{reach}</p>}
      {removing && (
        <div
          className="settings-note types-confirm"
          role="alertdialog"
          aria-label="Delete this type"
        >
          <p>
            Delete <b>{type.name}</b>?{" "}
            {entries
              ? `${plural(entries, "entry", "entries")} will have no type, or keep the word and be listed as not on the list. Nothing in their text changes.`
              : "No entry uses it."}
          </p>
          <button type="button" className="quiet danger" onClick={onRemove}>
            Delete
          </button>
          <button type="button" className="plain" onClick={() => setRemoving(false)}>
            Keep
          </button>
        </div>
      )}
      <p className="muted">
        {entries === null
          ? ""
          : entries === 0
            ? "No entries yet."
            : `${plural(entries, "entry", "entries")}.`}
      </p>

      <h4 id={folderLabel}>Folders that give it</h4>
      <div className="types-chips">
        {folders.length === 0 && <span className="muted">No folder.</span>}
        {folders.map((path) => (
          <span key={path} className="types-chip" title={path}>
            <span>{path.split("/").pop()}</span>
            {canChange && (
              <button
                type="button"
                aria-label={`Remove ${path} from ${type.name}`}
                onClick={() => onFolder(path, false)}
              >
                <Icon icon={X} size="sm" />
              </button>
            )}
          </span>
        ))}
        {canChange && freeFolders.length > 0 && (
          <Combobox
            labelledBy={folderLabel}
            options={freeFolders.map((path) => {
              const now = typeOfFolder(path);
              return { value: path, label: now ? `${path} (now ${now})` : path };
            })}
            value=""
            onChange={(path) => path && onFolder(path, true)}
            findLabel="Find a folder"
            empty="No folder has that name."
            placeholder="Add a folder"
          />
        )}
      </div>

      <h4>Properties</h4>
      <ul className="types-list types-props">
        {type.props.length === 0 && (
          <li className="types-empty">
            No properties. A {type.name} shows only what each entry adds itself.
          </li>
        )}
        {type.props.map((prop) =>
          renamingProp === prop.key ? (
            <li key={prop.key}>
              <Renamer
                name={prop.key}
                label={`New name for ${prop.key}`}
                check={(name) =>
                  wordProblem(
                    name,
                    type.props.map((p) => p.key).filter((k) => k !== prop.key),
                  )
                }
                onClose={() => setRenamingProp(null)}
                onRename={(to) => onRenameProp(prop.key, to)}
              />
            </li>
          ) : (
            <PropRow
              key={prop.key}
              prop={prop}
              typeName={type.name}
              types={file.types.map((t) => t.name)}
              canChange={canChange}
              onChange={(fn) => setProp(prop.key, fn)}
              onRename={() => setRenamingProp(prop.key)}
              onRemove={() =>
                onChange((t) => ({ ...t, props: t.props.filter((p) => p.key !== prop.key) }))
              }
            />
          ),
        )}
        {canChange && (
          <li>
            <AddProp
              taken={type.props.map((p) => p.key)}
              onAdd={(prop) => onChange((t) => ({ ...t, props: [...t.props, prop] }))}
            />
            {offers.map((key) => (
              <button
                key={key}
                type="button"
                className="plain types-offer"
                onClick={() =>
                  onChange((t) => ({
                    ...t,
                    props: [...t.props, { key, kind: SYSTEM_PROPS[key]!.kind, value: true }],
                  }))
                }
              >
                + {SYSTEM_PROPS[key]!.label}
              </button>
            ))}
          </li>
        )}
      </ul>
      <p className="field-hint">
        Every {type.name} shows these as fields, empty until filled. A value given here holds for
        all of them unless an entry sets its own.
      </p>

      <h4>Usual dates</h4>
      <div className="types-chips">
        {type.dates.length === 0 && <span className="muted">None.</span>}
        {type.dates.map((d) => (
          <span key={d} className="types-chip">
            <span>{d}</span>
            {canChange && (
              <button
                type="button"
                aria-label={`Remove ${d} from the usual dates`}
                onClick={() => onChange((t) => ({ ...t, dates: t.dates.filter((x) => x !== d) }))}
              >
                <Icon icon={X} size="sm" />
              </button>
            )}
          </span>
        ))}
        {canChange && freeDates.length > 0 && (
          <select
            className="types-chip-add"
            aria-label="Add a usual date"
            value=""
            onChange={(e) => {
              const d = e.target.value;
              if (d) onChange((t) => ({ ...t, dates: [...t.dates, d] }));
            }}
          >
            <option value="">+ date</option>
            {freeDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="field-hint">An entry of this type offers these dates, ready to fill.</p>
    </div>
  );
}

/** Asks for a new property's name and kind. */
function AddProp({ taken, onAdd }: { taken: string[]; onAdd: (prop: TypeProp) => void }) {
  const [kind, setKind] = useState<TypePropKind>("text");
  return (
    <AddWord
      label="Add a property"
      placeholder="such as allegiance"
      check={(name) => wordProblem(name, taken)}
      onAdd={(key) => onAdd(withKind({ key, kind }, kind))}
    >
      <select
        aria-label="Kind of the new property"
        value={kind}
        onChange={(e) => setKind(e.target.value as TypePropKind)}
      >
        {TYPE_PROP_KINDS.map((k) => (
          <option key={k} value={k}>
            {TYPE_PROP_KIND_NAMES[k]}
          </option>
        ))}
      </select>
    </AddWord>
  );
}

/** One property of a type: its kind, what the kind needs, and the value every entry gets. */
function PropRow({
  prop,
  typeName,
  types,
  canChange,
  onChange,
  onRename,
  onRemove,
}: {
  prop: TypeProp;
  typeName: string;
  types: string[];
  canChange: boolean;
  onChange: (fn: (prop: TypeProp) => TypeProp) => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const system = SYSTEM_PROPS[prop.key.toLowerCase()];
  const label = system?.label ?? prop.key;
  const [typed, setTyped] = useState(() => textOf(prop.value));
  const [options, setOptions] = useState(() => (prop.options ?? []).join(", "));
  useEffect(() => setTyped(textOf(prop.value)), [prop.value]);
  const linksOut = ["link", "map", "chronicle", "tree"].includes(prop.kind);
  const setValue = (value: TypeProp["value"]) =>
    onChange((p) => {
      const rest = { ...p };
      delete rest.value;
      return value === undefined ? rest : { ...rest, value };
    });

  if (!canChange) {
    return (
      <li className="types-prop">
        <span className="types-prop-name">{label}</span>
        <span className="muted">
          {TYPE_PROP_KIND_NAMES[prop.kind]}
          {prop.to ? `, to a ${prop.to}` : ""}
          {prop.options?.length ? `: ${prop.options.join(", ")}` : ""}
          {prop.value !== undefined
            ? ` · ${prop.kind === "checkbox" ? (prop.value ? "on" : "off") : textOf(prop.value)} for every ${typeName}`
            : ""}
        </span>
      </li>
    );
  }
  return (
    <li className="types-prop" data-key={prop.key}>
      <span className="types-prop-name">
        {label}
        {system && <span className="types-tag">Frontier uses this</span>}
      </span>
      <div className="types-prop-value">
        {system ? (
          <span className="muted">{TYPE_PROP_KIND_NAMES[prop.kind]}</span>
        ) : (
          <select
            aria-label={`Kind of ${prop.key}`}
            value={prop.kind}
            onChange={(e) => onChange((p) => withKind(p, e.target.value as TypePropKind))}
          >
            {TYPE_PROP_KINDS.map((k) => (
              <option key={k} value={k}>
                {TYPE_PROP_KIND_NAMES[k]}
              </option>
            ))}
          </select>
        )}
        {prop.kind === "link" && (
          <select
            aria-label={`${prop.key} links to`}
            value={prop.to ?? ""}
            onChange={(e) =>
              onChange((p) => {
                const rest = { ...p };
                delete rest.to;
                return e.target.value ? { ...rest, to: e.target.value } : rest;
              })
            }
          >
            <option value="">to any entry</option>
            {types.map((t) => (
              <option key={t} value={t}>
                to a {t}
              </option>
            ))}
          </select>
        )}
        {prop.kind === "choice" && (
          <input
            type="text"
            aria-label={`Choices for ${prop.key}`}
            placeholder="The choices, separated with commas"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            onBlur={() =>
              onChange((p) => ({
                ...p,
                options: [
                  ...new Set(
                    options
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ),
                ],
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        )}
        {prop.kind === "checkbox" ? (
          <label className="types-check">
            <input
              type="checkbox"
              checked={prop.value === true}
              onChange={(e) => setValue(e.target.checked ? true : undefined)}
            />{" "}
            on for every {typeName}
          </label>
        ) : prop.kind === "choice" ? (
          <select
            aria-label={`Value every ${typeName} gets for ${prop.key}`}
            value={typeof prop.value === "string" ? prop.value : ""}
            onChange={(e) => setValue(e.target.value || undefined)}
          >
            <option value="">no value given</option>
            {(prop.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          !linksOut && (
            <input
              type={prop.kind === "date" ? "date" : "text"}
              inputMode={prop.kind === "number" ? "decimal" : undefined}
              aria-label={`Value every ${typeName} gets for ${prop.key}`}
              placeholder="no value given"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setValue(givenValue(prop, typed))}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          )
        )}
      </div>
      <span className="types-prop-actions">
        {!system && (
          <IconButton label={`Rename ${prop.key}`} icon={Pencil} size="sm" onClick={onRename} />
        )}
        <IconButton
          label={`Remove ${label} from ${typeName}`}
          icon={X}
          size="sm"
          tipSide="left"
          onClick={onRemove}
        />
      </span>
      {system && (
        <p className="field-hint types-prop-hint">
          {system.hint} Written as <code>{prop.key}</code>.
        </p>
      )}
    </li>
  );
}

const ROLES = [
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "moment", label: "Moment" },
] as const;
type Role = (typeof ROLES)[number]["value"];
const roleOf = (d: DateName): Role => (d.begins ? "start" : d.ends ? "end" : "moment");
const withRole = (d: DateName, role: Role): DateName => ({
  name: d.name,
  ...(role === "start" ? { begins: true as const } : {}),
  ...(role === "end" ? { ends: true as const } : {}),
});

/** The names a date can carry, each a start, an end or a moment. */
function DateNames({
  names,
  counts,
  canChange,
  onChange,
  onRename,
  onRemove,
  onUsual,
}: {
  names: DateName[];
  counts: Record<string, number> | null;
  canChange: boolean;
  onChange: (fn: (names: DateName[]) => DateName[]) => void;
  onRename: (from: string, to: string) => Promise<boolean>;
  onRemove: (name: string) => void;
  onUsual: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <>
      <h2>Names for dates</h2>
      <p className="muted">
        What a date on an entry says happened. A start and an end give an entry its lifespan: the
        years under a person in a tree, and what the AI reads as born and died.
      </p>
      <ul className="types-list types-dates" aria-label="Names for dates">
        {names.length === 0 && (
          <li className="types-empty">
            No names. A date on an entry needs one, such as “born” or “founded”.
            {canChange && (
              <button type="button" className="quiet" onClick={onUsual}>
                Put back the usual nine
              </button>
            )}
          </li>
        )}
        {names.map((d) => {
          const n = counts?.[d.name];
          if (renaming === d.name) {
            return (
              <li key={d.name}>
                <Renamer
                  name={d.name}
                  label={`New name for ${d.name}`}
                  check={(name) =>
                    wordProblem(
                      name,
                      names.map((x) => x.name).filter((x) => x !== d.name),
                    )
                  }
                  onClose={() => setRenaming(null)}
                  onRename={(to) => onRename(d.name, to)}
                />
              </li>
            );
          }
          return (
            <li key={d.name} className="types-date">
              <span className="types-prop-name">{d.name}</span>
              {canChange ? (
                <span className="types-role" role="radiogroup" aria-label={`${d.name} is`}>
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={roleOf(d) === r.value}
                      tabIndex={roleOf(d) === r.value ? 0 : -1}
                      onClick={() =>
                        onChange((list) =>
                          list.map((x) => (x.name === d.name ? withRole(x, r.value) : x)),
                        )
                      }
                      onKeyDown={(e) => {
                        const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                        if (!by) return;
                        e.preventDefault();
                        const at = ROLES.findIndex((x) => x.value === roleOf(d));
                        const next = ROLES[(at + by + ROLES.length) % ROLES.length]!;
                        onChange((list) =>
                          list.map((x) => (x.name === d.name ? withRole(x, next.value) : x)),
                        );
                        const group = e.currentTarget.parentElement;
                        window.setTimeout(() =>
                          group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
                        );
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </span>
              ) : (
                <span className="muted">{ROLES.find((r) => r.value === roleOf(d))!.label}</span>
              )}
              <span className="types-count">
                {n === undefined ? (counts ? "unused" : "") : plural(n, "date", "dates")}
              </span>
              {canChange && (
                <span className="types-prop-actions">
                  <IconButton
                    label={`Rename ${d.name}`}
                    icon={Pencil}
                    size="sm"
                    onClick={() => setRenaming(d.name)}
                  />
                  <IconButton
                    label={`Delete ${d.name}`}
                    icon={Trash2}
                    size="sm"
                    tipSide="left"
                    onClick={() => onRemove(d.name)}
                  />
                </span>
              )}
            </li>
          );
        })}
        {canChange && (
          <li>
            <AddWord
              label="Add a name"
              placeholder="such as crowned"
              check={(name) =>
                wordProblem(
                  name,
                  names.map((x) => x.name),
                )
              }
              onAdd={(name) => onChange((list) => [...list, { name }])}
            />
          </li>
        )}
      </ul>
    </>
  );
}
