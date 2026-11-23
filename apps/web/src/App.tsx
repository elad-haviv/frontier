import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "./api.ts";
import { LoginDialog } from "./components/LoginDialog.tsx";
import { Shell } from "./components/Shell.tsx";
import { connection } from "./sync/connection.ts";
import { queue } from "./sync/queue.ts";
import { ConflictPage } from "./pages/Conflict.tsx";
import { EditPage } from "./pages/Edit.tsx";
import { EntryPage } from "./pages/Entry.tsx";
import { UnpublishedPage } from "./pages/Unpublished.tsx";
import { VersionsPage } from "./pages/Versions.tsx";
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

// The map and chronicle pages carry their renderers and geometry; they load when first opened,
// so the first page of the app comes up sooner.
const MapPage = lazy(() => import("./pages/MapPage.tsx").then((m) => ({ default: m.MapPage })));
const ChroniclePage = lazy(() =>
  import("./pages/ChroniclePage.tsx").then((m) => ({ default: m.ChroniclePage })),
);

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

  const check = useCallback(() => {
    api.session().then(
      (s) => setLoggedIn(s.loggedIn),
      () => setLoggedIn(false),
    );
  }, []);
  useEffect(check, [check]);

  // Once in: the connection service listens to the server, and the save queue starts sending,
  // after taking in what the browser buffer of an earlier build still holds.
  useEffect(() => {
    if (!loggedIn) return;
    connection.start();
    void queue.start();
    return () => connection.stop();
  }, [loggedIn]);

  if (loggedIn === null) return <p className="center muted">Opening Frontier…</p>;

  if (!loggedIn) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLoggedIn={() => setLoggedIn(true)} />} />
        <Route
          path="*"
          element={<Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
      </Routes>
    );
  }

  return (
    <Shell onLoggedOut={() => setLoggedIn(false)}>
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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/conflict/:id" element={<ConflictPage />} />
        <Route path="/versions/:id" element={<VersionsPage />} />
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
