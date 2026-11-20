import { Navigate } from "react-router-dom";
import { api, entryUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";

/** Opens the vault's README, or the first note when there is none. */
export function Home() {
  const tree = useAsync(() => api.tree(), "home");
  if (tree.state === "loading") return <p className="center muted">Loading the vault…</p>;
  if (tree.state === "failed") return <p className="center error">{tree.error.message}</p>;
  const readme = tree.value.notes.find((n) => n.path.toLowerCase() === "readme.md");
  const first = readme ?? tree.value.notes[0] ?? tree.value.folders[0]?.notes[0];
  if (!first) return <p className="center muted">The vault has no notes yet.</p>;
  return <Navigate to={entryUrl(first.path)} replace />;
}
