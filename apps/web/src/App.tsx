import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { ConflictPage } from "./pages/Conflict.tsx";
import { EditPage } from "./pages/Edit.tsx";
import { EntryPage } from "./pages/Entry.tsx";
import { UnpublishedPage } from "./pages/Unpublished.tsx";
import { VersionsPage } from "./pages/Versions.tsx";
import { Home } from "./pages/Home.tsx";
import { HistoryPage, LibraryHistoryPage } from "./pages/History.tsx";
import { ImportPage } from "./pages/Import.tsx";
import { InboxPage } from "./pages/Inbox.tsx";
import { MapPage } from "./pages/MapPage.tsx";
import { MapsPage } from "./pages/Maps.tsx";
import { Login } from "./pages/Login.tsx";
import { RenamePage } from "./pages/Rename.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { StatusPage } from "./pages/Status.tsx";

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
        <Route path="/map/:id" element={<MapPage />} />
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
