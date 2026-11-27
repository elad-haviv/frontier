import { ActionButton } from "../components/ui/ActionButton.tsx";
import type { PublishPlan } from "@frontier/schema";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Link, useLocation, useNavigate } from "../nav.tsx";
import { ApiFailure } from "../api.ts";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { Diff } from "../components/Diff.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { useWords } from "../components/Shell.tsx";
import {
  type Choice,
  type Clash,
  clashOfCompare,
  clashOfConflict,
  changedElsewhereText,
  clockText,
  reasonOf,
  savedAgainText,
  startOfMerged,
  textFor,
  theirsTitle,
  whoText,
} from "../people/compare.ts";
import { projectWork } from "../projectWork.ts";
import "./Compare.css";

type Conflict = PublishPlan["conflicts"][number];

/** What the screen was opened with: from the review, the clash and the line typed there. */
interface Given {
  conflict?: Conflict;
  message?: string;
}

/** One of the two texts, read only, in a box that scrolls and can be reached by keyboard. */
function TextPane({ title, label, text }: { title: string; label: string; text: string }) {
  return (
    <section className="compare-pane">
      <h2>{title}</h2>
      <pre className="compare-text" tabIndex={0} aria-label={label}>
        {text === "" ? "(empty)" : text}
      </pre>
    </section>
  );
}

/**
 * Two texts of one entry for the person to settle (stage 27d, decision C).
 *
 * When someone else saved a newer version first (`saved_by_other`) it is the compare screen: their
 * text with who and when, the person's own text, and three choices, Keep mine, Keep theirs and the
 * merged text (made for them when the two changes do not touch, and always theirs to edit). Any
 * other clash (the same lines changed, a file deleted meanwhile) keeps the editor it always had.
 *
 * Whatever is chosen is sent with the version that was compared. If someone saved again while the
 * person was deciding, the server says so, nothing is changed, and the screen compares again with
 * the new version, keeping the text the person had.
 */
export function ConflictPage() {
  const dialogs = useDialogs();
  const words = useWords();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const given = useLocation().state as Given | null;
  const [clash, setClash] = useState<Clash | null>(
    given?.conflict ? clashOfConflict(given.conflict) : null,
  );
  /** What the page shows when there is no clash: loading, the answer "nothing differs", or gone. */
  const [state, setState] = useState<"loading" | "ready" | "none" | "clear" | "gone" | "failed">(
    given?.conflict ? "ready" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  /** Said when the person had to compare again. */
  const [again, setAgain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Whether the server has answered: until then the clash is only what the review sent. */
  const [checked, setChecked] = useState(false);
  /**
   * The person typed into the merged text, and the clash went away (nothing differs, or it can be
   * saved as it is): their text is kept on screen to be saved as their unsaved change.
   */
  const [settled, setSettled] = useState<{
    outcome: "none" | "ready";
    theirsBlob: string | null | undefined;
    revision: number | undefined;
  } | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  /** The text of the "merged" choice, and the editor of the older screen: the person's to edit. */
  const text = useRef(clash ? startOfMerged(clash) : "");
  const edited = useRef(false);
  const [seed, setSeed] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);

  // Always asks the server what the clash is now: what the review sent may be old (the person
  // can have kept writing in another tab or on another device), so it is only a placeholder.
  useEffect(() => {
    let live = true;
    const work = projectWork();
    (async () => {
      try {
        const answer = await work.api.compare(id);
        if (!live) return;
        const found = clashOfCompare(answer, given?.conflict?.mine ?? "");
        setChecked(true);
        if (!found) {
          setClash(null);
          return setState(answer.outcome === "ready" ? "clear" : "none");
        }
        if (!edited.current) {
          text.current = startOfMerged(found);
          setSeed((n) => n + 1);
        }
        setClash(found);
        setState("ready");
      } catch (err) {
        if (!live) return;
        const gone = err instanceof ApiFailure && err.status === 404;
        if (gone) {
          setClash(null);
          setState("gone");
        } else if (!clash) setState("failed");
        if (!gone) setError(err instanceof ApiFailure ? err.message : "Could not open this.");
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  // Text typed into the merged editor is the person's: leaving the screen asks first.
  const askLeave = useRef<() => Promise<boolean>>(async () => true);
  askLeave.current = () =>
    dialogs.confirm({
      title: "Leave without saving?",
      body: "You changed the text on this screen. It is not saved anywhere yet.",
      action: "Leave",
      danger: true,
    });
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!edited.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!edited.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      void askLeave.current().then((ok) => {
        if (!ok) return;
        edited.current = false;
        a.click();
      });
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // The screen takes the focus when it opens, and again when it has to compare again.
  useEffect(() => {
    if (clash) heading.current?.focus();
  }, [clash === null]);
  useEffect(() => {
    if (again) notice.current?.focus();
  }, [again]);

  if (!clash) {
    return (
      <div className="center">
        {state === "loading" && <p className="muted">Opening…</p>}
        {state === "none" && (
          <p className="muted">
            Nothing differs from the saved version any more, so there is nothing to compare.
          </p>
        )}
        {state === "clear" && (
          <p className="muted">
            This change does not clash with anything any more: it can be saved as it is.
          </p>
        )}
        {state === "gone" && (
          <p className="muted">
            This change is not here any more. It may have been saved or discarded on another device.
          </p>
        )}
        {state === "failed" && <p className="error">{error}</p>}
        {state !== "loading" && <Link to="/unpublished">{words.title}</Link>}
      </div>
    );
  }

  const compare = clash.reason === "saved_by_other" || clash.reason === "merge";
  const who = whoText(clash);

  /** Where the person goes after settling: back to the review, which carries on with the save. */
  function carryOn(note?: string) {
    navigate("/unpublished", {
      state: compare
        ? { replan: true, message: given?.message ?? "", ...(note ? { note } : {}) }
        : undefined,
    });
  }

  /** The saved version or the person's change moved on while they compared: show the newest. */
  async function compareAgain(work = projectWork(), why: "saved" | "revision" = "saved") {
    const answer = await work.api.compare(id);
    const found = clashOfCompare(answer, clash!.mine);
    if (!found) {
      // What the person typed is theirs: it stays, to be saved as their unsaved change.
      if (edited.current && answer.outcome !== "conflict" && answer.outcome !== "merge") {
        setSettled({
          outcome: answer.outcome === "ready" ? "ready" : "none",
          theirsBlob: answer.theirsBlob,
          revision: answer.revision,
        });
        return;
      }
      setClash(null);
      setState(answer.outcome === "ready" ? "clear" : "none");
      return;
    }
    setAgain(why === "revision" ? changedElsewhereText : savedAgainText(found.theirsName));
    setChoice(null);
    // The text the person has is theirs: only an untouched merge is replaced by the new one.
    if (!edited.current) {
      text.current = startOfMerged(found);
      setSeed((n) => n + 1);
    }
    setClash(found);
  }

  async function settle(chosen: string, note?: string) {
    setBusy(true);
    setError(null);
    const work = projectWork();
    try {
      await work.api.resolve(id, chosen, clash!.theirsBlob, clash!.revision);
      edited.current = false;
      carryOn(note);
    } catch (err) {
      setBusy(false);
      if (
        err instanceof ApiFailure &&
        (err.code === "saved_by_other" || err.code === "stale_revision")
      ) {
        await compareAgain(work, err.code === "stale_revision" ? "revision" : "saved").catch(
          (again: unknown) =>
            setError(again instanceof ApiFailure ? again.message : "Could not compare again."),
        );
      } else if (err instanceof ApiFailure && err.status === 404) {
        setClash(null);
        setState("gone");
      } else {
        setError(err instanceof ApiFailure ? err.message : "Could not save.");
      }
    }
  }

  async function choose() {
    if (!choice) return;
    if (choice === "theirs") {
      const ok = await dialogs.confirm({
        title: `Keep ${who}'s version?`,
        body: "What you wrote in this entry is thrown away. Their version stays as it is.",
        action: "Keep theirs",
        danger: true,
      });
      if (!ok) return;
    }
    const note =
      choice === "theirs" ? `Kept ${who}'s version of ${nameOfPath(clash!.path)}.` : undefined;
    await settle(textFor(choice, clash!, text.current), note);
  }

  async function discard() {
    const work = projectWork();
    const ok = await dialogs.confirm({
      title: "Discard your version?",
      body: "What is in the vault stays as it is.",
      action: "Discard",
      danger: true,
    });
    if (!ok) return;
    await work.api.discardDraft(id).catch(() => undefined);
    edited.current = false;
    if (work.open()) navigate("/unpublished");
  }

  const name = nameOfPath(clash.path);

  /** Saves the text typed here as the person's unsaved change, once the clash is gone. */
  async function saveAsMine() {
    if (!settled) return;
    setBusy(true);
    setError(null);
    const work = projectWork();
    try {
      await work.api.resolve(id, text.current, settled.theirsBlob, settled.revision);
      edited.current = false;
      if (work.open()) navigate("/unpublished");
    } catch (err) {
      setBusy(false);
      if (
        err instanceof ApiFailure &&
        (err.code === "saved_by_other" || err.code === "stale_revision")
      ) {
        setSettled(null);
        await compareAgain(work, err.code === "stale_revision" ? "revision" : "saved").catch(
          (again: unknown) =>
            setError(again instanceof ApiFailure ? again.message : "Could not compare again."),
        );
      } else setError(err instanceof ApiFailure ? err.message : "Could not save.");
    }
  }

  if (settled) {
    return (
      <article className="entry wide compare">
        <header className="entry-head">
          <p className="crumbs">{clash.path}</p>
          <h1 ref={heading} tabIndex={-1}>
            Your text is still here
          </h1>
          <p className="muted lede">
            {settled.outcome === "ready"
              ? "Your change does not clash with the saved version any more, so it can be saved as it is."
              : "Your change and the saved version are the same now."}{" "}
            You had edited the text on this screen. Save it as your unsaved change to keep it.
          </p>
        </header>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <TextPane title="Your text, not saved yet" label="Your edited text" text={text.current} />
        <p className="plan-actions">
          <Link to="/unpublished" className="quiet">
            Not now
          </Link>
          <ActionButton
            type="button"
            className="primary big"
            disabled={busy}
            onClick={() => void saveAsMine()}
          >
            {busy ? "Saving…" : "Save my text as my unsaved change"}
          </ActionButton>
        </p>
      </article>
    );
  }

  if (compare) {
    const merged = clash.mergedText !== undefined;
    return (
      <article className="entry wide compare">
        <header className="entry-head">
          <p className="crumbs">{clash.path}</p>
          <h1 ref={heading} tabIndex={-1}>
            Compare two versions of {name}
          </h1>
          <p className="muted lede">
            {who} saved a newer version of this entry
            {clash.theirsAt ? ` at ${clockText(clash.theirsAt)}` : ""}, after you started your
            changes. Nothing is kept until you choose.
          </p>
        </header>
        {again && (
          <p className="banner" role="alert" tabIndex={-1} ref={notice}>
            {again}
          </p>
        )}
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}

        <div className="compare-panes">
          <TextPane
            title={theirsTitle(clash)}
            label={`${who}'s version, saved`}
            text={clash.theirs ?? ""}
          />
          <TextPane
            title="Mine, not saved yet"
            label="Your version, not saved yet"
            text={clash.mine}
          />
        </div>
        {clash.theirs !== null && (
          <details className="compare-diff">
            <summary>Show what is different</summary>
            <Diff before={clash.theirs} after={clash.mine} />
          </details>
        )}

        <fieldset className="compare-choices" disabled={busy || !checked}>
          <legend>What do you want to keep?</legend>
          <label className="compare-choice">
            <input
              type="radio"
              name="keep"
              checked={choice === "mine"}
              onChange={() => setChoice("mine")}
            />
            <span>
              <strong>Keep mine</strong>
              <small>
                Your text becomes the entry. {who}&rsquo;s version stays in the history.
              </small>
            </span>
          </label>
          <label className="compare-choice">
            <input
              type="radio"
              name="keep"
              checked={choice === "theirs"}
              onChange={() => setChoice("theirs")}
            />
            <span>
              <strong>Keep theirs</strong>
              <small>
                {who}&rsquo;s version stays as it is. What you wrote here is thrown away.
              </small>
            </span>
          </label>
          <label className="compare-choice">
            <input
              type="radio"
              name="keep"
              checked={choice === "merged"}
              onChange={() => setChoice("merged")}
            />
            <span>
              <strong>{merged ? "Use the merged text" : "Combine them by hand"}</strong>
              <small>
                {merged
                  ? "Frontier put both changes together. Read it and change anything you like."
                  : `The two changes touch the same lines, so they are not combined. This starts from your text; take what you need from ${who}'s.`}
              </small>
            </span>
          </label>
        </fieldset>
        {choice === "merged" && (
          <div className="boxed compare-merged">
            <CodeEditor
              key={seed}
              initial={text.current}
              onChange={(t) => {
                edited.current = true;
                text.current = t;
              }}
            />
          </div>
        )}
        <p className="plan-actions">
          <Link to="/unpublished" className="quiet">
            Not now
          </Link>
          <ActionButton
            type="button"
            className="primary big"
            disabled={busy || !checked || choice === null}
            onClick={() => void choose()}
          >
            {busy ? "Saving…" : "Use this choice"}
          </ActionButton>
        </p>
      </article>
    );
  }

  return (
    <article className="entry wide">
      <header className="entry-head">
        <p className="crumbs">{clash.path}</p>
        <h1 ref={heading} tabIndex={-1}>
          Resolve
        </h1>
        <p className="muted lede">
          {reasonOf({
            reason: clash.reason,
            theirsBy: clash.theirsName ? { name: clash.theirsName } : null,
            theirsAt: clash.theirsAt,
          }) ?? ""}{" "}
          Edit your version below until it is the text you want, taking what you need from the
          vault's version. Saving does not publish; it marks your text as building on the vault's.
        </p>
      </header>
      {again && (
        <p className="banner" role="alert" tabIndex={-1} ref={notice}>
          {again}
        </p>
      )}
      {error && <p className="banner">{error}</p>}

      <h3>In the vault now, compared with your version</h3>
      {clash.theirs === null ? (
        <p className="muted">The file no longer exists in the vault. Saving will add it back.</p>
      ) : (
        <Diff before={clash.mine} after={clash.theirs} />
      )}

      <h3>Your version</h3>
      <div className="boxed">
        <CodeEditor
          key={seed}
          initial={text.current}
          onChange={(t) => {
            edited.current = true;
            text.current = t;
          }}
        />
      </div>

      <p className="plan-actions">
        <ActionButton type="button" className="quiet" onClick={discard}>
          Discard mine
        </ActionButton>
        {clash.theirs !== null && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              text.current = clash.theirs!;
              edited.current = true;
              setSeed(seed + 1);
            }}
          >
            Start from the vault's
          </button>
        )}
        <ActionButton
          type="button"
          className="primary big"
          disabled={busy || !checked}
          onClick={() => void settle(text.current)}
        >
          {busy ? "Saving…" : "Save as resolved"}
        </ActionButton>
      </p>
    </article>
  );
}

const nameOfPath = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
