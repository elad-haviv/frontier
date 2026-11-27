import { ActionButton } from "../components/ui/ActionButton.tsx";
import "../components/trees/ProposedRelation.css";
import type { BranchFile, InboxBranch, InboxProposal, InboxQuarantined } from "@frontier/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiFailure, branchImageUrl, editUrl, entryUrl } from "../api.ts";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import {
  isClear,
  ProposedRelation,
  type RelProposal,
  useAcceptClear,
} from "../components/trees/ProposedRelation.tsx";
import { useScope, useShortcut } from "../keys.ts";
import { useRelations, useTrees } from "../trees/data.ts";
import { layoutTree } from "../trees/model.ts";

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
    <li data-op={o.id}>
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

type RelationOp = Extract<Op, { op: "add_relation" }>;

/** An inbox relation in the shape every proposal view shares. */
function asRel(
  p: InboxProposal,
  o: RelationOp,
  applies: boolean,
  warning: string | null | undefined,
): RelProposal {
  return {
    proposal: p.id,
    op: o.id,
    path: p.path,
    word: o.what,
    who: o.who,
    whoPath: o.whoPath,
    match: o.match,
    maybe: o.maybe,
    with: o.with,
    how: o.how,
    when: o.when,
    quote: o.quote,
    words: o.words,
    stated: o.stated,
    also: o.also ?? [],
    warning: warning ?? null,
    applies,
  };
}

const topFolder = (path: string) => (path.includes("/") ? path.split("/")[0]! : "");

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
  // Stage 31: sorting through many proposals.
  const [kind, setKind] = useState<"all" | "relations" | "fields">("all");
  const [folder, setFolder] = useState("");
  const [treeId, setTreeId] = useState("");
  const [cur, setCur] = useState(0);
  const [startCount, setStartCount] = useState<number | null>(null);
  const trees = useTrees();
  const relations = useRelations();
  const acceptClear = useAcceptClear();
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const inbox = await api.inbox();
      setProposals(inbox.proposals);
      const count = inbox.proposals.reduce((n, p) => n + p.operations.length, 0);
      setStartCount((s) => (s === null || count > s ? count : s));
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

  const treeList = trees.value?.trees ?? [];
  const inTree = useMemo(() => {
    const t = treeList.find((x) => x.id === treeId);
    return t && relations.graph ? new Set(layoutTree(relations.graph, t).nodes.keys()) : null;
  }, [treeId, treeList, relations.graph]);
  const folders = [...new Set(proposals.map((p) => topFolder(p.path)))].sort();
  const pending = proposals.reduce((n, p) => n + p.operations.length, 0);
  const shownProposals = proposals
    .filter((p) => !folder || topFolder(p.path) === folder)
    .filter((p) => !inTree || inTree.has(p.path))
    .map((p) => {
      const ops = p.operations
        .filter((o) =>
          kind === "all"
            ? true
            : kind === "relations"
              ? o.operation.op === "add_relation"
              : o.operation.op !== "add_relation",
        )
        // Dates and types first; then relations, the clear ones first.
        .sort((x, y) => {
          const rank = (o: (typeof p.operations)[number]) =>
            o.operation.op !== "add_relation"
              ? 0
              : isClear(asRel(p, o.operation, o.applies, o.warning))
                ? 1
                : 2;
          return rank(x) - rank(y);
        });
      return { ...p, operations: ops };
    })
    .filter((p) => p.operations.length > 0);
  const order = shownProposals.flatMap((p) => p.operations.map((o) => o.operation.id));
  const curId = order[Math.min(cur, order.length - 1)];
  const relationCount = proposals.reduce(
    (n, p) => n + p.operations.filter((o) => o.operation.op === "add_relation").length,
    0,
  );

  useScope("inbox", pending > 0);
  const press = (act: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-op="${curId}"]`);
    const button =
      el?.querySelector<HTMLButtonElement>(`[data-act="${act}"]`) ??
      [...(el?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) =>
        b.textContent
          ?.toLowerCase()
          .startsWith(act === "accept" ? "accept" : act === "reject" ? "reject" : "edit"),
      );
    if (!button) return false;
    button.click();
  };
  const move = (by: number) => {
    const next = Math.max(0, Math.min(order.length - 1, cur + by));
    setCur(next);
    window.setTimeout(
      () =>
        list.current
          ?.querySelector(`[data-op="${order[next]}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      0,
    );
  };
  useShortcut("inbox.next", () => move(1), pending > 0);
  useShortcut("inbox.previous", () => move(-1), pending > 0);
  useShortcut("inbox.accept", () => press("accept"), pending > 0);
  useShortcut("inbox.reject", () => press("reject"), pending > 0);
  useShortcut("inbox.edit", () => press("edit"), pending > 0);

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

      {pending > 0 && (
        <div className="inbox-head-tools">
          {startCount !== null && startCount > 1 && (
            <p className="inbox-progress">
              <span className="bar">
                <i
                  style={{ width: `${Math.round(((startCount - pending) / startCount) * 100)}%` }}
                />
              </span>
              <span>
                {startCount - pending} of {startCount} decided
              </span>
            </p>
          )}
          <div className="inbox-tools" role="group" aria-label="Show">
            {relationCount > 0 && (
              <>
                <button
                  type="button"
                  className="inbox-chip"
                  aria-pressed={kind === "all"}
                  onClick={() => setKind("all")}
                >
                  All · {pending}
                </button>
                <button
                  type="button"
                  className="inbox-chip"
                  aria-pressed={kind === "relations"}
                  onClick={() => setKind("relations")}
                >
                  Relations · {relationCount}
                </button>
                <button
                  type="button"
                  className="inbox-chip"
                  aria-pressed={kind === "fields"}
                  onClick={() => setKind("fields")}
                >
                  Dates and types · {pending - relationCount}
                </button>
              </>
            )}
            {folders.length > 1 && (
              <select
                aria-label="Folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f || "Top of the library"}
                  </option>
                ))}
              </select>
            )}
            {relationCount > 0 && treeList.length > 0 && (
              <select aria-label="Tree" value={treeId} onChange={(e) => setTreeId(e.target.value)}>
                <option value="">Any tree</option>
                {treeList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="inbox-keys">
            Keys: <kbd>j</kbd> <kbd>k</kbd> move · <kbd>a</kbd> accept · <kbd>r</kbd> reject ·{" "}
            <kbd>e</kbd> edit. In each entry the clearest come first.
          </p>
        </div>
      )}

      <div ref={list}>
        {shownProposals.map((p) => {
          const rels = p.operations
            .filter((o) => o.operation.op === "add_relation")
            .map((o) => asRel(p, o.operation as RelationOp, o.applies, o.warning));
          const clear = rels.filter(isClear);
          return (
            <section key={p.id} className="proposal">
              <div className="proposal-head">
                <h2>
                  <Link to={entryUrl(p.path)}>
                    {p.path.split("/").pop()!.replace(/\.md$/i, "")}
                  </Link>
                </h2>
                <span className="muted">{topFolder(p.path)}</span>
                <span className="spacer" />
                {clear.length > 1 && (
                  <ActionButton
                    type="button"
                    className="quiet"
                    title="Leaves out what is not said directly, has no entry, or has a warning"
                    onClick={async () => {
                      await acceptClear(clear);
                      await load();
                    }}
                  >
                    Accept the {clear.length} clear ones
                    {rels.length > clear.length ? ` of ${rels.length}` : ""}
                  </ActionButton>
                )}
              </div>
              <p className="muted">Proposed by the AI from this entry's published text.</p>
              <ul className="changes">
                {p.operations.map(({ operation: o, applies, warning }) =>
                  o.op === "add_relation" ? (
                    <li key={o.id} data-op={o.id}>
                      <ProposedRelation
                        p={asRel(p, o, applies, warning)}
                        current={o.id === curId}
                        onDecided={() => void load()}
                      />
                    </li>
                  ) : (
                    <Operation
                      key={o.id}
                      operation={o}
                      applies={applies}
                      busy={busy}
                      decide={(body) => act(() => api.decideOperation(p.id, o.id, body))}
                    />
                  ),
                )}
              </ul>
            </section>
          );
        })}
      </div>

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
