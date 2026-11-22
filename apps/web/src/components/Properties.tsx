import {
  FrontmatterError,
  readFields,
  readFrontmatter,
  removeFrontmatterKey,
  setFrontmatterKey,
  setTime,
  setType,
  type TimeItem,
} from "@frontier/vault";
import type { SchemaResponse } from "@frontier/schema";
import type { EditorView } from "@codemirror/view";
import { type Ref, useState } from "react";
import { api } from "../api.ts";

const LISTS = [
  { key: "aliases", label: "Other names", hint: "Names that also link to this entry" },
  { key: "tags", label: "Tags", hint: "" },
] as const;

const UNREADABLE =
  "The properties block at the top of this note cannot be read. Fix it in the text.";

function listOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

const parse = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Replaces the editor's text with `next`, touching only the part that differs. */
function applyText(view: EditorView, next: string) {
  const now = view.state.doc.toString();
  if (now === next) return;
  let start = 0;
  const max = Math.min(now.length, next.length);
  while (start < max && now[start] === next[start]) start++;
  let endNow = now.length;
  let endNext = next.length;
  while (endNow > start && endNext > start && now[endNow - 1] === next[endNext - 1]) {
    endNow--;
    endNext--;
  }
  view.dispatch({ changes: { from: start, to: endNow, insert: next.slice(start, endNext) } });
}

interface Loaded {
  lists: Record<string, string>;
  type: string;
  time: TimeItem[];
  /** False while the note's `time` cannot be read; it is then changed in the text only. */
  timeReadable: boolean;
}

/**
 * The note's properties as form fields: other names, tags, type and dates. Each field writes only
 * its own key in the frontmatter; every other line of the note stays as written.
 */
export function Properties({
  view,
  ref,
}: {
  view: { current: EditorView | null };
  /** The panel itself, so the editor's folded frontmatter line can open it. */
  ref?: Ref<HTMLDetailsElement>;
}) {
  const [values, setValues] = useState<Loaded | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const v = view.current;
    if (!v) return;
    if (!schema) api.schema().then(setSchema, () => undefined);
    const text = v.state.doc.toString();
    const { data, error: bad } = readFrontmatter(text);
    if (bad) {
      setValues(null);
      setError(UNREADABLE);
      return;
    }
    const fields = readFields(text);
    setValues({
      lists: Object.fromEntries(LISTS.map((f) => [f.key, listOf(data?.[f.key]).join(", ")])),
      type: fields.type ?? "",
      time: fields.time,
      timeReadable: !fields.problems.some((p) => p.includes("`time`")),
    });
    setError(null);
  }

  /** Runs one change on the note's text and puts the result in the editor. */
  function write(change: (text: string) => string) {
    const v = view.current;
    if (!v) return;
    try {
      applyText(v, change(v.state.doc.toString()));
      setError(null);
    } catch (err) {
      setError(err instanceof FrontmatterError ? UNREADABLE : "Could not write the property.");
    }
  }

  function commitList(key: string, raw: string) {
    write((text) => {
      const before = listOf(readFrontmatter(text).data?.[key]);
      const list = parse(raw);
      if (before.join("\n") === list.join("\n")) return text;
      return list.length ? setFrontmatterKey(text, key, list) : removeFrontmatterKey(text, key);
    });
  }

  function commitTime(time: TimeItem[]) {
    setValues((now) => (now ? { ...now, time } : now));
    // A row is written once it says both what happened and when.
    const complete = time.filter((t) => t.what.trim() !== "" && t.when.trim() !== "");
    write((text) => {
      const before = readFields(text).time;
      if (JSON.stringify(before) === JSON.stringify(complete)) return text;
      return setTime(text, complete);
    });
  }

  const types = schema ? [...schema.types] : [];
  if (values?.type && !types.includes(values.type)) types.push(values.type);
  const whats = (current: string) => {
    const all = schema ? [...schema.what] : [];
    if (current && !all.includes(current)) all.push(current);
    return all;
  };

  return (
    <details ref={ref} className="props" onToggle={(e) => e.currentTarget.open && load()}>
      <summary>Properties</summary>
      {error && <p className="error">{error}</p>}
      {values && (
        <>
          {LISTS.map((f) => (
            <label key={f.key} className="props-field">
              <span>{f.label}</span>
              <input
                type="text"
                value={values.lists[f.key] ?? ""}
                placeholder={f.hint || "Separate with commas"}
                onChange={(e) =>
                  setValues({ ...values, lists: { ...values.lists, [f.key]: e.target.value } })
                }
                onBlur={(e) => commitList(f.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitList(f.key, e.currentTarget.value);
                }}
              />
            </label>
          ))}
          <label className="props-field">
            <span>Type</span>
            <select
              value={values.type}
              onChange={(e) => {
                const type = e.target.value;
                setValues({ ...values, type });
                write((text) => setType(text, type || null));
              }}
            >
              <option value="">From its folder</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="props-time">
            <span>Dates</span>
            {!values.timeReadable && (
              <p className="error">
                The dates of this note cannot be read. Correct them in the text first.
              </p>
            )}
            {values.timeReadable &&
              values.time.map((item, i) => (
                <div key={i} className="props-time-row">
                  <select
                    aria-label="What happened"
                    value={item.what}
                    onChange={(e) =>
                      commitTime(
                        values.time.map((t, j) => (j === i ? { ...t, what: e.target.value } : t)),
                      )
                    }
                  >
                    <option value="">What…</option>
                    {whats(item.what).map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    aria-label="When, in the lore's own words"
                    placeholder="When, in the lore's own words"
                    value={item.when}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        time: values.time.map((t, j) =>
                          j === i ? { ...t, when: e.target.value } : t,
                        ),
                      })
                    }
                    onBlur={() => commitTime(values.time)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitTime(values.time);
                    }}
                  />
                  <button
                    type="button"
                    className="plain danger"
                    aria-label="Remove this date"
                    onClick={() => commitTime(values.time.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            {values.timeReadable && (
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  setValues({ ...values, time: [...values.time, { what: "", when: "" }] })
                }
              >
                + Add a date
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
