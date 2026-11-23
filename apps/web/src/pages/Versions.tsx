import { useEffect, useRef, useState } from "react";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import { chronicleIdOf, itemShapeOf, type KeptCopyText, mapIdOf } from "@frontier/schema";
import { api, ApiFailure, chronicleUrl, mapUrl } from "../api.ts";
import { compareItems, nowLabel } from "../offline/itemCompare.ts";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { usePageTitle } from "../components/shell/panels.tsx";
import { queue } from "../sync/queue.ts";
import "./Versions.css";

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The name a kept copy is shown under. */
function deviceLabel(copy: KeptCopyText, self: string | undefined): string {
  if (copy.device === self) return "This device";
  if (copy.deviceName) return copy.deviceName;
  if (copy.device === "earlier") return "A device, before this version of Frontier";
  return "Another device";
}

/** A time today as "18:02", another day with its date. */
function at(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { timeStyle: "short" })
    : when(iso);
}

/**
 * The other side of an item clash in a map, a chronicle or a library item file (stage 15c),
 * shown item by item and read only. The author changes an item by hand on its own page if he
 * wants the other side, then dismisses the kept copy.
 */
function ItemClashes({
  id,
  path,
  current,
  copy,
}: {
  id: string;
  path: string;
  current: string;
  copy: KeptCopyText;
}) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = compareItems(path, current, copy.text, copy.clashes ?? []) ?? [];
  const mapId = mapIdOf(path);
  const chronicleId = chronicleIdOf(path);
  const page = mapId ? mapUrl(mapId) : chronicleId ? chronicleUrl(chronicleId) : null;
  const kind = itemShapeOf(path)?.kind;
  const where = kind === "map" ? "map" : kind === "chronicle" ? "chronicle" : "file";
  const now = nowLabel(path);
  const other = `Server copy at ${at(copy.savedAt)}`;
  usePageTitle("Changed in both places");

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await api.dismissKept(id);
      refresh();
      navigate(page ?? "/unpublished");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not dismiss.");
      setBusy(false);
    }
  }

  return (
    <article className="entry wide versions-page">
      <header className="entry-head">
        <h1>Changed in both places</h1>
        <p className="muted lede">
          These were changed on this device and on another. Yours is in the {where}; the other
          version was kept and is shown here. To use it, change the item on the {where}&apos;s own
          page, then dismiss this.
        </p>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items.map((item) => (
        <section className="item-clash" key={item.key} aria-label={item.name}>
          <h3>{item.name}</h3>
          {item.state === "removed-other" && <p className="muted">Removed in the server copy.</p>}
          {item.state === "removed-now" && (
            <p className="muted">Removed in the {where} now; the server copy still has it.</p>
          )}
          {item.state === "same" && <p className="muted">Both sides are the same now.</p>}
          {item.rows.length > 0 && (
            <table className="item-clash-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Field</span>
                  </th>
                  <th scope="col">{now}</th>
                  <th scope="col">{other}</th>
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row) => (
                  <tr key={row.field}>
                    <th scope="row">{row.field}</th>
                    <td>
                      {row.now}
                      {row.moved && mapId && (
                        <>
                          {" "}
                          <Link to={mapUrl(mapId, item.key)}>Show on map</Link>
                        </>
                      )}
                    </td>
                    <td>{row.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <p className="plan-actions">
        {page && <Link to={page}>Open the {where}</Link>}
        <ActionButton
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Dismiss
        </ActionButton>
      </p>
    </article>
  );
}

/**
 * A draft and the texts kept beside it from devices that started from older text. The author
 * compares the draft with each in turn and keeps one, or combines them by hand. Keeping clears
 * every kept copy.
 */
export function VersionsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [data, setData] = useState<{
    path: string;
    current: string;
    others: KeptCopyText[];
  } | null>(null);
  const [chosen, setChosen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = useRef("");
  const self = queue.device?.id;

  useEffect(() => {
    api.versions(id).then(
      (v) => {
        text.current = v.current.text;
        setData({ path: v.path ?? "", current: v.current.text, others: v.others });
      },
      (err: unknown) => setError(err instanceof ApiFailure ? err.message : "Could not load."),
    );
  }, [id]);

  async function keep(kept: string) {
    setBusy(true);
    setError(null);
    try {
      await api.mergeVersions(id, kept);
      refresh();
      navigate("/unpublished");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  if (error && !data) return <p className="center error">{error}</p>;
  if (!data) return <p className="center muted">Loading…</p>;
  // An item file's other side is shown item by item, read only (stage 15c).
  const server = data.others.find((o) => o.source === "server");
  if (server && itemShapeOf(data.path)) {
    return <ItemClashes id={id} path={data.path} current={data.current} copy={server} />;
  }
  const copy = data.others[chosen] ?? data.others[0]!;
  const count = data.others.length + 1;
  const from = deviceLabel(copy, self);

  return (
    <article className="entry wide versions-page">
      <header className="entry-head">
        <h1>{count === 2 ? "Two texts to compare" : `${count} texts to compare`}</h1>
        <p className="muted lede">
          This entry was changed on more than one device, and a device's text started from an older
          one. Nothing was lost: each device's text is kept beside the draft. Keep one, or combine
          them below; the kept texts are then cleared.
        </p>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data.others.length > 1 && (
        <div className="kept-copies" role="group" aria-label="Kept texts">
          {data.others.map((o, i) => (
            <button
              key={o.device}
              type="button"
              className="quiet"
              aria-pressed={i === chosen}
              onClick={() => setChosen(i)}
            >
              {deviceLabel(o, self)} <span className="muted">{when(o.savedAt)}</span>
            </button>
          ))}
        </div>
      )}
      <h3>
        The text from {from === "This device" ? "this device" : from},{" "}
        <span className="muted">{when(copy.savedAt)}</span>, compared with the draft
      </h3>
      <Diff before={data.current} after={copy.text} />
      <p className="plan-actions">
        <ActionButton
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => void keep(copy.text)}
        >
          Keep this one
        </ActionButton>
        <ActionButton
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => void keep(data.current)}
        >
          Keep the draft
        </ActionButton>
      </p>
      <h3>Or combine them by hand</h3>
      <div className="boxed">
        <CodeEditor initial={data.current} onChange={(t) => (text.current = t)} />
      </div>
      <p className="plan-actions">
        <ActionButton
          type="button"
          className="primary big"
          disabled={busy}
          onClick={() => void keep(text.current)}
        >
          Keep this text
        </ActionButton>
      </p>
    </article>
  );
}
