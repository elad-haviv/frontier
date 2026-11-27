import { aliasesOf, dirname, splitFrontmatter, stem } from "@frontier/vault";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  api,
  ApiFailure,
  chronicleUrl,
  editUrl,
  entryUrl,
  mapUrl,
  type PassageComment,
  talkUrl,
} from "../api.ts";
import { CommentsPanel } from "../components/CommentsPanel.tsx";
import { CommentBubbles, useMargin } from "../components/comments/CommentBubbles.tsx";
import { passageRange } from "../components/comments/passage.ts";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { LightboxProvider } from "../components/Lightbox.tsx";
import {
  currentEntryPath,
  scrollPageToTop,
  usePhone,
  useRefresh,
  useStatus,
  useWords,
} from "../components/Shell.tsx";
import {
  PageAction,
  useOpenPanel,
  usePageTitle,
  usePanel,
  useRevealInTree,
  useRightBar,
} from "../components/shell/panels.tsx";
import { CustomFields, Fields } from "../components/Fields.tsx";
import { ProposeFields } from "../components/ProposeFields.tsx";
import { Markdown } from "../render/Markdown.tsx";
import { overlayOpen } from "../components/overlay.ts";
import { IconButton } from "../components/ui/IconButton.tsx";
import {
  ArrowLeft,
  FileDown,
  History,
  MessageSquare,
  TableOfContents,
  Network,
  Waypoints,
} from "lucide-react";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { StickyLine } from "../components/entry/StickyLine.tsx";
import { BacklinksLine, FolderNeighbours, FromHere } from "../components/entry/FromHere.tsx";
import { headingAt, ResumeLine } from "../components/entry/ResumeLine.tsx";
import { IconLink } from "../components/ui/IconButton.tsx";
import { usePins, togglePin } from "../keepGoing/pins.ts";
import { recents, useLastEntry } from "../keepGoing/recents.ts";
import { arrivedByHistory } from "../keepGoing/strip.ts";
import { useShortcut } from "../keys.ts";
import { useCurrentHeading } from "../components/entry/useCurrentHeading.ts";
import { OutlinePanel } from "../components/entry/OutlinePanel.tsx";
import { HistoryPanel } from "../components/entry/HistoryPanel.tsx";
import { ExportPanel } from "../components/entry/ExportPanel.tsx";
import {
  type EntryActionsProps,
  EntryPhoneActions,
  EntryToolbar,
} from "../components/entry/EntryActions.tsx";
import {
  MoveField,
  pendingPath,
  RenameField,
  useRelocate,
} from "../components/entry/RenameField.tsx";
import { useNeedsConnection } from "../sync/connection.ts";
import { NotOnDevice } from "../components/NotOnDevice.tsx";
import { OfflineCopy, useReadAgain } from "../components/OfflineCopy.tsx";
import {
  entryAddress,
  markOpened,
  NOT_ON_DEVICE,
  notSentYet,
  servedFromDevice,
} from "../offline/copy.ts";
import { useAsync } from "../useAsync.ts";
import { useWide } from "../width.ts";

// The graph's code loads only when an entry's Graph tab is opened.
const LocalGraphPanel = lazy(() => import("../graph/LocalGraphPanel.tsx"));
const RelationsPanel = lazy(() =>
  import("../components/trees/RelationsPanel.tsx").then((m) => ({ default: m.RelationsPanel })),
);

/** Below this width the shell is a phone's, and a panel chosen covers half the page. */
const PHONE = "(max-width: 47.99rem)";

function Crumbs({ path, pending }: { path: string; pending: boolean }) {
  const folders = path.split("/").slice(0, -1);
  if (folders.length === 0 && !pending) return null;
  return (
    <p className={`crumbs${pending ? " is-pending" : ""}`}>
      {folders.length === 0 && "Top of the library"}
      {folders.map((f, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> › </span>}
          {f}
        </span>
      ))}
      {pending && <span className="crumbs-mark">unpublished</span>}
    </p>
  );
}

const NO_COMMENTS: PassageComment[] = [];

const join = (folder: string, name: string) => `${folder ? folder + "/" : ""}${name}.md`;

/** How the browser loaded this page: "navigate", "reload" or "back_forward". */
const loadType = (): string | undefined =>
  (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type;

export function EntryPage() {
  const words = useWords();
  const refresh = useRefresh();
  const toast = useToast();
  const navigate = useNavigate();
  const navigation = useNavigationType();
  const { pathname, hash, key } = useLocation();
  const path = currentEntryPath(pathname);
  /** This showing of the entry: a new one at each visit, as a reload of the same entry is not. */
  const visit = `${path}@${key}`;
  // Keyed by the visit as well as the path, so coming back from the editor shows the new draft.
  const entry = useAsync(() => api.entry(path), `${path}@${key}`);
  // Opened: kept on this device among the recent entries, to read with no connection.
  useEffect(() => markOpened(`entry:${path}`), [path]);
  const offlineAt = entry.state === "ready" ? servedFromDevice(entry.value) : null;
  useReadAgain(offlineAt, entryAddress(path), entry.retry);
  // Talking with a character is offered once a model for conversations is chosen.
  const ai = useAsync(() => api.conversations(), "conversations-ready");
  const canTalk = ai.state === "ready" && ai.value.ready;
  // From here: what the library says about this entry. It is not there with no connection or for
  // an entry that is only a draft, and then the foot of the page is quiet about it.
  const fromHere = useAsync(() => api.fromHere(path), `from-here:${path}@${key}`);
  const here = fromHere.state === "ready" && fromHere.value.path === path ? fromHere.value : null;
  const aiOn = useStatus()?.ai.conversation === true;
  const comments = useAsync(() => api.commentCount(path), `comments:${path}@${key}`);
  const openComments = comments.state === "ready" ? comments.value.open : 0;
  // The comments themselves, for the margin and the Comments tab.
  const commentList = useAsync(() => api.comments(path), `comment-list:${path}@${key}`);
  const passageComments = commentList.state === "ready" ? commentList.value.comments : NO_COMMENTS;
  /** The comment whose bubble was pressed last; a new object at each press. */
  const [focusComment, setFocusComment] = useState<{ id: string } | null>(null);
  const article = useRef<HTMLElement>(null);
  const offline = useNeedsConnection();
  const [wide] = useWide();
  const phone = usePhone();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const openPanel = useOpenPanel();
  const bar = useRightBar();
  const revealInTree = useRevealInTree();
  const prose = useRef<HTMLDivElement>(null);
  const titleRow = useRef<HTMLDivElement>(null);

  // The entry as loaded, which keeps its identity until another arrives; `entry` itself is new
  // at every render.
  const loaded = entry.state === "ready" ? entry.value : null;
  const view = useMemo(() => {
    if (!loaded) return null;
    const { body } = splitFrontmatter(loaded.text);
    // From the entry shown, which while another loads is still the one before.
    const shown = loaded.path;
    const name = (shown.split("/").pop() ?? shown).replace(/\.md$/i, "");
    // The page title is the note's name, as in Obsidian. A first heading that only repeats the
    // name is left out of the text; any other heading is a section and stays.
    const opening = /^\s*#[ \t]+([^\n]*)\n?/.exec(body);
    const repeats = opening !== null && opening[1]!.trim().toLowerCase() === name.toLowerCase();
    const text = repeats ? body.slice(opening[0].length) : body;
    return { text, aliases: aliasesOf(loaded.text) };
  }, [loaded]);

  // Where reading stopped: scrolled back to when the entry is opened again (not for an address
  // that names a heading, nor on the browser's back and forward), and recorded while reading.
  const now = useRef({ path, visit, navigation, key });
  now.current = { path, visit, navigation, key };
  /** The showing whose opening place is decided; reading is recorded only after that. */
  const settled = useRef<string | null>(null);
  /** The visit and address last acted on, so the server's answer for the same visit does not scroll again. */
  const acted = useRef<string | null>(null);
  /** True from the page's own scroll (a jump or a resume) until it has been drawn: not the reader's. */
  const own = useRef(false);
  const [resumed, setResumed] = useState<{ visit: string; heading: string | null } | null>(null);

  // Jump to the heading named in the address, once the text is on the page.
  useEffect(() => {
    if (!view) return;
    const here = now.current;
    const fresh = loaded?.path === here.path && settled.current !== here.visit;
    if (fresh) settled.current = here.visit;
    // The same visit read again (the server answered after the device copy): the reader is
    // already where they are, so nothing scrolls and nothing is recorded.
    const address = `${here.visit}|${hash}`;
    if (!fresh && acted.current === address) return;
    acted.current = address;
    // The scroll events of what follows are the page's own; they come before the second frame.
    own.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => (own.current = false)));
    if (!hash) {
      scrollPageToTop();
      const area = document.querySelector<HTMLElement>(".content");
      const stop =
        fresh && area && !arrivedByHistory(here.navigation, here.key, loadType())
          ? recents.resumeAt(here.path, area.clientHeight)
          : null;
      if (fresh) {
        if (area && stop !== null) {
          area.scrollTo({ top: stop, behavior: "instant" });
          setResumed({ visit: here.visit, heading: headingAt(area) });
        } else setResumed(null);
      }
      return;
    }
    const wanted = decodeURIComponent(hash.slice(1)).trim().toLowerCase();
    const heading = [
      ...document.querySelectorAll(
        ".prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6",
      ),
    ].find((h) => h.textContent?.trim().toLowerCase() === wanted);
    heading?.scrollIntoView({ block: "start" });
  }, [view, hash]);

  // Reading is recorded as it goes, so the entry opens there again.
  const shown = loaded?.path ?? null;
  useEffect(() => {
    const area = document.querySelector<HTMLElement>(".content");
    if (!area || shown !== path) return;
    const record = () => {
      if (settled.current === visit && !own.current) {
        recents.setScroll(path, area.scrollTop);
      }
    };
    area.addEventListener("scroll", record, { passive: true });
    return () => area.removeEventListener("scroll", record);
  }, [shown, path, visit]);

  // A rename or move in progress ends with the entry it was started on.
  useEffect(() => {
    setRenaming(false);
    setMoving(false);
  }, [path]);

  const { headings, current, titleGone } = useCurrentHeading(prose, titleRow, view);
  const e = loaded;
  // Where it will be once its rename is saved; the page shows that name and folder.
  const shownPath = e ? pendingPath(e) : path;
  const name = stem(shownPath);
  const folder = dirname(shownPath);
  const editable = !!e && !e.readOnly && e.draft?.kind !== "delete";
  const reached = current >= 0 ? (headings[current]?.text ?? null) : null;
  const relocate = useRelocate(e, entry.retry);

  // Viewed: kept among the entries read lately, and the one read before becomes the last. An
  // entry that is not there is forgotten, so no list offers it.
  useEffect(() => {
    if (shown === path) recents.viewed(path, name, "read");
  }, [shown, path, name]);
  const missing = entry.state === "failed" && entry.error.status === 404;
  useEffect(() => {
    if (missing) recents.forget(path);
  }, [missing, path]);
  const last = useLastEntry(path);

  // Pinned entries are "Working on", kept in the library with the folders.
  const pins = usePins();
  const pinned = pins.some((p) => p.path === path);
  const offlineReason = offline;
  const pinnable = !!e && e.path === path && e.draft?.kind !== "create" && !offlineAt;
  async function pinOrUnpin() {
    try {
      const on = await togglePin(path);
      if (on === null) return;
      toast({ message: on ? `Pinned “${name}” to Working on.` : `Unpinned “${name}”.` });
    } catch (err) {
      toast({
        message: err instanceof ApiFailure ? err.message : "The pin could not be changed.",
      });
    }
  }

  // Keys: Alt+Left goes back to the last entry, Alt+Up and Alt+Down to the entries either side in
  // the folder, "p" pins. A key with nothing to do is left to the browser.
  useShortcut(
    "entry.back",
    () => {
      if (!last || overlayOpen()) return false;
      navigate(entryUrl(last.path));
    },
    !!e,
  );
  useShortcut(
    "entry.previous",
    () => {
      if (!here?.previous || overlayOpen()) return false;
      navigate(entryUrl(here.previous.path));
    },
    !!e,
  );
  useShortcut(
    "entry.next",
    () => {
      if (!here?.next || overlayOpen()) return false;
      navigate(entryUrl(here.next.path));
    },
    !!e,
  );
  useShortcut(
    "entry.pin",
    () => {
      if (!pinnable || offlineReason || overlayOpen()) return false;
      void pinOrUnpin();
    },
    !!e,
  );

  /** Scrolls the page to a comment's passage. */
  function showPassage(c: PassageComment) {
    const root = prose.current;
    if (!root || !loaded) return;
    const range = passageRange(root, loaded.text, c);
    range?.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }

  usePanel(
    !e || passageComments.length === 0
      ? null
      : {
          id: "comments",
          title: "Comments",
          icon: MessageSquare,
          badge: passageComments.length,
          render: () => (
            <CommentsPanel
              key={e.path}
              view={null}
              text={e.text}
              path={e.path}
              comments={passageComments}
              adding={null}
              canAi={canTalk}
              focus={focusComment}
              onShow={showPassage}
              onChanged={() => {
                commentList.retry();
                comments.retry();
              }}
              onClose={() => bar.hide()}
            />
          ),
        },
  );

  // While the side bar is closed, comments show as bubbles in the margin beside their passages.
  const margin = useMargin(
    article,
    bar.open === null && !!loaded,
    (box) => {
      const root = prose.current;
      if (!root || !loaded) return [];
      return passageComments.flatMap((c) => {
        const range = passageRange(root, loaded.text, c);
        if (!range) return [];
        const top = range.getBoundingClientRect().top - box.top;
        return [{ id: c.id, top: Math.round(top), text: c.text, for: c.for }];
      });
    },
    [passageComments, view, wide],
  );

  /** Goes to a heading chosen in the outline. On a phone the sheet steps aside for the text. */
  function goTo(i: number) {
    headings[i]?.el.scrollIntoView({ block: "start" });
    if (window.matchMedia(PHONE).matches) bar.hide();
  }

  usePanel(
    headings.length === 0
      ? null
      : {
          id: "outline",
          title: "Outline",
          icon: TableOfContents,
          render: () => <OutlinePanel items={headings} current={current} onChoose={goTo} />,
        },
  );
  usePanel(
    !e || !editable
      ? null
      : {
          id: "history",
          title: "History",
          icon: History,
          render: () => <HistoryPanel key={e.path} path={e.path} />,
        },
  );
  usePanel(
    !e || !editable
      ? null
      : {
          id: "export",
          title: "Export",
          icon: FileDown,
          render: () => (
            <ExportPanel
              key={e.path}
              path={e.path}
              name={name}
              unsaved={e.state === "unpublished" || e.rename !== null}
            />
          ),
        },
  );

  usePanel(
    !e
      ? null
      : {
          id: "relations",
          title: "Relations",
          icon: Network,
          render: () => (
            <Suspense fallback={<Progress label="Loading the relations" />}>
              <RelationsPanel
                key={e.path}
                path={e.path}
                text={e.text}
                editable={editable}
                onChanged={() => entry.retry()}
              />
            </Suspense>
          ),
        },
  );

  usePanel(
    !e
      ? null
      : {
          id: "graph",
          title: "Graph",
          icon: Waypoints,
          render: () => (
            <Suspense fallback={<Progress label="Loading the graph" />}>
              <LocalGraphPanel key={e.path} path={e.path} />
            </Suspense>
          ),
        },
  );

  const outlineButton = (className?: string) =>
    headings.length > 0 ? (
      <IconButton
        label="Outline"
        icon={TableOfContents}
        size="sm"
        {...(className ? { className } : {})}
        aria-pressed={bar.open === "outline"}
        onClick={() => (bar.open === "outline" ? bar.hide() : openPanel("outline"))}
      />
    ) : undefined;

  // On a phone, once the title has gone, the slim top line says where the reader is. Beside it,
  // a way back to the entry viewed before this one.
  const phoneExtra =
    phone && (last || titleGone) ? (
      <>
        {last && (
          <IconLink
            label={`Back to ${last.title}`}
            icon={ArrowLeft}
            size="sm"
            shortcut="entry.back"
            tipSide="bottom"
            to={entryUrl(last.path)}
            className="phone-last"
          />
        )}
        {titleGone && outlineButton("phone-outline")}
      </>
    ) : undefined;
  usePageTitle(titleGone && reached ? `${name} › ${reached}` : name, phoneExtra);

  if (entry.state === "loading") return <p className="center muted">Opening…</p>;
  // A failure to open another entry is not shown over the one before it.
  if (entry.state === "failed" || (entry.error && entry.value.path !== path)) {
    const error = entry.error!;
    if (error.code === NOT_ON_DEVICE) return <NotOnDevice path={path} onConnected={entry.retry} />;
    // A missing entry will not appear by trying again; anything else might.
    return (
      <div className="center">
        <Problem
          reason={error.message}
          {...(error.status === 404 ? {} : { onRetry: entry.retry })}
        />
        <p>
          <Link to="/">Back to the start</Link>
        </p>
      </div>
    );
  }

  const ent = entry.value;
  /** The title and the menu come into view first, so what they open is seen. */
  const fromTop = (open: () => void) => () => {
    if (titleGone) scrollPageToTop();
    // After the menu has closed, so the focus can go to what opens.
    setTimeout(open);
  };
  const startRename = fromTop(() => setRenaming(true));
  const startMove = fromTop(() => setMoving(true));

  async function undoRename(id: string) {
    try {
      await api.cancelRename(id);
      refresh();
      entry.retry();
    } catch (err) {
      toast({
        message: err instanceof ApiFailure ? err.message : "The rename could not be undone.",
      });
    }
  }

  const toggle = (id: string) => () => (bar.open === id ? bar.hide() : openPanel(id));
  const actions: EntryActionsProps = {
    editHref: editable ? editUrl(ent.path) : undefined,
    onOutline: headings.length > 0 ? toggle("outline") : undefined,
    outlineOpen: bar.open === "outline",
    onGraph: toggle("graph"),
    graphOpen: bar.open === "graph",
    onRelations: toggle("relations"),
    relationsOpen: bar.open === "relations",
    pin: pinnable
      ? { pinned, onToggle: () => void pinOrUnpin(), blocked: offlineReason }
      : undefined,
    changes: editable
      ? {
          onRename: startRename,
          onMove: startMove,
          onHistory: () => openPanel("history"),
          onExport: () => openPanel("export"),
          offline,
        }
      : undefined,
  };

  const moved = ent.rename !== null && dirname(ent.rename.to) !== dirname(ent.path);
  const renamed = ent.rename !== null && stem(ent.rename.to) !== stem(ent.path);

  return (
    <>
      {/* On a desktop the entry's actions are at the right of the bar at the top; on a phone,
          Edit and "⋯" are in the top line, beside the title. */}
      <StickyLine
        shown={titleGone}
        folder={folder}
        name={name}
        heading={reached}
        onFolder={revealInTree}
        onTop={scrollPageToTop}
        last={last}
        actions={<EntryToolbar {...actions} />}
      />
      {resumed?.visit === visit && (
        <ResumeLine
          heading={resumed.heading}
          onTop={() => {
            scrollPageToTop();
            recents.clearScroll(path);
            setResumed(null);
          }}
        />
      )}
      {phone && (
        <PageAction>
          <EntryPhoneActions {...actions} />
        </PageAction>
      )}
      <article className={`entry${wide ? " is-wide" : ""}`} ref={article}>
        <CommentBubbles
          {...margin}
          onOpen={(id) => {
            setFocusComment({ id });
            openPanel("comments");
          }}
        />
        {entry.reloading && <Progress label="Opening" />}
        {entry.error && <Problem reason={entry.error.message} onRetry={entry.retry} />}
        <header className="entry-head">
          <Crumbs path={shownPath} pending={moved} />
          <OfflineCopy at={offlineAt} />
          <div className="title-row" ref={titleRow}>
            {renaming ? (
              <RenameField
                name={name}
                onRename={(to) => relocate(join(folder, to))}
                onClose={() => setRenaming(false)}
              />
            ) : (
              <div className="entry-title">
                <h1>{name}</h1>
              </div>
            )}
          </div>
          {moving && (
            <MoveField
              folder={folder}
              onMove={(to) => relocate(join(to, name))}
              onClose={() => setMoving(false)}
            />
          )}
          {ent.rename && (
            <p className="draft-note">
              Not {words.own ? "saved" : "published"} yet:{" "}
              {[
                renamed && `renamed from ${stem(ent.path)}`,
                moved && `moved from ${dirname(ent.path) || "the top of the library"}`,
              ]
                .filter(Boolean)
                .join(" and ")}
              .{" "}
              <button
                type="button"
                className="draft-undo"
                onClick={() => void undoRename(ent.rename!.id)}
              >
                Undo
              </button>
            </p>
          )}
          {ent.quarantine && (
            <p className="draft-note quarantine-note" role="status">
              This note arrived unreviewed, pushed by {ent.quarantine.pushedBy}. It is kept out of
              the memory bank until you decide.{" "}
              <Link to="/inbox">Accept or revert it in the inbox</Link>
            </p>
          )}
          {notSentYet(ent) && (
            <p className="draft-note" role="status">
              Not sent yet: this text is on this device and goes to the server when it can.
            </p>
          )}
          {ent.state === "unpublished" && !notSentYet(ent) && (
            <p className="draft-note">
              {ent.draft?.kind === "delete"
                ? "Marked for deletion. "
                : ent.draft?.kind === "create"
                  ? "A new entry, not published yet. "
                  : "You are reading your unpublished draft. "}
              <Link to="/unpublished">{words.review}</Link>
            </p>
          )}
          {(view!.aliases.length > 0 || ent.readOnly) && (
            <p className="chips">
              {view!.aliases.map((a) => (
                <span className="chip" key={a} title="Also known as">
                  {a}
                </span>
              ))}
              {ent.readOnly && (
                <span
                  className="chip chip-quiet"
                  title={
                    ent.lineEnding === "mixed"
                      ? "This file mixes two kinds of line endings"
                      : "Appendix files are append-only"
                  }
                >
                  read-only
                </span>
              )}
            </p>
          )}
          <Fields fields={ent.fields} />
          <CustomFields text={ent.text} links={ent.links} />
          {canTalk && (ent.fields.type === "person" || ent.fields.type === "deity") && (
            <p className="talk-with">
              <Link to={talkUrl(ent.path)}>
                Talk with {ent.path.split("/").pop()!.replace(/\.md$/i, "")}
              </Link>
            </p>
          )}
          {openComments > 0 && !ent.readOnly && (
            <p className="on-maps">
              <Link to={`${editUrl(ent.path)}?comments=1`}>
                {openComments} open {openComments === 1 ? "comment" : "comments"}
              </Link>
            </p>
          )}
          {ent.maps.length > 0 && (
            <p className="on-maps">
              On maps:{" "}
              {ent.maps.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ", "}
                  <Link to={mapUrl(m.id, m.feature)}>{m.title}</Link>
                </span>
              ))}
            </p>
          )}
          {ent.chronicles.length > 0 && (
            <p className="on-maps">
              On chronicles:{" "}
              {ent.chronicles.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link to={`${chronicleUrl(c.id)}?span=${encodeURIComponent(c.span)}`}>
                    {c.title}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {ent.state === "published" && !ent.readOnly && <ProposeFields path={ent.path} />}
        </header>

        <div className="prose" ref={prose}>
          {view!.text.trim() === "" ? (
            <p className="muted">This entry is empty.</p>
          ) : (
            <LightboxProvider scope=".prose">
              <Markdown text={view!.text} links={ent.links} />
            </LightboxProvider>
          )}
        </div>

        <HoverPreview scope=".prose" />

        {/* Keyed by the entry, so what was done in one (a Link it, an AI answer) is not carried to the next. */}
        <FromHere key={path} path={path} title={name} data={here} ai={aiOn} />
        <FolderNeighbours path={path} data={here} />
        <BacklinksLine backlinks={ent.backlinks} />
      </article>
    </>
  );
}
