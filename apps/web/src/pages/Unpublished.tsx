import type { PublishPlan, UnpublishedResponse } from "@frontier/schema";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, editUrl, entryUrl, imageUrl } from "../api.ts";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";

const KIND = { edit: "Edited", create: "New", delete: "Deleted" } as const;

const REASON: Record<string, string> = {
  overlap: "You and someone else changed the same lines.",
  created_on_main: "A file with this name was added to the vault meanwhile.",
  deleted_on_main: "This file was deleted from the vault meanwhile.",
  delete_of_changed_file: "This file was changed in the vault after you chose to delete it.",
  binary_changed_on_both: "This image was changed in both places.",
  rename_blocked: "This rename cannot be carried out.",
};

export function UnpublishedPage() {
  const refresh = useRefresh();
  const [data, setData] = useState<UnpublishedResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const u = await api.unpublished();
      setData(u);
      setSelected(new Set([...u.drafts.map((d) => d.id), ...u.renames.map((r) => r.id)]));
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiFailure ? err.message : "Could not load.",
      });
    }
  }, []);
  useEffect(() => void load(), [load]);

  const fail = (err: unknown) =>
    setNotice({
      kind: "error",
      text: err instanceof ApiFailure ? err.message : "Something went wrong.",
    });

  async function review() {
    if (!data) return;
    setBusy(true);
    setNotice(null);
    try {
      const p = await api.plan(
        data.drafts.filter((d) => selected.has(d.id)).map((d) => d.id),
        data.renames.filter((r) => selected.has(r.id)).map((r) => r.id),
        data.decisions.map((d) => d.id),
      );
      setPlan(p);
      setConfirmed(new Set());
      await load();
      refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!plan) return;
    setBusy(true);
    setNotice(null);
    try {
      const { commit } = await api.confirm(plan.planId, [...confirmed], message.trim());
      setPlan(null);
      setMessage("");
      setNotice({ kind: "ok", text: `Published as commit ${commit.slice(0, 10)}.` });
      await load();
      refresh();
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === "main_moved" || err.code === "plan_expired")) {
        setPlan(null);
        setNotice({ kind: "error", text: `${err.message} Nothing was published.` });
      } else fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function discard(id: string) {
    if (!window.confirm("Discard this draft?")) return;
    await api.discardDraft(id).catch(fail);
    setPlan(null);
    await load();
    refresh();
  }

  async function cancelRename(id: string) {
    await api.cancelRename(id).catch(fail);
    setPlan(null);
    await load();
    refresh();
  }

  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  if (!data) return <p className="center muted">{notice?.text ?? "Loading…"}</p>;
  const empty =
    data.drafts.length === 0 && data.renames.length === 0 && data.decisions.length === 0;
  const chosen = selected.size + data.decisions.length;
  const publishable = plan
    ? plan.ready.length + confirmed.size + plan.renames.length + plan.decisions.length
    : 0;
  const pathOf = (id: string) => data.drafts.find((d) => d.id === id)?.path ?? id;

  return (
    <article className="entry wide">
      <header className="entry-head">
        <h1>Unpublished changes</h1>
        <p className="muted lede">
          Drafts are saved on the server and are not part of the vault until you publish. Publishing
          makes one commit.
        </p>
      </header>

      {notice && (
        <p className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`} role="status">
          {notice.text}
        </p>
      )}
      {empty && <p className="muted">Nothing is waiting. Everything you wrote is published.</p>}

      {!plan && !empty && (
        <>
          <ul className="changes">
            {data.drafts.map((d) => (
              <li key={d.id}>
                <label className="change-head">
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(selected, d.id, setSelected)}
                  />
                  <span className={`tag tag-${d.kind}`}>{KIND[d.kind]}</span>
                  <span className="change-path">{d.path}</span>
                </label>
                {d.binary ? (
                  <img className="change-image" src={imageUrl(d.path, 320)} alt={d.path} />
                ) : (
                  <details>
                    <summary>Show changes</summary>
                    <Diff before={d.mainText ?? ""} after={d.kind === "delete" ? "" : d.text} />
                  </details>
                )}
                <p className="change-actions">
                  {d.kind !== "delete" && !d.binary && (
                    <Link to={editUrl(d.path)}>Keep editing</Link>
                  )}
                  <button type="button" className="plain danger" onClick={() => discard(d.id)}>
                    Discard
                  </button>
                </p>
              </li>
            ))}
            {data.renames.map((r) => (
              <li key={r.id}>
                <label className="change-head">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(selected, r.id, setSelected)}
                  />
                  <span className="tag tag-edit">Renamed</span>
                  <span className="change-path">
                    {r.from} → {r.to}
                  </span>
                </label>
                <p className="muted">Links in {r.affected.length} notes will be rewritten.</p>
                <p className="change-actions">
                  <button type="button" className="plain danger" onClick={() => cancelRename(r.id)}>
                    Cancel rename
                  </button>
                </p>
              </li>
            ))}
            {data.decisions.map((d) => (
              <li key={d.id}>
                <p className="change-head">
                  <span className="tag tag-edit">Review decision</span>
                  <span className="change-path">
                    {d.decision === "accepted" ? "Accept" : "Revert"} {d.path}
                  </span>
                </p>
                <p className="muted">
                  {d.decision === "accepted"
                    ? "Tells the memory bank that this unreviewed note is canon."
                    : "Goes out together with the change that puts the note back."}
                </p>
                <p className="change-actions">
                  <button
                    type="button"
                    className="plain danger"
                    onClick={async () => {
                      await api.withdrawDecision(d.id).catch(() => undefined);
                      setPlan(null);
                      await load();
                      refresh();
                    }}
                  >
                    Withdraw
                  </button>
                </p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary big"
            disabled={busy || chosen === 0}
            onClick={review}
          >
            {busy ? "Checking the vault…" : `Review ${chosen} change${chosen === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {plan && (
        <section className="plan">
          <h2>Review before publishing</h2>

          {plan.ready.length > 0 && (
            <>
              <h3>Ready</h3>
              <ul className="plain-list">
                {plan.ready.map((id) => (
                  <li key={id}>{pathOf(id)}</li>
                ))}
              </ul>
            </>
          )}

          {plan.renames.length > 0 && (
            <>
              <h3>Renames</h3>
              <ul className="plain-list">
                {plan.renames.map((r) => (
                  <li key={r.id}>
                    {r.from} → {r.to}
                    <span className="muted"> · rewrites links in {r.affected.length} notes</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.merges.length > 0 && (
            <>
              <h3>Changed in the vault too: confirm the combined text</h3>
              <p className="muted">
                Someone else changed these files in a different place than you did. Below is what
                the file would become, compared with what is in the vault now. Tick a file to
                publish it.
              </p>
              <ul className="changes">
                {plan.merges.map((m) => (
                  <li key={m.id}>
                    <label className="change-head">
                      <input
                        type="checkbox"
                        checked={confirmed.has(m.id)}
                        onChange={() => toggle(confirmed, m.id, setConfirmed)}
                      />
                      <span className="change-path">{m.path}</span>
                    </label>
                    <Diff before={m.mainText} after={m.mergedText} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.conflicts.length > 0 && (
            <>
              <h3>Held back</h3>
              <ul className="changes">
                {plan.conflicts.map((c) => (
                  <li key={c.draftId}>
                    <p className="change-path">{c.path}</p>
                    <p className="error">
                      {REASON[c.reason]} {c.reason === "rename_blocked" && c.mine}
                    </p>
                    {c.reason !== "rename_blocked" && (
                      <Link to={`/conflict/${c.draftId}`} state={{ conflict: c }}>
                        Resolve
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <p className="muted">The rest can still be published now.</p>
            </>
          )}

          <label className="field">
            <span>What changed, in a line</span>
            <input
              type="text"
              value={message}
              maxLength={200}
              placeholder="Add the Saltmother entry"
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <p className="plan-actions">
            <button type="button" className="quiet" onClick={() => setPlan(null)}>
              Back
            </button>
            <button
              type="button"
              className="primary big"
              disabled={busy || publishable === 0 || message.trim() === ""}
              onClick={publish}
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          </p>
        </section>
      )}

      {!plan && (
        <p className="muted small">
          <Link to={entryUrl("README.md")}>Back to reading</Link>
        </p>
      )}
    </article>
  );
}
