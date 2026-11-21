import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { ConflictPage } from "./pages/Conflict.tsx";
import { EditPage } from "./pages/Edit.tsx";
import { EntryPage } from "./pages/Entry.tsx";
import { UnpublishedPage } from "./pages/Unpublished.tsx";
import { VersionsPage } from "./pages/Versions.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { ConversationPage } from "./pages/Conversation.tsx";
import { TalkPage } from "./pages/Talk.tsx";
import { GalleryPage } from "./pages/Gallery.tsx";
import { Home } from "./pages/Home.tsx";
import { HistoryPage, LibraryHistoryPage } from "./pages/History.tsx";
import { ImportPage } from "./pages/Import.tsx";
import { InboxPage } from "./pages/Inbox.tsx";
import { ChroniclePage } from "./pages/ChroniclePage.tsx";
import { ChroniclesPage } from "./pages/Chronicles.tsx";
import { MapPage } from "./pages/MapPage.tsx";
import { MapsPage } from "./pages/Maps.tsx";
import { Login } from "./pages/Login.tsx";
import { RenamePage } from "./pages/Rename.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { StatusPage } from "./pages/Status.tsx";

/** A different map gets a fresh page: its own view, drawing surface and history. */
function OneMap() {
  const { id = "" } = useParams();
  return <MapPage key={id} />;
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
        <Route path="/e/*" element={<EntryPage onSessionLost={() => setLoggedIn(false)} />} />
        <Route path="/edit/*" element={<EditPage />} />
        <Route path="/rename/*" element={<RenamePage />} />
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
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/chronicles" element={<ChroniclesPage />} />
        <Route path="/chronicle/:id" element={<ChroniclePage />} />
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
    </Shell>
  );
}
