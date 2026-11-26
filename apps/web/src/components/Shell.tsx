import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { X } from "lucide-react";
import type { StatusSnapshot } from "@frontier/schema";
import { api, ApiFailure, editUrl } from "../api.ts";
import { updates } from "../offline/updates.ts";
import { wipeDevice } from "../offline/wipe.ts";
import { connection, useConnection } from "../sync/connection.ts";
import { queue } from "../sync/queue.ts";
import { useAsync } from "../useAsync.ts";
import { useDialogs } from "./Dialogs.tsx";
import { useToast } from "./ui/Toast.tsx";
import { overlayOpen } from "./overlay.ts";
import { Switcher } from "./Switcher.tsx";
import { KeySheet } from "./KeySheet.tsx";
import { NewEntry } from "./NewEntry.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import { useKeyListener, useShortcut } from "../keys.ts";
import { useRandom } from "../keepGoing/useRandom.ts";
import { currentEntryPath } from "./shell/entryPath.ts";
import { LeftBar } from "./shell/LeftBar.tsx";
import { Rail } from "./shell/Rail.tsx";
import { PhoneBar } from "./shell/PhoneBar.tsx";
import { BottomSheet, RightBar } from "./shell/RightBar.tsx";
import {
  kindOf,
  LEFT_WIDTH,
  readLeftWidth,
  readPrefs,
  type ScreenKind,
  ShellStore,
  ShellStoreProvider,
  writeLeftWidth,
  writePrefs,
} from "./shell/panels.tsx";
import { useFocusTrap } from "./shell/useFocusTrap.ts";
import { UpdateBar } from "./UpdateBar.tsx";
import { DeviceNotices } from "./InstallCard.tsx";
import "./Shell.css";

const Refresh = createContext<() => void>(() => undefined);
const Status = createContext<StatusSnapshot | null>(null);
const Logout = createContext<() => void>(() => undefined);

/** Logs out as the app menu does, warning first about changes not sent yet. */
export const useLogout = () => useContext(Logout);

/**
 * The words for keeping changes. In a library of Frontier's own a change is saved as a version;
 * where the library is shared through GitHub it is published there.
 */
export function useWords() {
  const own = useContext(Status)?.library === "own";
  return {
    own,
    waiting: own ? "Unsaved" : "Unpublished",
    title: own ? "Unsaved changes" : "Unpublished changes",
    act: own ? "Save a version" : "Publish",
    acting: own ? "Saving…" : "Publishing…",
    review: own ? "Review and save" : "Review and publish",
  };
}

/** The latest status the server sent, or null before the first. */
export const useStatus = () => useContext(Status);

/** Call after a draft or publish changed something, so the tree and the counts are read again. */
export const useRefresh = () => useContext(Refresh);

export { currentEntryPath };

/** Scrolls the page area back to its top, as a new page would open. */
export function scrollPageToTop(): void {
  document.querySelector(".content")?.scrollTo({ top: 0 });
}

/** Below this width the side bars become a drawer and a bottom sheet. */
const PHONE = "(max-width: 47.99rem)";

/** Whether the shell is a phone's: a drawer and a bottom sheet in place of the side bars. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(PHONE).matches,
  );
}

const PAGE_NAMES: [RegExp, string][] = [
  [/^\/$/, "Home"],
  [/^\/maps/, "Maps"],
  [/^\/map\//, "Map"],
  [/^\/chronicles/, "Chronicles"],
  [/^\/chronicle\//, "Chronicle"],
  [/^\/gallery/, "Gallery"],
  [/^\/ask\/./, "Conversation"],
  [/^\/ask/, "Ask the lore"],
  [/^\/talk\//, "Talk"],
  [/^\/inbox/, "Inbox"],
  [/^\/import/, "Import"],
  [/^\/export/, "Export"],
  [/^\/versions\/./, "Two texts to compare"],
  [/^\/versions/, "History of the library"],
  [/^\/history\//, "History"],
  [/^\/settings/, "Settings"],
  [/^\/status/, "Status"],
  [/^\/conflict\//, "Conflict"],
];

/** The page's usual name, for the phone's top line. */
function pageName(pathname: string, entry: string, waitingTitle: string): string {
  if (entry) return (entry.split("/").pop() ?? entry).replace(/\.md$/i, "");
  if (pathname.startsWith("/unpublished")) return waitingTitle;
  return PAGE_NAMES.find(([re]) => re.test(pathname))?.[1] ?? "Frontier";
}

/** The key in a history entry's state that marks the entry standing for the library panel. */
const LIBRARY_MARK = "frontierLibrary";

/** The phone's drawer: the left side bar over a dimmed page, holding the focus while open. */
function Drawer({
  onClose,
  onEscape,
  children,
}: {
  onClose: () => void;
  /** What Escape does: close the library panel back to the menu, or the drawer itself. */
  onEscape: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, true, onEscape);
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={box} className="drawer" role="dialog" aria-modal="true" aria-label="Side bar">
        {children}
      </div>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const phone = usePhone();
  const kind: ScreenKind = kindOf(pathname);
  const store = useMemo(() => new ShellStore(), []);
  useSyncExternalStore(store.subscribe, store.snapshot);
  const [drawer, setDrawer] = useState(false);
  /** The phone's library panel, over the drawer's menu. */
  const [library, setLibrary] = useState(false);
  /**
   * Whether the history entry we stand on is the library panel's, so the browser's Back closes the
   * panel and not the page. The entry is pushed when the panel opens (the same address, marked in
   * its state) and popped when it closes.
   */
  const libraryEntry = useRef(false);
  /** Our own history.back() has been asked for and its popstate has not arrived yet. */
  const backing = useRef(false);
  /** The panel was opened while that was so: it takes a new entry when the popstate lands. */
  const reopen = useRef(false);
  /** When the browser's own Back or swipe last closed the panel, so we do not close it twice. */
  const lastPop = useRef(0);
  const [rail, setRail] = useState(() => readPrefs(kind).rail);
  const [version, setVersion] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** The folder the new-entry dialog starts in, while it is open. */
  const [making, setMaking] = useState<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const rightSize = useRef<number | null>(null);
  const leftSize = useRef<number | null>(null);
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    // The status stream tells of most changes; this reads the counts at once all the same.
    void connection.refreshStatus();
  }, []);
  const tree = useAsync(() => api.tree(), `tree-${version}`);
  // The status comes from the server's stream, through the connection service.
  const { snapshot: status } = useConnection();
  const current = currentEntryPath(pathname);

  const phoneNow = useRef(phone);
  phoneNow.current = phone;
  const pushLibraryEntry = useCallback(() => {
    // The same page and the router's own state, plus a mark. The router reads only its own keys,
    // so it sees nothing move; the mark lets Back, Forward and a reload find the panel again.
    window.history.pushState({ ...window.history.state, [LIBRARY_MARK]: true }, "");
    libraryEntry.current = true;
  }, []);
  const openLibrary = useCallback(() => {
    lastPop.current = 0;
    if (backing.current) reopen.current = true;
    else if (!libraryEntry.current) pushLibraryEntry();
    setLibrary(true);
  }, [pushLibraryEntry]);
  /** Back to the menu: ‹ Menu, Escape and a swipe all end here, and take the entry away. */
  const closeLibrary = useCallback(() => {
    setLibrary(false);
    reopen.current = false;
    if (!libraryEntry.current) return;
    libraryEntry.current = false;
    // The browser's own swipe back has just taken the entry away: do not go back a second time.
    if (Date.now() - lastPop.current < 300) return;
    backing.current = true;
    window.history.back();
  }, []);
  /** Closes the drawer and the library with it, so it opens on the menu next time. */
  const closeDrawer = useCallback(() => {
    setDrawer(false);
    closeLibrary();
  }, [closeLibrary]);
  // The browser's Back and Forward: Back from the panel's entry closes the panel; arriving on one
  // (Forward, or Back from a page opened over it) opens it again.
  useEffect(() => {
    const popped = () => {
      if (backing.current) {
        backing.current = false;
        if (reopen.current) {
          reopen.current = false;
          pushLibraryEntry();
        }
        return;
      }
      const marked = window.history.state?.[LIBRARY_MARK] === true;
      if (libraryEntry.current && !marked) {
        libraryEntry.current = false;
        lastPop.current = Date.now();
        setLibrary(false);
      } else if (!libraryEntry.current && marked && phoneNow.current) {
        libraryEntry.current = true;
        setDrawer(true);
        setLibrary(true);
      }
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [pushLibraryEntry]);

  // Each kind of screen keeps its own side bars: the rail on a map, the panel last open, its width.
  useLayoutEffect(() => store.enter(kind, phone), [store, kind, phone]);
  useEffect(() => setRail(readPrefs(kind).rail), [kind]);

  // What the save queue has to say about a file whose page is not open here, such as two texts
  // to compare, is said in a toast.
  useEffect(
    () =>
      queue.onNotice((notice) => {
        if (notice.watched && !notice.always) return;
        toast({
          message: notice.message,
          ...(notice.href
            ? { action: { label: notice.label ?? "Open", run: () => navigate(notice.href!) } }
            : {}),
        });
      }),
    [toast, navigate],
  );

  const fold = useCallback(
    (next: boolean) => {
      setRail(next);
      writePrefs(kind, { rail: next });
    },
    [kind],
  );

  // One listener for every shortcut of the app. Ctrl+K (Cmd+K) opens the switcher from anywhere,
  // even from a field; "?" opens the list of shortcuts; Ctrl+\ folds the side bar.
  useKeyListener();
  useShortcut("app.switcher", () => setSwitching(true));
  useShortcut("app.keys", () => setSheet(true));
  useShortcut("app.sidebar", () => {
    if (!phone) return fold(!rail);
    if (drawer) closeDrawer();
    else setDrawer(true);
  });
  // Keep going (stage 25): "g h" and "g r".
  const roll = useRandom();
  useShortcut("app.home", () => {
    if (overlayOpen()) return false;
    void navigate("/");
  });
  useShortcut("app.random", () => {
    if (overlayOpen()) return false;
    void roll();
  });

  // A new page opens at its top, and on a phone the drawer closes. An entry marked as the
  // library's (a reload, or Back from a page opened over it) opens the panel instead; any other
  // entry is not the panel's, whatever it replaced or was pushed over.
  useEffect(() => {
    if (window.history.state?.[LIBRARY_MARK] === true && phoneNow.current) {
      libraryEntry.current = true;
      setDrawer(true);
      setLibrary(true);
    } else {
      libraryEntry.current = false;
      setDrawer(false);
      setLibrary(false);
    }
    scrollPageToTop();
  }, [pathname]);
  useEffect(() => {
    if (!phone && drawer) closeDrawer();
  }, [phone, drawer, closeDrawer]);
  // A page asked to see a folder in the tree: the side bar unfolds, or on a phone the drawer
  // opens; the tree then opens the folder (Tree).
  const reveal = store.reveal?.n;
  useEffect(() => {
    if (reveal === undefined) return;
    if (phone) {
      setDrawer(true);
      openLibrary();
    } else fold(false);
    // Only a new ask opens the bar.
  }, [reveal]);

  async function logout() {
    const unsent = queue.current().length;
    if (unsent > 0) {
      const ok = await dialogs.confirm({
        title: unsent === 1 ? "1 change is not sent yet" : `${unsent} changes are not sent yet`,
        body: "They are kept only on this device, and logging out removes them from it. Log out all the same?",
        action: "Log out and lose them",
        danger: true,
      });
      if (!ok) return;
    }
    // Only the server's answer removes the session cookie, so nothing is wiped without it.
    try {
      await api.logout();
    } catch (err) {
      const offline = !(err instanceof ApiFailure) || err.status === 0;
      toast({
        message: `Could not log out: ${offline ? "no connection." : (err as ApiFailure).message}`,
      });
      return;
    }
    // A borrowed device keeps nothing: the queue and this device's id go, then the app's caches
    // and its service worker. The other tabs hear it and reload too.
    await queue.clear();
    await wipeDevice({
      store: queue,
      caches: typeof caches === "undefined" ? undefined : caches,
      container: navigator.serviceWorker,
    });
    window.location.assign("/login");
  }

  // Another tab logged out: this one goes to the login page as well.
  useEffect(() => queue.onCleared(() => window.location.reload()), []);

  // Moving within the app is a moment to look for a new version (at most once a minute).
  useEffect(() => updates.update(), [pathname]);

  // New entries are made in the folder of the entry in view, unless the author picks another.
  const folderInView = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
  const own = status?.library === "own";
  // What opens a dialog closes the drawer first, so the focus goes to the dialog.
  const actions = {
    onSearch: () => setSwitching(true),
    onNewEntry: () => {
      closeDrawer();
      setMaking(folderInView);
    },
    onNewEntryIn: (folder: string) => {
      closeDrawer();
      setMaking(folder);
    },
    onRandom: () => {
      closeDrawer();
      void roll();
    },
    onKeys: () => {
      closeDrawer();
      setSheet(true);
    },
    onLogout: () => void logout(),
  };
  const rightOpen = !phone && store.open !== null;
  const leftOpen = !phone && !rail;
  const width = readPrefs(kind).width;

  return (
    <ShellStoreProvider value={store}>
      <Refresh.Provider value={refresh}>
        <Status.Provider value={status}>
          <Logout.Provider value={actions.onLogout}>
            <div className={`shell ${phone ? "is-phone" : "is-desktop"}`}>
              {phone ? (
                <div className="phone-top" inert={drawer}>
                  <PhoneBar
                    title={pageName(
                      pathname,
                      current,
                      own ? "Unsaved changes" : "Unpublished changes",
                    )}
                    open={drawer}
                    onMenu={() => setDrawer(true)}
                    onSearch={actions.onSearch}
                    menuRef={menuButton}
                  />
                </div>
              ) : null}
              {!phone && rail ? (
                <aside className="side is-rail" aria-label="Side bar">
                  <Rail onExpand={() => fold(false)} {...actions} />
                </aside>
              ) : null}
              <Group
                className="shell-group"
                orientation="horizontal"
                id="shell"
                inert={drawer}
                onLayoutChanged={(_, meta) => {
                  if (!meta.isUserInteraction) return;
                  if (rightSize.current) writePrefs(kind, { width: Math.round(rightSize.current) });
                  if (leftSize.current) writeLeftWidth(leftSize.current);
                }}
              >
                {leftOpen && (
                  <>
                    {/* The left side bar's width is the device's, the same on every screen. */}
                    <Panel
                      id="left"
                      className="shell-left"
                      defaultSize={`${readLeftWidth()}px`}
                      minSize={LEFT_WIDTH.min}
                      maxSize={LEFT_WIDTH.max}
                      groupResizeBehavior="preserve-pixel-size"
                      onResize={(size) => {
                        leftSize.current = size.inPixels;
                      }}
                    >
                      <aside className="side" aria-label="Side bar">
                        <LeftBar
                          tree={tree}
                          current={current}
                          onRetryTree={refresh}
                          onCollapse={() => fold(true)}
                          {...actions}
                        />
                      </aside>
                    </Panel>
                    <Separator
                      className="splitter left-splitter"
                      id="left-splitter"
                      aria-label="Side bar width"
                    />
                  </>
                )}
                <Panel id="main" minSize="30%" className="shell-main">
                  <UpdateBar />
                  <DeviceNotices />
                  <main className="content">{children}</main>
                </Panel>
                {rightOpen && (
                  <>
                    <Separator
                      className="splitter right-splitter"
                      id="right-splitter"
                      aria-label="Panels width"
                    />
                    <Panel
                      key={kind}
                      id="right"
                      className="shell-right"
                      defaultSize={`${width}px`}
                      minSize={240}
                      maxSize="60%"
                      groupResizeBehavior="preserve-pixel-size"
                      onResize={(size) => {
                        rightSize.current = size.inPixels;
                      }}
                    >
                      <RightBar />
                    </Panel>
                  </>
                )}
              </Group>
              {phone && drawer && (
                <Drawer onClose={closeDrawer} onEscape={library ? closeLibrary : closeDrawer}>
                  <LeftBar
                    tree={tree}
                    current={current}
                    onRetryTree={refresh}
                    drawer
                    library={library}
                    onLibrary={(open) => (open ? openLibrary() : closeLibrary())}
                    onClose={closeDrawer}
                    top={
                      <IconButton
                        label="Close the side bar"
                        icon={X}
                        className="drawer-close"
                        onClick={closeDrawer}
                      />
                    }
                    {...actions}
                  />
                </Drawer>
              )}
              {phone && <BottomSheet />}
              {switching && <Switcher onClose={() => setSwitching(false)} />}
              {sheet && <KeySheet onClose={() => setSheet(false)} />}
              {making !== null && (
                <NewEntry
                  tree={tree}
                  folder={making}
                  onRetry={refresh}
                  onMake={(path, type) => {
                    setMaking(null);
                    navigate(
                      `${editUrl(path)}?new=1${type ? `&type=${encodeURIComponent(type)}` : ""}`,
                    );
                  }}
                  onClose={() => setMaking(null)}
                />
              )}
            </div>
          </Logout.Provider>
        </Status.Provider>
      </Refresh.Provider>
    </ShellStoreProvider>
  );
}
