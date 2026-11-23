import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl, fromServer, newDraftId, type PassageComment } from "../api.ts";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { EditToolbar } from "../components/EditToolbar.tsx";
import { EditorContextMenu } from "../components/EditorContextMenu.tsx";
import { type BlockStyle, insertEmbeds, lineStyle, run } from "../components/editCommands.ts";
import { LinkToEntry } from "../components/LinkToEntry.tsx";
import { passageOf, WritingPanel } from "../components/WritingPanel.tsx";
import { CommentsPanel } from "../components/CommentsPanel.tsx";
import { type Anchor, anchorAt, locate, MIN_QUOTE } from "../components/anchor.ts";
import { setCommentMarks } from "../components/commentMarks.ts";
import { Properties } from "../components/Properties.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu.tsx";
import { SaveStatus, useSaveState } from "../components/ui/SaveStatus.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { type QueueKey, queue } from "../sync/queue.ts";
import { connection, useNeedsConnection } from "../sync/connection.ts";
import { OfflineCopy, useReadAgain } from "../components/OfflineCopy.tsx";
import { entryAddress, markOpened, servedFromDevice } from "../offline/copy.ts";
import type { DraftKind } from "@frontier/schema";
import { setFrontmatterKey } from "@frontier/vault";
import { MessageSquare, SlidersHorizontal, Trash2, Undo2, WandSparkles } from "lucide-react";
import { PageAction, usePanel, useRightBar } from "../components/shell/panels.tsx";
import { useEditorOutline } from "../components/entry/EditorOutline.tsx";
import { WideMenuItem } from "../components/entry/WideMenuItem.tsx";
import { useWide } from "../width.ts";

/** Said when an image is pasted, dropped or picked with no connection. */
const IMAGES_NEED_CONNECTION = "Images need a connection. Your text stays.";

// The image dialog loads when it is first opened, so the editor opens as fast as before.
const ImagePicker = lazy(() =>
  import("../components/images/ImagePicker.tsx").then((m) => ({ default: m.ImagePicker })),
);

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
  /** The type the new entry's folder gives, written into its properties when the text is made. */
  const newType = creating ? new URLSearchParams(search).get("type") : null;

  const [initial, setInitial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** The draft the server kept this device's text beside, after it started from older text. */
  const [stale, setStale] = useState<string | null>(null);
  const key: QueueKey = `entry:${path}`;
  const saving = useSaveState(key);

  /** The draft this device knows of, and the library file it started from. */
  const draft = useRef<{ id: string; revision: number; kind: DraftKind; baseBlob: string }>({
    id: "",
    revision: 0,
    kind: creating ? "create" : "edit",
    baseBlob: "",
  });
  const latest = useRef("");
  const view = useRef<EditorView | null>(null);
  /** When the text was opened from this device's copy, the time that copy was stored. */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  /** The server's copy the text was opened from, to see whether a later read differs. */
  const openedFrom = useRef({ id: "", revision: 0, blob: "" });
  // The panels beside the text: Properties, Comments and, once a model is chosen, Writing help.
  const bar = useRightBar();
  // Discarding goes straight to the server, so it waits for a connection.
  const offline = useNeedsConnection();
  /** Changes each time Writing help is asked for, so it starts afresh on the passage. */
  const [writing, setWriting] = useState(0);
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
    /** Changes each time a comment is started, so the panel starts afresh. */
    n: number;
  }>({ adding: null, n: 0 });
  const askedForComments = new URLSearchParams(search).get("comments") === "1";
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
  // The style of the cursor's line, for the toolbar's style picker.
  const [style, setStyle] = useState<BlockStyle>("paragraph");
  // Told whenever the text or the cursor moves.
  const onCursorMoved = useCallback((inside: boolean) => {
    setInTable(inside);
    if (view.current) setStyle(lineStyle(view.current.state));
  }, []);
  const [linking, setLinking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState(() => {
    try {
      return localStorage.getItem("frontier.preview") !== "0";
    } catch {
      return true;
    }
  });

  function showPreview(on: boolean) {
    setPreview(on);
    try {
      localStorage.setItem("frontier.preview", on ? "1" : "0");
    } catch {
      /* the choice lasts for this visit only */
    }
  }

  /** Stores each image as an unpublished file and writes its embed where the cursor is. */
  const addImages = useCallback(
    async (files: File[]) => {
      // The server names an upload, and the text embeds that name: images wait for it.
      if (connection.state !== "online") {
        setMessage(IMAGES_NEED_CONNECTION);
        return;
      }
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
    setStale(null);
    (async () => {
      let text = "";
      try {
        const entry = await api.entry(path);
        if (entry.readOnly) {
          setError("This file is read-only.");
          return;
        }
        text = entry.text;
        if (live) setOfflineAt(servedFromDevice(entry));
        openedFrom.current = {
          id: entry.draft?.id ?? "",
          revision: entry.draft?.revision ?? 0,
          blob: entry.blob,
        };
        draft.current =
          entry.draft && entry.draft.kind !== "delete"
            ? { ...entry.draft, baseBlob: entry.blob }
            : { id: newDraftId(), revision: 0, kind: "edit", baseBlob: entry.blob };
      } catch (err) {
        if (!(err instanceof ApiFailure) || err.status !== 404 || !creating) {
          if (live) setError(err instanceof ApiFailure ? err.message : "Could not open this file.");
          return;
        }
        const name = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
        text = `# ${name}\n\n`;
        // The folder's type travels with the entry, so Obsidian sees it too.
        if (newType) text = setFrontmatterKey(text, "type", newType);
        draft.current = { id: newDraftId(), revision: 0, kind: "create", baseBlob: "" };
      }
      // Text this device has not sent yet is newer than the server's: it is what was typed last.
      const unsent = await queue.get(key);
      if (unsent && unsent.kind !== "delete") {
        text = String(unsent.value);
        draft.current = {
          id: unsent.draftId || draft.current.id,
          revision: unsent.revision,
          kind: unsent.kind ?? draft.current.kind,
          baseBlob: unsent.baseBlob ?? draft.current.baseBlob,
        };
      }
      if (!live) return;
      latest.current = text;
      setInitial(text);
    })();
    return () => {
      live = false;
    };
  }, [path, creating, newType, key]);

  // Opened: kept on this device among the recent entries.
  useEffect(() => markOpened(`entry:${path}`), [path]);

  // Opened from the device's copy: once the server answers, and nothing here is unsent, its copy
  // replaces the one opened if they differ. With a record, the record's base decides on the server.
  useReadAgain(offlineAt, entryAddress(path), () => {
    void (async () => {
      if (await queue.get(key)) return;
      const entry = await fromServer(() => api.entry(path)).catch(() => null);
      const v = view.current;
      if (!entry || !v || (await queue.get(key))) return;
      setOfflineAt(null);
      const was = openedFrom.current;
      const now = { id: entry.draft?.id ?? "", revision: entry.draft?.revision ?? 0 };
      if (now.id === was.id && now.revision === was.revision && entry.blob === was.blob) return;
      if (latest.current !== v.state.doc.toString()) return;
      openedFrom.current = { ...now, blob: entry.blob };
      draft.current =
        entry.draft && entry.draft.kind !== "delete"
          ? { ...entry.draft, baseBlob: entry.blob }
          : { id: newDraftId(), revision: 0, kind: "edit", baseBlob: entry.blob };
      latest.current = entry.text;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: entry.text } });
      // The line above reports a change like typing does; this text is the server's already.
      await queue.drop(key);
      setMessage("Updated from the server.");
    })();
  });

  // What the queue hears from the server about this file.
  useEffect(
    () =>
      queue.subscribe(key, (e) => {
        if (e.type === "saved") {
          draft.current = {
            ...draft.current,
            id: e.known.draftId,
            revision: e.known.revision,
          };
          setMessage(null);
          refresh();
        } else if (e.type === "stale") {
          // Text typed from now on goes to the same kept copy: revision 0 is never built on.
          draft.current = { ...draft.current, id: e.draftId, revision: 0 };
          setStale(e.draftId);
          refresh();
        }
      }),
    [key, refresh],
  );

  const onChange = useCallback(
    (text: string) => {
      latest.current = text;
      // Kept on this device at once; sent to the server after a second without typing.
      const { id, revision, kind, baseBlob } = draft.current;
      void queue.put(key, text, { kind, draftId: id, revision, baseBlob });
      window.clearTimeout(marksTimer.current);
      marksTimer.current = window.setTimeout(() => {
        placeMarks(commentsNow.current);
        setTextTick((n) => n + 1);
      }, 500);
    },
    [key, placeMarks],
  );

  useEffect(() => () => window.clearTimeout(marksTimer.current), []);

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
    setCommenting((c) => ({
      adding: { ...anchorAt(v.state.doc.toString(), at.from, at.to), ...at },
      n: c.n + 1,
    }));
    bar.show("comments");
  }

  // Coming back to this tab: if the server changed the draft meanwhile, such as by accepting a
  // proposed field on another device, and nothing here is unsent, show the server's text.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || (await queue.get(key))) return;
      const entry = await api.entry(path).catch(() => null);
      const v = view.current;
      if (!entry?.draft || !v || entry.draft.id !== draft.current.id) return;
      if (entry.draft.revision <= draft.current.revision) return;
      if (latest.current !== v.state.doc.toString() || (await queue.get(key))) return;
      draft.current.revision = entry.draft.revision;
      latest.current = entry.text;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: entry.text } });
      // The line above reports a change like typing does; this text is the server's already.
      await queue.drop(key);
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [path, key]);

  async function done() {
    // What waits is sent now; without a connection it stays on this device and goes later.
    await queue.sendNow(key);
    navigate(entryUrl(path));
  }

  // The editor's keys: Ctrl+S sends the text now instead of after the pause, Ctrl+Enter is Done.
  useScope("editor");
  useScope("table");
  useShortcut("editor.save", () => void queue.sendNow(key));
  useShortcut("editor.done", () => void done());

  // The folded frontmatter line in the text opens the Properties panel, at its first field.
  const [focusProperties, setFocusProperties] = useState(0);
  const showPanel = bar.show;
  const openProperties = useCallback(() => {
    setFocusProperties((n) => n + 1);
    showPanel("properties");
  }, [showPanel]);

  // Opened from the entry's count of comments: the Comments panel shows at once.
  const shownComments = useRef(false);
  useEffect(() => {
    if (initial === null || !askedForComments || shownComments.current) return;
    shownComments.current = true;
    showPanel("comments");
  }, [initial, askedForComments, showPanel]);

  usePanel(
    initial === null
      ? null
      : {
          id: "properties",
          title: "Properties",
          icon: SlidersHorizontal,
          render: () => <Properties key={path} view={view} focus={focusProperties} />,
        },
  );
  usePanel(
    initial === null
      ? null
      : {
          id: "comments",
          title: "Comments",
          icon: MessageSquare,
          ...(comments.length > 0 ? { badge: comments.length } : {}),
          render: () =>
            view.current && (
              <CommentsPanel
                key={`${path}:${commenting.n}`}
                view={view.current}
                path={path}
                comments={comments}
                adding={commenting.adding}
                canAi={canWrite}
                onChanged={() => {
                  setCommenting((c) => ({ ...c, adding: null }));
                  void loadComments();
                }}
                onClose={() => bar.hide()}
              />
            ),
        },
  );
  usePanel(
    initial === null || !canWrite
      ? null
      : {
          id: "writing",
          title: "Writing help",
          icon: WandSparkles,
          render: () =>
            view.current && (
              <WritingPanel
                key={`${path}:${writing}`}
                view={view.current}
                path={path}
                onClose={() => bar.hide()}
              />
            ),
        },
  );

  // The outline of the text, and full width, as on the entry's page.
  const outline = useEditorOutline(view);
  usePanel(initial === null ? null : outline.panel);
  const [wide] = useWide();

  async function discard() {
    const ok = await dialogs.confirm({
      title: "Discard this draft?",
      body: "What is saved in the library stays as it is.",
      action: "Discard",
      danger: true,
    });
    if (!ok) return;
    // The unsent text goes first; a send already on its way is waited for, so the draft it
    // makes is the one discarded.
    await queue.drop(key);
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
    try {
      if (draft.current.kind === "create") {
        await queue.drop(key);
        if (draft.current.revision > 0) await api.discardDraft(draft.current.id);
      } else {
        // The delete goes through the queue like any change, so it is kept until it is sent.
        const { id, revision, baseBlob } = draft.current;
        await queue.put(key, "", { kind: "delete", draftId: id, revision, baseBlob });
        await queue.sendNow(key);
        const refused = await queue.get(key);
        if (refused?.state === "attention") {
          setMessage(refused.error ?? "Could not delete.");
          return;
        }
      }
      refresh();
      navigate("/unpublished");
    } catch (err) {
      setMessage(err instanceof ApiFailure ? err.message : "Could not delete.");
    }
  }

  /** What the toolbar and the right-click menu open. */
  const tools = {
    onLink: () => setLinking(true),
    onImage: () => setPicking(true),
    onComment: comment,
    onWrite: canWrite
      ? () => {
          setWriting((n) => n + 1);
          bar.show("writing");
        }
      : undefined,
  };

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
    <div className={`editor-page${wide ? " is-wide" : ""}`}>
      <div className="editor-bar">
        <span className="editor-path" title={path}>
          {path.split("/").pop()?.replace(/\.md$/i, "")}
        </span>
        <SaveStatus state={stale ? "stale" : saving.state} />
        <span className="editor-actions">
          <span className="editor-view" role="group" aria-label="How the text is shown">
            <button
              type="button"
              className="quiet"
              aria-pressed={preview}
              // Keeps the cursor in the text, and the phone keyboard open.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => showPreview(true)}
              title="Show the text as it reads; marks show on the line you are on"
            >
              Live preview
            </button>
            <button
              type="button"
              className="quiet"
              aria-pressed={!preview}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => showPreview(false)}
              title="Show every Markdown mark, in a fixed-width font"
            >
              Source
            </button>
          </span>
          <button
            type="button"
            className="quiet"
            aria-pressed={bar.open === "properties"}
            onClick={() => bar.toggle("properties")}
          >
            Properties
          </button>
          <button
            type="button"
            className="quiet"
            aria-pressed={bar.open === "comments"}
            onClick={() => bar.toggle("comments")}
          >
            Comments{comments.length > 0 ? ` (${comments.length})` : ""}
          </button>
          {/* On a phone, Done moves into the top line, beside the title. */}
          <PageAction>
            <button type="button" className="primary" onClick={done}>
              Done
            </button>
          </PageAction>
          {/* Taking things back and away sit apart from Done, behind one more press. */}
          <Menu label="More actions" className="editor-more">
            <MenuItem
              icon={Undo2}
              disabled={offline !== undefined}
              disabledReason={offline}
              onSelect={() => void discard()}
            >
              Discard draft
            </MenuItem>
            <WideMenuItem />
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onSelect={() => void remove()}>
              Delete entry
            </MenuItem>
          </Menu>
        </span>
      </div>
      <OfflineCopy at={offlineAt} className="editor-offline" />
      {stale && (
        <p className="banner" role="alert">
          This entry was changed on another device after this text was started. Both texts are kept.{" "}
          <Link to={`/versions/${stale}`}>Compare the two texts</Link>
        </p>
      )}
      {(message ?? (saving.state === "failed" ? saving.error : null)) && (
        <p className="banner" role="alert">
          {message ?? saving.error}
        </p>
      )}
      <EditorContextMenu view={view} onFiles={addImages} {...tools}>
        <CodeEditor
          key={path}
          initial={initial}
          onChange={onChange}
          viewRef={view}
          preview={preview}
          onFiles={addImages}
          path={path}
          onTable={onCursorMoved}
          onProperties={openProperties}
          onCursor={outline.onCursor}
        />
      </EditorContextMenu>
      <EditToolbar view={view} inTable={inTable} style={style} {...tools} />
      {linking && view.current && (
        <LinkToEntry view={view.current} onClose={() => setLinking(false)} />
      )}
      {picking && (
        <Suspense fallback={null}>
          <ImagePicker
            onClose={() => {
              setPicking(false);
              view.current?.focus();
            }}
            onPick={(_paths, names) => {
              setPicking(false);
              refresh();
              const v = view.current;
              if (v) run(v, insertEmbeds(v.state, names));
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
