import { ActionButton } from "../components/ui/ActionButton.tsx";
import type { BranchFile, InboxBranch, InboxProposal, InboxQuarantined } from "@frontier/schema";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "../nav.tsx";
import { api, ApiFailure, branchImageUrl, editUrl, entryUrl } from "../api.ts";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";

const KIND: Record<BranchFile["kind"], string> = {
  added: "New",
  changed: "Changed",
  removed: "Removed",
};
const TAG: Record<BranchFile["kind"], string> = {
  added: "create",
  changed: "edit",
  removed: "delete",
};

const WHOLE: Partial<Record<InboxBranch["state"], string>> = {
  empty: "Nothing on this branch differs from the vault.",
  no_fork: "This branch shares no history with the vault, so it cannot be shown as changes.",
  too_many: "This branch changes more than 200 files. It can only be rejected as a whole.",
  decided: "Every file is decided, but the branch could not be removed from GitHub.",
};

/** The text of one file before and after, fetched when the author opens it. */
function FileChanges({ branch, file }: { branch: string; file: BranchFile }) {
  const [texts, setTexts] = useState<{ before: string | null; after: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(open: boolean) {
    if (!open || texts) return;
    api.branchFile(branch, file.path).then(setTexts, (err: unknown) => {
      setError(err instanceof ApiFailure ? err.message : "Could not load the changes.");
    });
  }

  return (
    <details onToggle={(e) => load(e.currentTarget.open)}>
      <summary>Show changes</summary>
      {error && <p className="error">{error}</p>}
      {!texts && !error && <p className="muted">Loading…</p>}
      {texts && <Diff before={texts.before ?? ""} after={texts.after ?? ""} />}
    </details>
  );
}

type Op = InboxProposal["operations"][number]["operation"];

/** One proposed field with the sentence it came from. The author may correct it before accepting. */
function Operation({
  operation: o,
  applies,
  busy,
  decide,
}: {
  operation: Op;
  applies: boolean;
  busy: boolean;
  decide: (body: {
    decision: "accept" | "reject" | "dismiss";
    what?: string;
    when?: string;
    type?: string;
  }) => void;
}) {
  const [what, setWhat] = useState(o.op === "add_time" ? o.what : "");
  const [when, setWhen] = useState(o.op === "add_time" ? o.when : "");
  const [type, setType] = useState(o.op === "set_type" ? o.type : "");
  const [editing, setEditing] = useState(false);

  return (
    <li>
      <p className="change-head">
        <span className="tag tag-create">{o.op === "add_time" ? "Date" : "Type"}</span>
        <span className="operation-value">
          {o.op === "add_time" ? (
            <>
              <strong>{what}</strong>: {when}
            </>
          ) : (
            <strong>{type}</strong>
          )}
        </span>
      </p>
      {o.op === "add_time" && <blockquote className="operation-quote">{o.quote}</blockquote>}
      {!applies && (
        <p className="blocked">No longer applies: this sentence is not in the entry any more.</p>
      )}
      {editing && (
        <p className="operation-edit">
          {o.op === "add_time" ? (
            <>
              <input
                aria-label="What happened"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
              />
              <input aria-label="When" value={when} onChange={(e) => setWhen(e.target.value)} />
            </>
          ) : (
            <input aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} />
          )}
        </p>
      )}
      <p className="change-actions">
        {applies ? (
          <>
            <ActionButton
              type="button"
              className="primary"
              disabled={busy || (o.op === "add_time" ? !what.trim() || !when.trim() : !type.trim())}
              onClick={() =>
                decide(
                  o.op === "add_time"
                    ? { decision: "accept", what: what.trim(), when: when.trim() }
                    : { decision: "accept", type: type.trim() },
                )
              }
            >
              Accept
            </ActionButton>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Done editing" : "Edit"}
            </button>
            <ActionButton
              type="button"
              className="plain danger"
              disabled={busy}
              onClick={() => decide({ decision: "reject" })}
            >
              Reject
            </ActionButton>
          </>
        ) : (
          <ActionButton
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => decide({ decision: "dismiss" })}
          >
            Dismiss
          </ActionButton>
        )}
      </p>
    </li>
  );
}

export function InboxPage() {
  const dialogs = useDialogs();
  const [branches, setBranches] = useState<InboxBranch[] | null>(null);
  const [proposals, setProposals] = useState<InboxProposal[]>([]);
  const [quarantine, setQuarantine] = useState<InboxQuarantined[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useRefresh();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const inbox = await api.inbox();
      setProposals(inbox.proposals);
      setQuarantine(inbox.quarantine);
      setBranches(inbox.branches);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiFailure ? err.message : "Could not load the inbox.",
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function act(
    run: () => Promise<{ branchRemoved?: boolean; draftId?: string }>,
    then?: string,
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await run();
      if (result.branchRemoved) {
        setNotice({
          kind: "ok",
          text: "Every file is decided. The branch was removed from GitHub.",
        });
      }
      refresh();
      if (then && result.draftId) {
        navigate(then);
        return;
      }
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiFailure ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
    await load();
  }

  if (!branches) {
    return notice ? (
      <div className="center">
        <Problem
          reason={notice.text}
          onRetry={() => {
            setNotice(null);
            void load();
          }}
        />
      </div>
    ) : (
      <p className="center muted">Loading…</p>
    );
  }

  return (
    <article className="entry wide inbox">
      {loading && <Progress />}
      <header className="entry-head">
        <h1>Inbox</h1>
        <p className="muted lede">
          What agents and Frontier's own AI propose waits here. Accepting something makes it an
          unpublished change of yours; nothing reaches the vault until you publish.
        </p>
      </header>
      {notice && (
        <p className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`} role="status">
          {notice.text}{" "}
          {notice.kind === "ok" && <Link to="/unpublished">See unpublished changes</Link>}
        </p>
      )}
      {branches.length === 0 && proposals.length === 0 && quarantine.length === 0 && (
        <p className="empty">Nothing is waiting for you.</p>
      )}

      {quarantine.length > 0 && (
        <section className="proposal">
          <h2>Arrived unreviewed</h2>
          <p className="muted">
            These notes were pushed straight to the vault by someone other than you. They stay out
            of the memory bank until you accept or revert them; your decision goes out with your
            next publish.
          </p>
          <ul className="changes">
            {quarantine.map((q) => (
              <li key={q.path + q.commit} className={q.pending ? "decided" : ""}>
                <p className="change-head">
                  <span className={`tag tag-${TAG[q.kind]}`}>{KIND[q.kind]}</span>
                  <span className="change-path">
                    <Link to={entryUrl(q.path)}>{q.path}</Link>
                  </span>
                </p>
                <p className="muted">Pushed by {q.pushedBy}.</p>
                <details>
                  <summary>Show changes</summary>
                  <Diff before={q.before ?? ""} after={q.after ?? ""} />
                </details>
                {q.pending ? (
                  <p className="muted">
                    {q.pending.decision === "accepted" ? "Accepted" : "Reverted"}, waiting for your
                    next publish. <Link to="/unpublished">Review and publish</Link>
                  </p>
                ) : (
                  <>
                    {q.revertBlocked && (
                      <p className="blocked">Can only be accepted: {q.revertBlocked}</p>
                    )}
                    <p className="change-actions">
                      <ActionButton
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => act(() => api.decideQuarantine(q.path, q.commit, "accept"))}
                      >
                        Accept
                      </ActionButton>
                      {!q.revertBlocked && (
                        <ActionButton
                          type="button"
                          className="plain danger"
                          disabled={busy}
                          onClick={() =>
                            act(() => api.decideQuarantine(q.path, q.commit, "revert"))
                          }
                        >
                          Revert
                        </ActionButton>
                      )}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposals.map((p) => (
        <section key={p.id} className="proposal">
          <h2>
            <Link to={entryUrl(p.path)}>{p.path.split("/").pop()!.replace(/\.md$/i, "")}</Link>
          </h2>
          <p className="muted">Fields proposed by the AI from this entry's published text.</p>
          <ul className="changes">
            {p.operations.map(({ operation: o, applies }) => (
              <Operation
                key={o.id}
                operation={o}
                applies={applies}
                busy={busy}
                decide={(body) => act(() => api.decideOperation(p.id, o.id, body))}
              />
            ))}
          </ul>
        </section>
      ))}

      {branches.map((b) => {
        const undecided = b.files.filter((f) => !f.decision).length;
        return (
          <section key={b.name} className="proposal">
            <h2>
              <span className="proposal-from">{b.name.replace(/^proposal\//, "")}</span>
            </h2>
            {b.commits.length > 0 && (
              <ul className="proposal-commits">
                {b.commits.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {WHOLE[b.state] && <p className="muted">{WHOLE[b.state]}</p>}

            <ul className="changes">
              {b.files.map((f) => (
                <li key={f.path} className={f.decision ? "decided" : ""}>
                  <p className="change-head">
                    <span className={`tag tag-${TAG[f.kind]}`}>{KIND[f.kind]}</span>
                    <span className="change-path">{f.path}</span>
                  </p>
                  {f.binary ? (
                    f.kind === "added" &&
                    !f.blocked?.startsWith("Frontier takes") && (
                      <img
                        className="change-image"
                        src={branchImageUrl(b.name, f.path)}
                        alt={f.path}
                      />
                    )
                  ) : (
                    <FileChanges branch={b.name} file={f} />
                  )}
                  {f.blocked && <p className="blocked">Can only be rejected: {f.blocked}</p>}
                  {f.decision ? (
                    <p className="muted">{f.decision === "accepted" ? "Accepted" : "Rejected"}</p>
                  ) : (
                    <p className="change-actions">
                      {!f.blocked && (
                        <ActionButton
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            act(() => api.decideFile(b.name, f.path, f.blob, "accept"))
                          }
                        >
                          Accept
                        </ActionButton>
                      )}
                      {!f.blocked && !f.binary && f.kind !== "removed" && (
                        <ActionButton
                          type="button"
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => api.decideFile(b.name, f.path, f.blob, "accept"),
                              editUrl(f.path),
                            )
                          }
                        >
                          Accept and edit
                        </ActionButton>
                      )}
                      <ActionButton
                        type="button"
                        className="plain danger"
                        disabled={busy}
                        onClick={() => act(() => api.decideFile(b.name, f.path, f.blob, "reject"))}
                      >
                        Reject
                      </ActionButton>
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {undecided === 1 && (
              <p className="muted">
                Deciding the last file removes this branch from GitHub. A rejected file is then
                gone.
              </p>
            )}
            <p className="change-actions">
              {b.state === "open" || b.state === "no_fork" || b.state === "too_many" ? (
                <ActionButton
                  type="button"
                  className="plain danger"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await dialogs.confirm({
                      title: "Reject everything left?",
                      body: `Every undecided file on "${b.name}" is rejected and the branch is removed.`,
                      action: "Reject all",
                      danger: true,
                    });
                    if (ok) void act(() => api.decideBranch(b.name, b.tip, "reject"));
                  }}
                >
                  Reject all that is left
                </ActionButton>
              ) : (
                <ActionButton
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => act(() => api.decideBranch(b.name, b.tip, "remove"))}
                >
                  Remove the branch
                </ActionButton>
              )}
            </p>
          </section>
        );
      })}
    </article>
  );
}
