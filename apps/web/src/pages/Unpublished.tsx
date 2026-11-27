import type { AfterPublishStep, PublishPlan, UnpublishedResponse } from "@frontier/schema";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "../nav.tsx";
import { chronicleIdOf, type LibraryFileName, libraryFileOf, mapIdOf } from "@frontier/schema";
import { libraryFileClient } from "../sync/libraryFile.ts";
import { api, ApiFailure, chronicleUrl, editUrl, entryUrl, imageUrl, mapUrl } from "../api.ts";
import { proposeAfterPublish } from "../proposeAfterPublish.ts";
import { Diff } from "../components/Diff.tsx";
import { useRefresh, useWords } from "../components/Shell.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { AfterPublish } from "../components/AfterPublish.tsx";
import { recentsOf } from "../keepGoing/recents.ts";
import { projectWork, type ProjectWork } from "../projectWork.ts";
import { loadPins } from "../keepGoing/pins.ts";
import { followPublish, publishedEntries } from "../keepGoing/strip.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { libraryReason, partialSaveText, reasonOf, savedItems } from "../people/compare.ts";

const KIND = { edit: "Edited", create: "New", delete: "Deleted" } as const;

/** How long Publish waits for the next steps before it is quiet about them, in milliseconds. */
const STEPS_WAIT_MS = 2500;

/**
 * The next steps after a publish, from what it wrote. None when there are none, or when they are
 * slow or cannot be had: Publish is not made to wait for them.
 */
async function nextSteps(work: ProjectWork, paths: string[]): Promise<AfterPublishStep[]> {
  if (paths.length === 0) return [];
  let timer: number | undefined;
  try {
    const slow = new Promise<never>((_, no) => {
      timer = window.setTimeout(() => no(new Error("slow")), STEPS_WAIT_MS);
    });
    return (await Promise.race([work.api.afterPublish(paths), slow])).steps;
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

export function UnpublishedPage() {
  const dialogs = useDialogs();
  const words = useWords();
  const refresh = useRefresh();
  const [data, setData] = useState<UnpublishedResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  /** The next steps after the last Publish, with the one it was; a new one each time. */
  const [nudge, setNudge] = useState<{ n: number; steps: AfterPublishStep[] } | null>(null);
  /**
   * A save that went in for some entries and left others to compare, because someone else saved a
   * newer version of them first (stage 27d): which went in, and which wait.
   */
  const [partial, setPartial] = useState<{
    saved: string[];
    waiting: PublishPlan["conflicts"];
  } | null>(null);
  /** From the compare screen: carry on with the save, with the line already typed. */
  const arrived = useLocation().state as {
    replan?: boolean;
    message?: string;
    note?: string;
  } | null;
  const replanned = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const u = await api.unpublished();
      setData(u);
      setSelected(new Set([...u.drafts.map((d) => d.id), ...u.renames.map((r) => r.id)]));
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiFailure ? err.message : "Could not load.",
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const fail = (err: unknown) =>
    setNotice({
      kind: "error",
      text: err instanceof ApiFailure ? err.message : "Something went wrong.",
    });

  async function review(told?: string) {
    if (!data) return;
    setBusy(true);
    setPartial(null);
    setNotice(told ? { kind: "error", text: told } : null);
    const work = projectWork();
    try {
      const p = await work.api.plan(
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

  // Back from the compare screen with a choice made: the save carries on at the review, with
  // the line the person had typed, instead of starting over.
  useEffect(() => {
    if (!arrived?.replan || replanned.current || !data) return;
    replanned.current = true;
    if (arrived.message) setMessage(arrived.message);
    if (data.drafts.length > 0 || data.renames.length > 0) {
      void review();
      if (arrived.note) setNotice({ kind: "ok", text: arrived.note });
    } else if (arrived.note) setNotice({ kind: "ok", text: arrived.note });
  }, [data]);

  async function publish() {
    if (!plan) return;
    setBusy(true);
    setNotice(null);
    // Everything after the server's answer belongs to the project that was published, which may
    // not be the one open by then.
    const work = projectWork();
    try {
      // What this publish writes, found before the lists are read again.
      const deleted = plan.ready.flatMap((id) => {
        const d = data?.drafts.find((x) => x.id === id);
        return d?.kind === "delete" ? [d.path] : [];
      });
      const written = publishedEntries([
        ...plan.ready.map(pathOf),
        ...plan.merges.filter((m) => confirmed.has(m.id)).map((m) => m.path),
        ...plan.renames.map((r) => r.to),
      ]).filter((p) => !deleted.includes(p));
      const { commit, published, conflicts } = await work.api.confirm(
        plan.planId,
        [...confirmed],
        message.trim(),
      );
      // Entries someone else saved a newer version of since the plan are not in this version:
      // they wait for the person to compare, and the rest went in.
      const left = conflicts.map((c) => c.path);
      // The entries read lately follow what was moved and forget what was deleted.
      followPublish(work.ref, {
        renames: conflicts.length > 0 ? [] : plan.renames,
        deleted: deleted.filter((p) => !left.includes(p)),
      });
      // Renames and deletions rewrite the pins on the server.
      if (work.open()) void loadPins(true);
      // The server has no AI key of its own: this browser asks for the field proposals, with its.
      void proposeAfterPublish(work.ref, published).then(
        (made) => made > 0 && work.open() && refresh(),
      );
      setPlan(null);
      setMessage("");
      const steps = await nextSteps(
        work,
        written.filter((p) => !left.includes(p)),
      );
      // The notice is always set; while the nudge shows it stands in for the notice, and when the
      // nudge goes the notice is what is left.
      setNotice({
        kind: "ok",
        text: words.own ? "Saved as a new version." : `Published as commit ${commit.slice(0, 10)}.`,
      });
      setPartial(
        conflicts.length > 0
          ? {
              saved: savedItems(
                [
                  ...plan.ready.map(pathOf),
                  ...plan.merges.filter((m) => confirmed.has(m.id)).map((m) => m.path),
                  ...plan.renames.map((r) => r.to),
                  ...plan.decisions.map((d) => d.path),
                ],
                left,
              ),
              waiting: conflicts,
            }
          : null,
      );
      setNudge(steps.length > 0 ? (n) => ({ n: (n?.n ?? 0) + 1, steps }) : null);
      await load();
      refresh();
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === "main_moved" || err.code === "plan_expired")) {
        setPlan(null);
        setNotice({ kind: "error", text: `${err.message} Nothing was published.` });
      } else if (err instanceof ApiFailure && err.code === "saved_by_other") {
        // Everything in this save was refused because someone saved newer versions first: the
        // plan is spent, so a new one is made and shows what to compare.
        setPlan(null);
        await review(`${err.message} Nothing was saved yet.`);
      } else fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function discard(id: string) {
    // The project the draft is in, taken before the question is asked.
    const work = projectWork();
    const ok = await dialogs.confirm({
      title: "Discard this draft?",
      body: "The text you wrote is thrown away.",
      action: "Discard",
      danger: true,
    });
    if (!ok) return;
    // A library file's change still on this device would bring the draft back: it goes first.
    const library = libraryFileOf(data?.drafts.find((d) => d.id === id)?.path ?? "");
    if (library) await work.queue.drop(library.name);
    // A draft the server no longer has was saved or discarded elsewhere: it is gone from the list.
    await work.api.discardDraft(id).catch((err: unknown) => {
      if (err instanceof ApiFailure && err.status === 404) {
        setNotice({
          kind: "ok",
          text: "That change was not here any more, so it is gone from the list.",
        });
      } else fail(err);
    });
    // A new entry that is thrown away was never there.
    const thrown = data?.drafts.find((d) => d.id === id);
    if (thrown?.kind === "create") recentsOf(work.ref).forget(thrown.path);
    if (library) await libraryFileClient(library).reload();
    setPlan(null);
    await load();
    refresh();
  }

  async function cancelRename(id: string) {
    await projectWork()
      .api.cancelRename(id)
      .catch((err: unknown) => {
        if (err instanceof ApiFailure && err.status === 404) {
          setNotice({ kind: "ok", text: "That rename was not here any more." });
        } else fail(err);
      });
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

  async function settleMap(path: string, keep: "mine" | "theirs") {
    const id = mapIdOf(path);
    const chronicle = chronicleIdOf(path);
    const library = libraryFileOf(path);
    const work = projectWork();
    if (id) await work.api.resolveMap(id, keep).catch(fail);
    else if (chronicle) await work.api.resolveChronicle(chronicle, keep).catch(fail);
    else if (library) {
      await work.api.resolveLibraryFile(library.name as LibraryFileName, keep).catch(fail);
      await libraryFileClient(library).reload();
    } else return;
    setPlan(null);
    await load();
    refresh();
  }

  /** One clash with its reason and what to do about it: the review's list and the partial-save banner. */
  const clashItem = (c: PublishPlan["conflicts"][number], line: string) => {
    const library = libraryFileOf(c.path);
    return (
      <li key={c.draftId}>
        <p className="change-path">{library?.label ?? c.path}</p>
        <p className="error">
          {library && c.reason === library.conflict
            ? (reasonOf(c) ?? libraryReason(library.noun))
            : reasonOf(c)}{" "}
          {c.reason === "rename_blocked" && c.mine}
        </p>
        {library && c.reason === library.conflict && (
          <span className="change-actions">
            <ActionButton type="button" className="quiet" onClick={() => settleMap(c.path, "mine")}>
              Keep my {library.noun}
            </ActionButton>
            <ActionButton
              type="button"
              className="quiet"
              onClick={() => settleMap(c.path, "theirs")}
            >
              Take the vault's
            </ActionButton>
          </span>
        )}
        {(c.reason === "map_changed_on_both" || c.reason === "chronicle_changed_on_both") && (
          <span className="change-actions">
            <ActionButton type="button" className="quiet" onClick={() => settleMap(c.path, "mine")}>
              {c.reason === "map_changed_on_both" ? "Keep my map" : "Keep my chronicle"}
            </ActionButton>
            <ActionButton
              type="button"
              className="quiet"
              onClick={() => settleMap(c.path, "theirs")}
            >
              Take the vault's
            </ActionButton>
          </span>
        )}
        {c.reason !== "rename_blocked" &&
          c.reason !== "map_changed_on_both" &&
          c.reason !== "chronicle_changed_on_both" &&
          !(library && c.reason === library.conflict) && (
            <Link to={`/conflict/${c.draftId}`} state={{ conflict: c, message: line }}>
              {c.reason === "saved_by_other" ? "Compare" : "Resolve"}
            </Link>
          )}
      </li>
    );
  };

  if (!data) {
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
  const empty =
    data.drafts.length === 0 && data.renames.length === 0 && data.decisions.length === 0;
  const chosen = selected.size + data.decisions.length;
  const publishable = plan
    ? plan.ready.length + confirmed.size + plan.renames.length + plan.decisions.length
    : 0;
  const pathOf = (id: string) => data.drafts.find((d) => d.id === id)?.path ?? id;

  const noticeLine = notice && (
    <p className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`} role="status">
      {notice.text}
    </p>
  );

  return (
    <article className="entry wide">
      {loading && <Progress />}
      <header className="entry-head">
        <h1>{words.title}</h1>
        <p className="muted lede">
          {words.own
            ? "Drafts are kept as you type. Saving a version records them in the library's history, with a line saying what changed. Only you see these: everyone in the project has their own."
            : "Drafts are saved on the server and are not part of the vault until you publish. Publishing makes one commit. Only you see these: everyone in the project has their own."}
        </p>
      </header>

      {nudge ? (
        <AfterPublish
          key={nudge.n}
          steps={nudge.steps}
          verb={words.own ? "Saved" : "Published"}
          fallback={noticeLine}
        />
      ) : (
        noticeLine
      )}
      {partial && (
        <section className="banner" role="status" aria-label="Entries to compare">
          <p>{partialSaveText(partial.saved, partial.waiting, words.own)}</p>
          <ul className="changes">{partial.waiting.map((c) => clashItem(c, ""))}</ul>
        </section>
      )}
      {empty && (
        <p className="muted">
          Nothing is waiting. Everything you wrote is {words.own ? "saved" : "published"}.
        </p>
      )}

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
                  <span className="change-path">{libraryFileOf(d.path)?.label ?? d.path}</span>
                </label>
                {d.origins.some((o) => o.kind === "lore") && (
                  <p className="muted">
                    Holds an addition the AI drafted in a lore conversation. Read it before saving.
                  </p>
                )}
                {d.binary ? (
                  <img className="change-image" src={imageUrl(d.path, 320)} alt={d.path} />
                ) : (
                  <details>
                    <summary>Show changes</summary>
                    <Diff before={d.mainText ?? ""} after={d.kind === "delete" ? "" : d.text} />
                  </details>
                )}
                <p className="change-actions">
                  {d.kind !== "delete" &&
                    !d.binary &&
                    !mapIdOf(d.path) &&
                    !chronicleIdOf(d.path) &&
                    !libraryFileOf(d.path) && <Link to={editUrl(d.path)}>Keep editing</Link>}
                  {d.kind !== "delete" && mapIdOf(d.path) && (
                    <Link to={mapUrl(mapIdOf(d.path)!) + "?edit=1"}>Open the map</Link>
                  )}
                  {d.kind !== "delete" && chronicleIdOf(d.path) && (
                    <Link to={chronicleUrl(chronicleIdOf(d.path)!)}>Open the chronicle</Link>
                  )}
                  <ActionButton
                    type="button"
                    className="plain danger"
                    onClick={() => discard(d.id)}
                  >
                    Discard
                  </ActionButton>
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
                  <ActionButton
                    type="button"
                    className="plain danger"
                    onClick={() => cancelRename(r.id)}
                  >
                    Cancel rename
                  </ActionButton>
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
                  <ActionButton
                    type="button"
                    className="plain danger"
                    onClick={async () => {
                      await api.withdrawDecision(d.id).catch(fail);
                      setPlan(null);
                      await load();
                      refresh();
                    }}
                  >
                    Withdraw
                  </ActionButton>
                </p>
              </li>
            ))}
          </ul>
          <ActionButton
            type="button"
            className="primary big"
            disabled={busy || chosen === 0}
            onClick={() => void review()}
          >
            {busy ? "Checking the vault…" : `Review ${chosen} change${chosen === 1 ? "" : "s"}`}
          </ActionButton>
        </>
      )}

      {plan && (
        <section className="plan">
          <h2>{words.own ? "What will be saved" : "Review before publishing"}</h2>

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
              <ul className="changes">{plan.conflicts.map((c) => clashItem(c, message))}</ul>
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
            <ActionButton
              type="button"
              className="primary big"
              disabled={busy || publishable === 0 || message.trim() === ""}
              onClick={publish}
            >
              {busy ? words.acting : words.act}
            </ActionButton>
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
