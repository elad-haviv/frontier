import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "./api.ts";
import { LoginDialog } from "./components/LoginDialog.tsx";
import { Shell } from "./components/Shell.tsx";
import { noteSignedIn, openApp } from "./offline/start.ts";
import { updates } from "./offline/updates.ts";
import { connection } from "./sync/connection.ts";
import { queue } from "./sync/queue.ts";
import { EntryPage } from "./pages/Entry.tsx";
import { UnpublishedPage } from "./pages/Unpublished.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { ConversationPage } from "./pages/Conversation.tsx";
import { TalkPage } from "./pages/Talk.tsx";
import { ExportPage } from "./pages/Export.tsx";
import { GalleryPage } from "./pages/Gallery.tsx";
import { Home } from "./pages/Home.tsx";
import { HistoryPage, LibraryHistoryPage } from "./pages/History.tsx";
import { ImportPage } from "./pages/Import.tsx";
import { InboxPage } from "./pages/Inbox.tsx";
import { ChroniclesPage } from "./pages/Chronicles.tsx";
import { MapsPage } from "./pages/Maps.tsx";
import { Login } from "./pages/Login.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { StatusPage } from "./pages/Status.tsx";
import { Progress } from "./components/ui/Progress.tsx";

// The map, chronicle and graph pages carry their renderers and geometry; they load when first opened,
// so the first page of the app comes up sooner.
const MapPage = lazy(() => import("./pages/MapPage.tsx").then((m) => ({ default: m.MapPage })));
const ChroniclePage = lazy(() =>
  import("./pages/ChroniclePage.tsx").then((m) => ({ default: m.ChroniclePage })),
);
const GraphPage = lazy(() => import("./pages/Graph.tsx").then((m) => ({ default: m.GraphPage })));
// The pages that edit text carry the editor (CodeMirror, its language, the toolbar and its
// commands); they load when first opened too. The service worker keeps them for offline use.
const EditPage = lazy(() => import("./pages/Edit.tsx").then((m) => ({ default: m.EditPage })));
const ConflictPage = lazy(() =>
  import("./pages/Conflict.tsx").then((m) => ({ default: m.ConflictPage })),
);
const VersionsPage = lazy(() =>
  import("./pages/Versions.tsx").then((m) => ({ default: m.VersionsPage })),
);

/** A page that loads when first opened, with the progress line meanwhile. */
const later = (page: React.ReactNode) => <Suspense fallback={<Progress />}>{page}</Suspense>;

/** A different map gets a fresh page: its own view, drawing surface and history. */
function OneMap() {
  const { id = "" } = useParams();
  return (
    <Suspense fallback={<Progress />}>
      <MapPage key={id} />
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
    void openApp({ session: api.session, store: queue, connection }).then(setLoggedIn);
  }, []);
  useEffect(check, [check]);

  // Once in: the connection service listens to the server, and the save queue starts sending,
  // after taking in what the browser buffer of an earlier build still holds. The service worker
  // is registered only now, so a browser that is logged out never gets one back.
  useEffect(() => {
    if (!loggedIn) return;
    connection.start();
    void queue.start();
    void updates.register();
    return () => connection.stop();
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
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/e/*" element={<EntryPage />} />
        <Route path="/edit/*" element={later(<EditPage />)} />
        <Route path="/rename/*" element={<RenameRedirect />} />
        <Route path="/unpublished" element={<UnpublishedPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/history/*" element={<HistoryPage />} />
        <Route path="/versions" element={<LibraryHistoryPage />} />
        <Route path="/maps" element={<MapsPage />} />
        <Route path="/map/:id" element={<OneMap />} />
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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/conflict/:id" element={later(<ConflictPage />)} />
        <Route path="/versions/:id" element={later(<VersionsPage />)} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          path="*"
          element={<p className="center muted">There is no page at this address.</p>}
        />
      </Routes>
      <LoginDialog />
    </Shell>
  );
}
