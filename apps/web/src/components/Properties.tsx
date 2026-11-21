import {
  FrontmatterError,
  readFrontmatter,
  removeFrontmatterKey,
  setFrontmatterKey,
} from "@frontier/vault";
import type { EditorView } from "@codemirror/view";
import { useState } from "react";

const FIELDS = [
  { key: "aliases", label: "Other names", hint: "Names that also link to this entry" },
  { key: "tags", label: "Tags", hint: "" },
] as const;

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

/**
 * The note's list properties as form fields. Each field writes only its own key in the
 * frontmatter; every other line of the note stays as written.
 */
export function Properties({ view }: { view: { current: EditorView | null } }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const v = view.current;
    if (!v) return;
    try {
      const { data } = readFrontmatter(v.state.doc.toString());
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, listOf(data?.[f.key]).join(", ")])));
      setError(null);
    } catch (err) {
      setValues(null);
      setError(
        err instanceof FrontmatterError
          ? "The properties block at the top of this note cannot be read. Fix it in the text."
          : "Could not read the properties.",
      );
    }
  }

  function commit(key: string, raw: string) {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    try {
      const before = listOf(readFrontmatter(text).data?.[key]);
      const list = parse(raw);
      if (before.join("\n") === list.join("\n")) return;
      applyText(
        v,
        list.length ? setFrontmatterKey(text, key, list) : removeFrontmatterKey(text, key),
      );
      setError(null);
    } catch {
      setError("The properties block at the top of this note cannot be read. Fix it in the text.");
    }
  }

  return (
    <details className="props" onToggle={(e) => e.currentTarget.open && load()}>
      <summary>Properties</summary>
      {error && <p className="error">{error}</p>}
      {values &&
        FIELDS.map((f) => (
          <label key={f.key} className="props-field">
            <span>{f.label}</span>
            <input
              type="text"
              value={values[f.key] ?? ""}
              placeholder={f.hint || "Separate with commas"}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              onBlur={(e) => commit(f.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(f.key, e.currentTarget.value);
              }}
            />
          </label>
        ))}
    </details>
  );
}
