import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl, newDraftId } from "../api.ts";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { EditToolbar } from "../components/EditToolbar.tsx";
import { Properties } from "../components/Properties.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { clearBuffer, readBuffer, writeBuffer } from "../drafts.ts";

type SaveState = "saved" | "saving" | "unsaved" | "offline" | "stale" | "failed";

const LABEL: Record<SaveState, string> = {
  saved: "Draft saved",
  saving: "Saving…",
  unsaved: "Unsaved",
  offline: "Offline: kept on this device, will send when back",
  stale: "Changed on another device",
  failed: "Could not save",
};

function pathFrom(pathname: string): string {
  return pathname
    .slice("/edit/".length)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

export function EditPage() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const path = pathFrom(pathname);
  const creating = new URLSearchParams(search).get("new") === "1";

  const [initial, setInitial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);

  const draft = useRef({
    id: "",
    revision: 0,
    kind: creating ? ("create" as const) : ("edit" as const),
  });
  const latest = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  const again = useRef(false);
  const view = useRef<EditorView | null>(null);
  const [preview, setPreview] = useState(() => {
    try {
      return localStorage.getItem("frontier.preview") !== "0";
    } catch {
      return true;
    }
  });

  function togglePreview() {
    setPreview((on) => {
      try {
        localStorage.setItem("frontier.preview", on ? "0" : "1");
      } catch {
        /* the choice lasts for this visit only */
      }
      return !on;
    });
  }

  /** Stores each image as an unpublished file and writes its embed where the cursor is. */
  const addImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        setMessage(`Adding ${file.name}…`);
        try {
          const { embed } = await api.upload(file);
          const v = view.current;
          if (v) {
            const { from, to } = v.state.selection.main;
            v.dispatch({
              changes: { from, to, insert: embed },
              selection: { anchor: from + embed.length },
            });
          }
          setMessage(null);
          refresh();
        } catch (err) {
          setMessage(err instanceof ApiFailure ? err.message : "Could not add the image.");
          return;
        }
      }
    },
    [refresh],
  );

  // Open the file: the server's draft or published text, or what this device still holds unsent.
  useEffect(() => {
    let live = true;
    (async () => {
      let text = "";
      let known = false;
      try {
        const entry = await api.entry(path);
        known = true;
        if (entry.readOnly) {
          setError("This file is read-only.");
          return;
        }
        text = entry.text;
        if (entry.draft && entry.draft.kind !== "delete") {
          draft.current = {
            id: entry.draft.id,
            revision: entry.draft.revision,
            kind: entry.draft.kind,
          };
        } else {
          draft.current = { id: newDraftId(), revision: 0, kind: "edit" };
        }
      } catch (err) {
        if (!(err instanceof ApiFailure) || err.status !== 404 || !creating) {
          if (live) setError(err instanceof ApiFailure ? err.message : "Could not open this file.");
          return;
        }
        const name = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
        text = `# ${name}\n\n`;
        draft.current = { id: newDraftId(), revision: 0, kind: "create" };
      }
      const buffered = readBuffer(path);
      if (buffered && buffered.text !== text && buffered.revision === draft.current.revision) {
        if (known || creating) {
          draft.current.id = draft.current.revision === 0 ? buffered.id : draft.current.id;
          text = buffered.text;
          setState("unsaved");
        }
      }
      if (!live) return;
      latest.current = text;
      setInitial(text);
      if (buffered && buffered.text === text && draft.current.revision > 0) clearBuffer(path);
    })();
    return () => {
      live = false;
    };
  }, [path, creating]);

  const save = useCallback(async () => {
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setState("saving");
    const text = latest.current;
    try {
      const res = await api.saveDraft({ ...draft.current, path, text });
      draft.current = { ...draft.current, id: res.id, revision: res.revision };
      if (latest.current === text) {
        clearBuffer(path);
        setState("saved");
      } else {
        writeBuffer(path, { id: res.id, text: latest.current, revision: res.revision });
      }
      setMessage(null);
      refresh();
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      if (failure?.code === "offline") {
        setState("offline");
        timer.current = window.setTimeout(() => void save(), 5000);
      } else if (failure?.code === "stale_revision") {
        setState("stale");
        setMessage(failure.message);
        clearBuffer(path);
        if (failure.draftId) draft.current.id = failure.draftId;
      } else {
        setState("failed");
        setMessage(failure?.message ?? "Something went wrong while saving.");
      }
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [path, refresh]);

  const onChange = useCallback(
    (text: string) => {
      latest.current = text;
      // Kept on this device at once; sent to the server after a second without typing.
      writeBuffer(path, { id: draft.current.id, text, revision: draft.current.revision });
      setState((s) => (s === "stale" ? s : "unsaved"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 1000);
    },
    [path, save],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function done() {
    window.clearTimeout(timer.current);
    if (state === "unsaved" || state === "offline") await save();
    navigate(entryUrl(path));
  }

  async function discard() {
    if (!window.confirm("Discard this draft? The published text stays as it is.")) return;
    window.clearTimeout(timer.current);
    clearBuffer(path);
    if (draft.current.revision > 0) await api.discardDraft(draft.current.id).catch(() => undefined);
    refresh();
    navigate(draft.current.kind === "create" ? "/" : entryUrl(path));
  }

  async function remove() {
    if (!window.confirm("Delete this entry? It is removed from the vault when you publish."))
      return;
    window.clearTimeout(timer.current);
    clearBuffer(path);
    try {
      if (draft.current.kind === "create") {
        if (draft.current.revision > 0) await api.discardDraft(draft.current.id);
      } else {
        await api.saveDraft({ ...draft.current, kind: "delete", path, text: "" });
      }
      refresh();
      navigate("/unpublished");
    } catch (err) {
      setMessage(err instanceof ApiFailure ? err.message : "Could not delete.");
    }
  }

  if (error) {
    return (
      <div className="center">
        <p className="error">{error}</p>
        <Link to={entryUrl(path)}>Back to the entry</Link>
      </div>
    );
  }
  if (initial === null) return <p className="center muted">Opening…</p>;

  return (
    <div className="editor-page">
      <div className="editor-bar">
        <span className="editor-path" title={path}>
          {path.split("/").pop()?.replace(/\.md$/i, "")}
        </span>
        <span className={`save-state save-${state}`} role="status">
          {LABEL[state]}
        </span>
        <span className="editor-actions">
          <button
            type="button"
            className="quiet"
            aria-pressed={preview}
            // Keeps the cursor in the text, and the phone keyboard open.
            onPointerDown={(e) => e.preventDefault()}
            onClick={togglePreview}
            title="Hide Markdown marks away from the line you are on"
          >
            Preview
          </button>
          <button type="button" className="quiet" onClick={remove}>
            Delete
          </button>
          <button type="button" className="quiet" onClick={discard}>
            Discard
          </button>
          <button type="button" className="primary" onClick={done}>
            Done
          </button>
        </span>
      </div>
      {message && (
        <p className="banner" role="alert">
          {message}{" "}
          {state === "stale" && (
            <Link to={`/versions/${draft.current.id}`}>Merge the two versions</Link>
          )}
        </p>
      )}
      <Properties view={view} />
      <CodeEditor
        key={path}
        initial={initial}
        onChange={onChange}
        viewRef={view}
        preview={preview}
        onFiles={addImages}
      />
      <EditToolbar view={view} onFiles={addImages} />
    </div>
  );
}
