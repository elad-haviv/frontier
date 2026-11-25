import { ActionButton } from "./ui/ActionButton.tsx";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, type Discovery, discoveryArtUrl, entryUrl } from "../api.ts";

const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

/** A proposed discovery: what it is, what it grew from, its picture, and keeping or dropping it. */
export function DiscoveryCard(p: {
  map: string;
  discovery: Discovery;
  canArt: boolean;
  folders: string[];
  onChanged: (d: Discovery) => void;
  onKept: (path: string) => void;
  onDropped: () => void;
  onClose: () => void;
  /** Its place among the discoveries waiting: "‹ 1 of 4 found ›". */
  step?: { index: number; count: number; go: (by: 1 | -1) => void };
  /** The look of the point of interest it was found at. */
  whereIcon?: ReactNode;
}) {
  const d = p.discovery;
  // The folder of the first entry it grew from is the likely home; any folder can be chosen.
  const likely = d.basis[0]?.path.split("/").slice(0, -1).join("/");
  const [folder, setFolder] = useState(
    likely && p.folders.includes(likely) ? likely : (p.folders[0] ?? ""),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);

  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="feature-card discovery-card" aria-label="A discovery">
      <button type="button" className="plain card-close" aria-label="Close" onClick={p.onClose}>
        ✕
      </button>
      {p.step && p.step.count > 1 && (
        <p className="discovery-step">
          <button
            type="button"
            className="plain"
            aria-label="The previous one found"
            onClick={() => p.step!.go(-1)}
          >
            ‹
          </button>
          {p.step.index + 1} of {p.step.count} found
          <button
            type="button"
            className="plain"
            aria-label="The next one found"
            onClick={() => p.step!.go(1)}
          >
            ›
          </button>
        </p>
      )}
      <p className="muted discovery-kind">
        Proposed {d.kind}
        {d.role ? ` · ${d.role}` : ""} · not in the lore
      </p>
      <h2>{d.name}</h2>
      {d.spot && (
        <p className="discovery-where">
          {p.whereIcon}
          {d.spot.title}
        </p>
      )}
      {d.art && (
        <img
          className="discovery-art"
          src={`${discoveryArtUrl(p.map, d.id)}?v=${stamp}`}
          alt={`Concept art of ${d.name}`}
        />
      )}
      <p className="card-text">{d.description}</p>
      {d.basis.length > 0 && (
        <div className="discovery-basis">
          <p className="muted">Grown from:</p>
          {d.basis.map((b, i) => (
            <blockquote key={i}>
              “{b.quote}” — <Link to={entryUrl(b.path)}>{titleOf(b.path)}</Link>
            </blockquote>
          ))}
        </div>
      )}
      {d.conflicts.map((c, i) => (
        <p key={i} className="error discovery-conflict">
          {c}
        </p>
      ))}
      {p.canArt && (
        <p className="change-actions">
          <ActionButton
            type="button"
            className="quiet"
            disabled={busy !== null}
            onClick={() =>
              void run("art", async () => {
                const { discovery } = await api.discoveryArt(p.map, d.id);
                setStamp((n) => n + 1);
                p.onChanged(discovery);
              })
            }
          >
            {busy === "art" ? "Drawing…" : d.art ? "Draw it again" : "Make concept art"}
          </ActionButton>
        </p>
      )}
      <label className="field">
        <span>Keep it as a new entry in</span>
        <select
          aria-label="Folder for the new entry"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          {p.folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="change-actions">
        <ActionButton
          type="button"
          className="primary"
          disabled={busy !== null || !folder}
          onClick={() =>
            void run("keep", async () => {
              const { path } = await api.keepDiscovery(p.map, d.id, folder);
              p.onKept(path);
            })
          }
        >
          Keep
        </ActionButton>
        <ActionButton
          type="button"
          className="plain danger"
          disabled={busy !== null}
          onClick={() =>
            void run("drop", async () => {
              await api.dropDiscovery(p.map, d.id);
              p.onDropped();
            })
          }
        >
          Discard
        </ActionButton>
      </p>
    </aside>
  );
}
