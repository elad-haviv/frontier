import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl, newDraftId, type PassageComment } from "../api.ts";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { EditToolbar } from "../components/EditToolbar.tsx";
import { passageOf, WritingPanel } from "../components/WritingPanel.tsx";
import { CommentsPanel } from "../components/CommentsPanel.tsx";
import { type Anchor, anchorAt, locate, MIN_QUOTE } from "../components/anchor.ts";
import { setCommentMarks } from "../components/commentMarks.ts";
import { Properties } from "../components/Properties.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { clearBuffer, readBuffer, writeBuffer } from "../drafts.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { Trash2, Undo2 } from "lucide-react";

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
  const dialogs = useDialogs();
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
  // Writing help is offered once a model for it is chosen.
  const [writing, setWriting] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    api.conversations().then(
      (r) => setCanWrite(r.ready),
      () => setCanWrite(false),
    );
  }, []);
  // Comments on passages: highlighted in the text, listed in their panel.
  const [comments, setComments] = useState<PassageComment[]>([]);
  const [commenting, setCommenting] = useState<{
    adding: (Anchor & { from: number; to: number }) | null;
    /** Changes each time the panel is opened, so it starts afresh. */
    n: number;
  } | null>(() =>
    new URLSearchParams(search).get("comments") === "1" ? { adding: null, n: 0 } : null,
  );
  const commentsNow = useRef<PassageComment[]>([]);
  // Highlights move with typing; after a pause they are found again from the words, so an undone
  // deletion or a replaced text brings them back. The pause also redraws the panel's list.
  const marksTimer = useRef<number | undefined>(undefined);
  const [, setTextTick] = useState(0);
  const placeMarks = useCallback((list: PassageComment[]) => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    v.dispatch({
      effects: setCommentMarks.of(
        list.flatMap((c) => {
          const at = locate(text, c);
          return at ? [{ id: c.id, ...at }] : [];
        }),
      ),
    });
  }, []);
  const loadComments = useCallback(async () => {
    const list = await api.comments(path).then(
      (r) => r.comments,
      () => null,
    );
    if (!list) return;
    commentsNow.current = list;
    setComments(list);
    placeMarks(list);
  }, [path, placeMarks]);
  const [inTable, setInTable] = useState(false);
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
      window.clearTimeout(marksTimer.current);
      marksTimer.current = window.setTimeout(() => {
        placeMarks(commentsNow.current);
        setTextTick((n) => n + 1);
      }, 500);
    },
    [path, save, placeMarks],
  );

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(marksTimer.current);
    },
    [],
  );

  // Once the editor holds the text, its comments are found and highlighted.
  useEffect(() => {
    if (initial !== null) void loadComments();
  }, [initial, loadComments]);

  function comment() {
    const v = view.current;
    if (!v) return;
    const at = passageOf(v);
    if (at.text.replace(/\s/g, "").length < MIN_QUOTE) {
      setMessage("Select a few words, or put the cursor in a paragraph, to comment on it.");
      return;
    }
    if (at.text.length > 6000) {
      setMessage("That passage is too long for one comment. Select a shorter part of it.");
      return;
    }
    setMessage(null);
    setWriting(false);
    setCommenting((c) => ({
      adding: { ...anchorAt(v.state.doc.toString(), at.from, at.to), ...at },
      n: (c?.n ?? 0) + 1,
    }));
  }

  // Coming back to this tab: if the server changed the draft meanwhile, such as by accepting a
  // proposed field on another device, and nothing here is unsent, show the server's text.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || saving.current) return;
      const entry = await api.entry(path).catch(() => null);
      const v = view.current;
      if (!entry?.draft || !v || entry.draft.id !== draft.current.id) return;
      if (entry.draft.revision <= draft.current.revision) return;
      if (latest.current !== v.state.doc.toString() || readBuffer(path)) return;
      draft.current.revision = entry.draft.revision;
      latest.current = entry.text;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: entry.text } });
      // The line above reports a change like typing does; this text is the server's already.
      window.clearTimeout(timer.current);
      clearBuffer(path);
      setState("saved");
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [path]);

  async function done() {
    window.clearTimeout(timer.current);
    if (state === "unsaved" || state === "offline") await save();
    navigate(entryUrl(path));
  }

  // The editor's keys: Ctrl+S sends the text now instead of after the pause, Ctrl+Enter is Done.
  useScope("editor");
  useScope("table");
  useShortcut("editor.save", () => {
    window.clearTimeout(timer.current);
    void save();
  });
  useShortcut("editor.done", () => void done());

  // The folded frontmatter line in the text opens the Properties panel, at its first field.
  const properties = useRef<HTMLDetailsElement>(null);
  const openProperties = useCallback(() => {
    const panel = properties.current;
    if (!panel) return;
    panel.open = true;
    panel.scrollIntoView({ block: "nearest" });
    panel.querySelector<HTMLElement>("summary")?.focus();
  }, []);

  async function discard() {
    const ok = await dialogs.confirm({
      title: "Discard this draft?",
      body: "What is saved in the library stays as it is.",
      action: "Discard",
      danger: true,
    });
    if (!ok) return;
    window.clearTimeout(timer.current);
    clearBuffer(path);
    if (draft.current.revision > 0) await api.discardDraft(draft.current.id).catch(() => undefined);
    refresh();
    navigate(draft.current.kind === "create" ? "/" : entryUrl(path));
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: "Delete this entry?",
      body: "It is removed from the library when you save a version. Until then you can still bring it back.",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
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
          <button
            type="button"
            className="quiet"
            aria-pressed={commenting !== null}
            onClick={() => setCommenting((c) => (c ? null : { adding: null, n: Date.now() }))}
          >
            Comments{comments.length > 0 ? ` (${comments.length})` : ""}
          </button>
          <button type="button" className="primary" onClick={done}>
            Done
          </button>
          {/* Taking things back and away sit apart from Done, behind one more press. */}
          <Menu label="More actions" className="editor-more">
            <MenuItem icon={Undo2} onSelect={() => void discard()}>
              Discard draft
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onSelect={() => void remove()}>
              Delete entry
            </MenuItem>
          </Menu>
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
      <Properties view={view} ref={properties} />
      <CodeEditor
        key={path}
        initial={initial}
        onChange={onChange}
        viewRef={view}
        preview={preview}
        onFiles={addImages}
        path={path}
        onTable={setInTable}
        onProperties={openProperties}
      />
      {writing && view.current && (
        <WritingPanel view={view.current} path={path} onClose={() => setWriting(false)} />
      )}
      {commenting && view.current && (
        <CommentsPanel
          key={commenting.n}
          view={view.current}
          path={path}
          comments={comments}
          adding={commenting.adding}
          canAi={canWrite}
          onChanged={() => void loadComments()}
          onClose={() => setCommenting(null)}
        />
      )}
      <EditToolbar
        view={view}
        onFiles={addImages}
        inTable={inTable}
        onComment={comment}
        {...(canWrite
          ? {
              onWrite: () => {
                setCommenting(null);
                setWriting(true);
              },
            }
          : {})}
      />
    </div>
  );
}
