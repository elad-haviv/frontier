import { useEffect } from "react";
import { Link } from "../nav.tsx";
import { api, entryUrl } from "../api.ts";
import { useConnection } from "../sync/connection.ts";
import { usePageTitle } from "./shell/panels.tsx";
import { useAsync } from "../useAsync.ts";
import "./OfflineCopy.css";

const nameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/**
 * An entry that is not on this device while the server cannot be reached: it says so, and shows
 * its folder and its links out and in from the compact index, each a link. When the connection
 * returns, `onConnected` opens the entry.
 */
export function NotOnDevice({ path, onConnected }: { path: string; onConnected?: () => void }) {
  const { state } = useConnection();
  const index = useAsync(() => api.graph(), "not-on-device-index");
  useEffect(() => {
    if (state === "online") onConnected?.();
    // Only the connection coming back reopens the entry.
  }, [state]);

  const name = nameOf(path);
  usePageTitle(name);
  const folder = path.split("/").slice(0, -1).join(" › ");
  let out: string[] = [];
  let into: string[] = [];
  if (index.state === "ready") {
    const nodes = index.value.nodes;
    const at = nodes.findIndex((n) => n.path === path);
    if (at !== -1) {
      out = index.value.edges.filter(([a]) => a === at).map(([, b]) => nodes[b]!.path);
      into = index.value.edges.filter(([, b]) => b === at).map(([a]) => nodes[a]!.path);
    }
  }
  const list = (title: string, paths: string[]) =>
    paths.length > 0 && (
      <>
        <h2>{title}</h2>
        <ul>
          {paths.map((p) => (
            <li key={p}>
              <Link to={entryUrl(p)}>{nameOf(p)}</Link>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <article className="not-on-device">
      {folder && <p className="crumbs">{folder}</p>}
      <h1>{name}</h1>
      <p className="not-on-device-why" role="status">
        {name} is not on this device. It opens when you are connected.
      </p>
      {list("Links to", out)}
      {list("Mentioned in", into)}
      <p>
        <Link to="/">Back to the start</Link>
      </p>
    </article>
  );
}
