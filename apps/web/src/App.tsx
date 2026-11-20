import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { EntryPage } from "./pages/Entry.tsx";
import { Home } from "./pages/Home.tsx";
import { Login } from "./pages/Login.tsx";
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
