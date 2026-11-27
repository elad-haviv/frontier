import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "../nav.tsx";
import { api, ApiFailure, entryUrl, fromServer, newDraftId, type PassageComment } from "../api.ts";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { EditToolbar } from "../components/EditToolbar.tsx";
import { EditorContextMenu } from "../components/EditorContextMenu.tsx";
import { type BlockStyle, insertEmbeds, lineStyle, run } from "../components/editCommands.ts";
import { LinkToEntry } from "../components/LinkToEntry.tsx";
import { closeHelp, openHelp, passageOf, startHelp } from "../components/writing/helpCard.ts";
import { WritingHelp } from "../components/writing/WritingHelp.tsx";
import { CommentsPanel } from "../components/CommentsPanel.tsx";
import { openCount } from "../components/comments/model.ts";
import { CommentBubbles, useMargin } from "../components/comments/CommentBubbles.tsx";
import { type Anchor, anchorAt, locate, MIN_QUOTE } from "../components/anchor.ts";
import { setCommentMarks } from "../components/commentMarks.ts";
import { Properties } from "../components/Properties.tsx";
import { changesOf } from "../components/comments/model.ts";
import { useRefresh, useStatus } from "../components/Shell.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu.tsx";
import { SaveStatus, useSaveState } from "../components/ui/SaveStatus.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { recents } from "../keepGoing/recents.ts";
import { type QueueKey } from "../sync/queue.ts";
import { connection, useNeedsConnection } from "../sync/connection.ts";
import { OfflineCopy, useReadAgain } from "../components/OfflineCopy.tsx";
import { entryAddress, markOpened, NOT_ON_DEVICE, servedFromDevice } from "../offline/copy.ts";
import { folderTypeOf, type OfflineOpen, openOrCreate } from "../offline/openOrCreate.ts";
import { NotOnDevice } from "../components/NotOnDevice.tsx";
import type { DraftKind, FolderFile } from "@frontier/schema";
import { setFrontmatterKey } from "@frontier/vault";
import { MessageSquare, Scale, SlidersHorizontal, Trash2, Undo2 } from "lucide-react";
import { PageAction, usePanel, useRightBar } from "../components/shell/panels.tsx";
import { useEditorOutline } from "../components/entry/EditorOutline.tsx";
import { WideMenuItem } from "../components/entry/WideMenuItem.tsx";
import { useWide } from "../width.ts";
import { useProjectWork } from "../projectWork.ts";
import { useOthersUnsaved } from "../people/live.ts";
import { OthersNotice } from "../people/OthersNotice.tsx";

/** A phone, where the right bar is a sheet over the text. */
const PHONE = "(max-width: 47.99rem)";

/** Said when an image is pasted, dropped or picked with no connection. */
const IMAGES_NEED_CONNECTION = "Images need a connection. Your text stays.";

// The image dialog loads when it is first opened, so the editor opens as fast as before.
const ConsultPanel = lazy(() =>
  import("../components/consult/ConsultPanel.tsx").then((m) => ({ default: m.ConsultPanel })),
);
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
  const work = useProjectWork();
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
  /** Offline, an entry the library has whose text is not on this device (stage 15c). */
  const [notOnDevice, setNotOnDevice] = useState(false);
  /** Raised to open the file again, as when the connection returns. */
  const [attempt, setAttempt] = useState(0);
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
  // Someone else's unsaved changes to this entry: whoever saves second compares (stage 27d).
  const others = useOthersUnsaved(path, undefined, offlineAt !== null);
  /** The server's copy the text was opened from, to see whether a later read differs. */
  const openedFrom = useRef({ id: "", revision: 0, blob: "" });
  // The panels beside the text: Properties and Comments. Writing help opens in the text itself.
  const bar = useRightBar();
  // Discarding goes straight to the server, so it waits for a connection.
  const offline = useNeedsConnection();
  /** Whether a model is chosen for writing help; null until the server says. */
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  useEffect(() => {
    work.api.conversations().then(
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
  const [textTick, setTextTick] = useState(0);
  /** The comment whose bubble in the margin was pressed last; a new object at each press. */
  const [focusComment, setFocusComment] = useState<{ id: string } | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const placeMarks = useCallback((list: PassageComment[]) => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    v.dispatch({
      effects: setCommentMarks.of(
        // Open threads on a passage are marked; a resolved one, or one on the whole entry, is not.
        list.flatMap((c) => {
          const at = c.resolved || !c.quote ? null : locate(text, c);
          return at ? [{ id: c.id, ...at }] : [];
        }),
      ),
    });
  }, []);
  const loadComments = useCallback(async () => {
    const list = await work.api.comments(path).then(
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
          const { embed } = await work.api.upload(file);
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
    setNotOnDevice(false);
    (async () => {
      let text = "";
      try {
        const entry = await work.api.entry(path);
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
        // No connection: the same open-or-create rule, against this device's unsent changes and
        // the compact index (stage 15c).
        const unreachable =
          err instanceof ApiFailure && (err.status === 0 || err.code === NOT_ON_DEVICE);
        let rule: OfflineOpen | null = null;
        if (unreachable) {
          const record = await work.queue.get(key);
          const index = await work.api.graph().catch(() => null);
          rule = openOrCreate({
            path,
            hasRecord: !!record && record.kind !== "delete",
            indexPaths: index ? index.nodes.map((n) => n.path) : null,
            creating,
          });
          if (!live) return;
          if (rule === "not-on-device") {
            setNotOnDevice(true);
            return;
          }
        }
        if (rule === "record") {
          // The unsent change below gives the text, the draft and the base.
          draft.current = { id: newDraftId(), revision: 0, kind: "create", baseBlob: "" };
        } else if (
          rule === "create" ||
          (err instanceof ApiFailure && err.status === 404 && creating)
        ) {
          const name = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
          text = `# ${name}\n\n`;
          // The folder's type travels with the entry, so Obsidian sees it too. Offline it comes
          // from the folder file kept on this device when the page that asked did not give it.
          const type =
            newType ??
            (rule === "create"
              ? folderTypeOf(
                  path,
                  await api
                    .libraryFile("folders")
                    .then((f) => f.file as FolderFile)
                    .catch(() => null),
                )
              : null);
          if (type) text = setFrontmatterKey(text, "type", type);
          draft.current = { id: newDraftId(), revision: 0, kind: "create", baseBlob: "" };
        } else {
          if (live) setError(err instanceof ApiFailure ? err.message : "Could not open this file.");
          return;
        }
      }
      // Text this device has not sent yet is newer than the server's: it is what was typed last.
      const unsent = await work.queue.get(key);
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
  }, [path, creating, newType, key, attempt]);

  // Opened: kept on this device among the recent entries.
  useEffect(() => markOpened(`entry:${path}`), [path]);

  // Keep going (stage 25): an entry open in the editor is one edited lately, and the editor
  // opens with the cursor where it was left, in view.
  const title = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  const opened = initial !== null;
  useEffect(() => {
    if (opened) recents.viewed(path, title, "edited");
  }, [opened, path, title]);
  useEffect(() => {
    const v = view.current;
    const at = recents.cursorAt(path);
    if (!opened || !v || at === null) return;
    // The editor made its own start, after the frontmatter; the saved place replaces it.
    v.dispatch({ selection: { anchor: Math.min(at, v.state.doc.length) }, scrollIntoView: true });
  }, [opened, path]);

  // Opened from the device's copy: once the server answers, and nothing here is unsent, its copy
  // replaces the one opened if they differ. With a record, the record's base decides on the server.
  useReadAgain(offlineAt, entryAddress(path), () => {
    void (async () => {
      if (await work.queue.get(key)) return;
      const entry = await fromServer(() => work.api.entry(path)).catch(() => null);
      const v = view.current;
      if (!entry || !v || (await work.queue.get(key))) return;
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
      await work.queue.drop(key);
      setMessage("Updated from the server.");
    })();
  });

  // What the queue hears from the server about this file.
  useEffect(
    () =>
      work.queue.subscribe(key, (e) => {
        if (e.type === "saved") {
          draft.current = {
            ...draft.current,
            id: e.known.draftId,
            revision: e.known.revision,
          };
          setMessage(null);
          refresh();
          // Saved: it is the entry edited last.
          recents.touch(path, title, "edited");
        } else if (e.type === "stale") {
          // Text typed from now on goes to the same kept copy: revision 0 is never built on.
          draft.current = { ...draft.current, id: e.draftId, revision: 0 };
          setStale(e.draftId);
          refresh();
        }
      }),
    [key, refresh, path, title],
  );

  const onChange = useCallback(
    (text: string) => {
      latest.current = text;
      // Kept on this device at once; sent to the server after a second without typing.
      const { id, revision, kind, baseBlob } = draft.current;
      void work.queue.put(key, text, { kind, draftId: id, revision, baseBlob });
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
  // Read again when the stream says some entry's comments changed (someone commented or replied).
  const commentChanges = changesOf(useStatus()?.comments, path);
  useEffect(() => {
    if (initial !== null) void loadComments();
  }, [initial, loadComments, commentChanges]);

  function comment() {
    const v = view.current;
    if (!v) return;
    const at = passageOf(v.state);
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

  // Consult (stage 24): its tab, and a request to run it, which the panel takes when it opens.
  const [consultRequest, setConsultRequest] = useState(0);
  const wantConsult = useRef<{ scope?: "content" } | null>(null);
  const [backToFindings, setBackToFindings] = useState(false);
  function consult() {
    const v = view.current;
    // Two cards under one passage would compete: Consult takes over from Help.
    if (v) v.dispatch({ effects: closeHelp.of(null) });
    const selected = v ? v.state.selection.main.from !== v.state.selection.main.to : false;
    wantConsult.current = selected ? { scope: "content" } : {};
    bar.show("consult");
    setConsultRequest((n) => n + 1);
  }

  /** A comment for the AI: its suggestion opens in the writing help card on its passage. */
  function suggestFor(c: PassageComment, at: { from: number; to: number }) {
    const v = view.current;
    if (!v) return;
    v.dispatch({
      effects: openHelp.of({ ...at, comment: { id: c.id, text: c.text } }),
      scrollIntoView: true,
    });
    // On a phone the panel's sheet would cover the card.
    if (window.matchMedia(PHONE).matches) bar.hide();
  }

  /** Asking the lore about a passage is not editing it: the Ask page opens with it quoted. */
  function askAbout() {
    const v = view.current;
    if (!v) return;
    const at = passageOf(v.state);
    if (!at.text.trim()) {
      setMessage("Select some words, or put the cursor in a paragraph, to ask about it.");
      return;
    }
    void work.queue.sendNow(key);
    navigate("/ask", {
      state: { question: `About this passage of "${title}":\n"""\n${at.text}\n"""\n` },
    });
  }

  // Coming back to this tab: if the server changed the draft meanwhile, such as by accepting a
  // proposed field on another device, and nothing here is unsent, show the server's text.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || (await work.queue.get(key))) return;
      const entry = await work.api.entry(path).catch(() => null);
      const v = view.current;
      if (!entry?.draft || !v || entry.draft.id !== draft.current.id) return;
      if (entry.draft.revision <= draft.current.revision) return;
      if (latest.current !== v.state.doc.toString() || (await work.queue.get(key))) return;
      draft.current.revision = entry.draft.revision;
      latest.current = entry.text;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: entry.text } });
      // The line above reports a change like typing does; this text is the server's already.
      await work.queue.drop(key);
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
    await work.queue.sendNow(key);
    navigate(entryUrl(path));
  }

  // The editor's keys: Ctrl+S sends the text now instead of after the pause, Ctrl+Enter is Done.
  useScope("editor");
  useScope("table");
  useShortcut("editor.save", () => void work.queue.sendNow(key));
  useShortcut("editor.done", () => void done());
  useShortcut("editor.help", () => {
    if (view.current) startHelp(view.current);
  });
  useShortcut("editor.consult", () => consult());

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
          ...(openCount(comments) > 0 ? { badge: openCount(comments) } : {}),
          render: () =>
            view.current && (
              <CommentsPanel
                key={`${path}:${commenting.n}`}
                view={view.current}
                focus={focusComment}
                path={path}
                comments={comments}
                adding={commenting.adding}
                canAi={canWrite === true}
                onSuggest={suggestFor}
                onChanged={() => {
                  setCommenting((c) => ({ ...c, adding: null }));
                  void loadComments();
                }}
                onClose={() => bar.hide()}
              />
            ),
        },
  );

  // Whether there is anything to compare with the published text: an entry that exists, with a
  // draft or with text typed since it was opened.
  const hasChanges =
    draft.current.kind === "edit" && (openedFrom.current.id !== "" || latest.current !== initial);
  usePanel(
    initial === null
      ? null
      : {
          id: "consult",
          title: "Consult",
          icon: Scale,
          render: () =>
            view.current && (
              <Suspense fallback={null}>
                <ConsultPanel
                  key={path}
                  view={view.current}
                  path={path}
                  canWrite={canWrite}
                  hasChanges={hasChanges}
                  textTick={textTick}
                  runRequest={consultRequest}
                  takeRun={() => {
                    const asked = wantConsult.current;
                    wantConsult.current = null;
                    return asked;
                  }}
                  onJump={() => {
                    // On a phone the sheet would cover the passage.
                    if (window.matchMedia(PHONE).matches) {
                      bar.hide();
                      setBackToFindings(true);
                    }
                  }}
                  onCommented={() => void loadComments()}
                />
              </Suspense>
            ),
        },
  );

  // The outline of the text, and full width, as on the entry's page.
  const outline = useEditorOutline(view);
  usePanel(initial === null ? null : outline.panel);
  const [wide] = useWide();

  // While the side bar is closed, comments show as bubbles in the margin beside their passages.
  const margin = useMargin(
    page,
    bar.open === null && initial !== null,
    (box) => {
      const v = view.current;
      if (!v) return [];
      const text = v.state.doc.toString();
      return comments.flatMap((c) => {
        const at = c.resolved || !c.quote ? null : locate(text, c);
        if (!at) return [];
        // Lines out of sight are not drawn; their place is still known from the line heights.
        const top = v.coordsAtPos(at.from)?.top ?? v.documentTop + v.lineBlockAt(at.from).top;
        return [{ id: c.id, top: Math.round(top - box.top), text: c.text, for: c.for }];
      });
    },
    [comments, textTick, preview, wide, initial],
  );

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
    await work.queue.drop(key);
    if (draft.current.revision > 0)
      await work.api.discardDraft(draft.current.id).catch(() => undefined);
    refresh();
    // A new entry that is discarded was never there: nothing remembers it.
    if (draft.current.kind === "create") recents.forget(path);
    navigate(draft.current.kind === "create" ? "/" : entryUrl(path));
  }

  async function remove() {
    // A new entry the server has seen is a draft there, and discarding it is a direct call.
    if (draft.current.kind === "create" && draft.current.revision > 0) {
      if (connection.state !== "online") {
        setMessage("This entry was sent already: deleting it needs a connection.");
        return;
      }
    }
    const ok = await dialogs.confirm({
      title: "Delete this entry?",
      body: "It is removed from the library when you save a version. Until then you can still bring it back.",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      if (draft.current.kind === "create") {
        await work.queue.drop(key);
        if (draft.current.revision > 0) await work.api.discardDraft(draft.current.id);
      } else {
        // The delete goes through the queue like any change, so it is kept until it is sent.
        const { id, revision, baseBlob } = draft.current;
        await work.queue.put(key, "", { kind: "delete", draftId: id, revision, baseBlob });
        await work.queue.sendNow(key);
        const refused = await work.queue.get(key);
        if (refused?.state === "attention") {
          setMessage(refused.error ?? "Could not delete.");
          return;
        }
      }
      refresh();
      // Marked for deletion: it is no longer one of the entries read or edited lately.
      recents.forget(path);
      // With no connection the list of unpublished changes cannot be read: the start page instead.
      navigate(connection.state === "online" ? "/unpublished" : "/");
    } catch (err) {
      setMessage(err instanceof ApiFailure ? err.message : "Could not delete.");
    }
  }

  /** What the toolbar and the right-click menu open. */
  const tools = {
    onLink: () => setLinking(true),
    onImage: () => setPicking(true),
    onComment: comment,
    onHelp: () => {
      if (view.current) startHelp(view.current);
    },
    onConsult: consult,
    onAsk: askAbout,
  };

  if (notOnDevice) {
    return <NotOnDevice path={path} onConnected={() => setAttempt((n) => n + 1)} />;
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
    <div className={`editor-page${wide ? " is-wide" : ""}`} ref={page}>
      <CommentBubbles
        {...margin}
        onOpen={(id) => {
          setFocusComment({ id });
          bar.show("comments");
        }}
      />
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
            Comments{openCount(comments) > 0 ? ` (${openCount(comments)})` : ""}
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
      <OthersNotice people={others} editing />
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
          onCursor={(line) => {
            outline.onCursor(line);
            const v = view.current;
            if (v) recents.setCursor(path, v.state.selection.main.head);
          }}
        />
      </EditorContextMenu>
      {backToFindings && bar.open !== "consult" && (
        <button
          type="button"
          className="consult-back"
          onClick={() => {
            setBackToFindings(false);
            bar.show("consult");
          }}
        >
          Back to findings
        </button>
      )}
      <EditToolbar view={view} inTable={inTable} style={style} {...tools} />
      <WritingHelp
        view={view}
        path={path}
        canWrite={canWrite}
        onCommentDone={() => void loadComments()}
      />
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
