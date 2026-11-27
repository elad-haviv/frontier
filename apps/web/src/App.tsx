import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "./api.ts";
import { clearMe, loadMe } from "./me.ts";
import { resumeProposals } from "./proposeAfterPublish.ts";
import { useAsync } from "./useAsync.ts";
import { noteOpened } from "./map/mapsList.ts";
import { AiKeyPromptHost } from "./components/AiKeyPrompt.tsx";
import { KeysRemovedNotice } from "./components/KeysRemovedNotice.tsx";
import { LoginDialog } from "./components/LoginDialog.tsx";
import { Shell } from "./components/Shell.tsx";
import { startDeviceCopy } from "./offline/copy.ts";
import { noteSignedIn, openApp } from "./offline/start.ts";
import { updates } from "./offline/updates.ts";
import { connection } from "./sync/connection.ts";
import { queue } from "./sync/queue.ts";
import { EntryPage } from "./pages/Entry.tsx";
import { UnpublishedPage } from "./pages/Unpublished.tsx";
import { Home } from "./pages/Home.tsx";
import { ChroniclesPage } from "./pages/Chronicles.tsx";
import { MapsPage } from "./pages/Maps.tsx";
import { Login } from "./pages/Login.tsx";
const SettingsPage = lazy(() =>
  import("./pages/settings/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })),
);
import { StatusPage } from "./pages/Status.tsx";
import { Progress } from "./components/ui/Progress.tsx";

// The map, chronicle and graph pages carry their renderers and geometry; they load when first opened,
// so the first page of the app comes up sooner.
const MapPage = lazy(() => import("./pages/MapPage.tsx").then((m) => ({ default: m.MapPage })));
const StarMapPage = lazy(() =>
  import("./pages/StarMapPage.tsx").then((m) => ({ default: m.StarMapPage })),
);
const SystemMapPage = lazy(() =>
  import("./pages/SystemMapPage.tsx").then((m) => ({ default: m.SystemMapPage })),
);
const StackPage = lazy(() =>
  import("./pages/StackPage.tsx").then((m) => ({ default: m.StackPage })),
);
const ChroniclePage = lazy(() =>
  import("./pages/ChroniclePage.tsx").then((m) => ({ default: m.ChroniclePage })),
);
const GraphPage = lazy(() => import("./pages/Graph.tsx").then((m) => ({ default: m.GraphPage })));
// Pages that need the server, and are opened now and then: they load when first opened too, so
// the first load leaves room for what the app keeps on the device (stage 15b).
const AskPage = lazy(() => import("./pages/Ask.tsx").then((m) => ({ default: m.AskPage })));
const ConversationPage = lazy(() =>
  import("./pages/Conversation.tsx").then((m) => ({ default: m.ConversationPage })),
);
const TalkPage = lazy(() => import("./pages/Talk.tsx").then((m) => ({ default: m.TalkPage })));
const ExportPage = lazy(() =>
  import("./pages/Export.tsx").then((m) => ({ default: m.ExportPage })),
);
const GalleryPage = lazy(() =>
  import("./pages/Gallery.tsx").then((m) => ({ default: m.GalleryPage })),
);
const HistoryPage = lazy(() =>
  import("./pages/History.tsx").then((m) => ({ default: m.HistoryPage })),
);
const LibraryHistoryPage = lazy(() =>
  import("./pages/History.tsx").then((m) => ({ default: m.LibraryHistoryPage })),
);
const ImportPage = lazy(() =>
  import("./pages/Import.tsx").then((m) => ({ default: m.ImportPage })),
);
const InboxPage = lazy(() => import("./pages/Inbox.tsx").then((m) => ({ default: m.InboxPage })));
// The pages that edit text carry the editor (CodeMirror, its language, the toolbar and its
// commands); they load when first opened too. The service worker keeps them for offline use.
const EditPage = lazy(() => import("./pages/Edit.tsx").then((m) => ({ default: m.EditPage })));
const ConflictPage = lazy(() =>
  import("./pages/Conflict.tsx").then((m) => ({ default: m.ConflictPage })),
);
const VersionsPage = lazy(() =>
  import("./pages/Versions.tsx").then((m) => ({ default: m.VersionsPage })),
);

/** A different map gets a fresh page: its own view, drawing surface and history. */
function OneMap() {
  const { id = "" } = useParams();
  // Kept on this device, for the list of maps' "Recently opened".
  useEffect(() => noteOpened(id), [id]);
  // A star map and a system model have their own pages; any other map, and one that could not be read, the map page.
  const kind = useAsync(() => api.map(id).then((m) => m.map.space.kind), `map-kind:${id}`);
  if (kind.state === "loading") return <Progress />;
  const space = kind.state === "ready" ? kind.value : null;
  return (
    <Suspense fallback={<Progress />}>
      {space === "stars" ? (
        <StarMapPage key={id} />
      ) : space === "system" ? (
        <SystemMapPage key={id} />
      ) : (
        <MapPage key={id} />
      )}
    </Suspense>
  );
}

/** Renaming happens on the entry's own page now; an old address opens the entry. */
function RenameRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={"/e/" + pathname.slice("/rename/".length)} replace />;
}

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const location = useLocation();

  // Signed in, signed in with the server out of reach, or the login page (`offline/start.ts`).
  const check = useCallback(() => {
    void openApp({ session: api.session, store: queue, connection }).then((signedIn) => {
      // Before any page reads: their reads are kept on this device from the first one.
      if (signedIn) startDeviceCopy();
      setLoggedIn(signedIn);
    });
  }, []);
  useEffect(check, [check]);

  // Once in: the connection service listens to the server, and the save queue starts sending,
  // after taking in what the browser buffer of an earlier build still holds. The service worker
  // is registered only now, so a browser that is logged out never gets one back.
  useEffect(() => {
    // Who is logged in, for the left bar; forgotten when the login page is what shows.
    if (loggedIn === false) clearMe();
    if (!loggedIn) return;
    // Proposals an earlier page left waiting (after a save) go on once the person is known,
    // since the keys on this device are theirs.
    const resume = () => void loadMe().then(() => resumeProposals());
    resume();
    // The person is read again whenever the connection comes back, since the first read may have
    // failed while it was down.
    let last = connection.state;
    const unsubscribe = connection.subscribe(() => {
      if (connection.state === "online" && last !== "online") resume();
      last = connection.state;
    });
    connection.start();
    void queue.start();
    void updates.register();
    return () => {
      unsubscribe();
      connection.stop();
    };
  }, [loggedIn]);

  if (loggedIn === null) return <p className="center muted">Opening Frontier…</p>;

  if (!loggedIn) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <Login
              onLoggedIn={() => {
                void noteSignedIn(queue);
                // Reads are kept on this device, and answered from it when the server cannot be reached.
                startDeviceCopy();
                setLoggedIn(true);
              }}
            />
          }
        />
        <Route
          path="*"
          element={<Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
      </Routes>
    );
  }

  return (
    <Shell>
      <Suspense fallback={<Progress />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/e/*" element={<EntryPage />} />
          <Route path="/edit/*" element={<EditPage />} />
          <Route path="/rename/*" element={<RenameRedirect />} />
          <Route path="/unpublished" element={<UnpublishedPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/history/*" element={<HistoryPage />} />
          <Route path="/versions" element={<LibraryHistoryPage />} />
          <Route path="/maps" element={<MapsPage />} />
          <Route path="/map/:id" element={<OneMap />} />
          <Route
            path="/stack/:id"
            element={
              <Suspense fallback={<Progress />}>
                <StackPage />
              </Suspense>
            }
          />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/ask/:id" element={<ConversationPage />} />
          <Route path="/talk/*" element={<TalkPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/chronicles" element={<ChroniclesPage />} />
          <Route
            path="/chronicle/:id"
            element={
              <Suspense fallback={<Progress />}>
                <ChroniclePage />
              </Suspense>
            }
          />
          <Route
            path="/graph"
            element={
              <Suspense fallback={<Progress />}>
                <GraphPage />
              </Suspense>
            }
          />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/conflict/:id" element={<ConflictPage />} />
          <Route path="/versions/:id" element={<VersionsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route
            path="*"
            element={<p className="center muted">There is no page at this address.</p>}
          />
        </Routes>
      </Suspense>
      <LoginDialog />
      <AiKeyPromptHost />
      <KeysRemovedNotice />
    </Shell>
  );
}
