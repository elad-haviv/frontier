import type { PictureShape, PictureTry } from "@frontier/schema";
import { Link } from "../../nav.tsx";
import { type MutableRefObject, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure, pictureUrl } from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { failureOf, useAsync } from "../../useAsync.ts";
import { Problem } from "../ui/Problem.tsx";
import "./GeneratePanel.css";

/** What the panel starts from: the entry, and the two texts a prompt can start as. */
export interface PictureSubject {
  path: string;
  title: string;
  selection: string;
  opening: string;
}

const SHAPES: { shape: PictureShape; label: string; ratio: [number, number] }[] = [
  { shape: "square", label: "Square", ratio: [1, 1] },
  { shape: "wide", label: "Wide", ratio: [3, 2] },
  { shape: "tall", label: "Tall", ratio: [2, 3] },
];
const ratioOf = (s: PictureShape) => SHAPES.find((x) => x.shape === s)!.ratio;

const price = (usd: number) => (usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);

/** The panel's part of the dialog's Insert: what it would insert, and how. */
export interface GenerateSubmit {
  ready: boolean;
  insert: () => void;
}

/**
 * The image dialog's Generate tab (stage 29): a prompt started from the selection or the entry's
 * opening, the art style from the settings (changeable for one picture), a shape, and one picture
 * per press. Every picture made for the entry stays a try, on the server, for seven days; the one
 * chosen is inserted as an unpublished image named as the field says.
 */
export function GeneratePanel({
  subject,
  active,
  onPick,
  submit,
  onChange,
}: {
  subject: PictureSubject;
  /** Whether its tab is the one shown; the panel stays mounted behind the library's. */
  active: boolean;
  onPick: (paths: string[], names: string[]) => void;
  /** Set to what Insert does; the dialog's form calls it. */
  submit: MutableRefObject<GenerateSubmit | null>;
  /** Told when what Insert would do changes, so the dialog's button follows. */
  onChange: (ready: boolean) => void;
}) {
  const status = useAsync(() => api.pictures(subject.path), `pictures:${subject.path}`);
  const offline = useNeedsConnection();
  const [from, setFrom] = useState<"selection" | "opening">(
    subject.selection ? "selection" : "opening",
  );
  const [prompt, setPrompt] = useState(subject.selection || subject.opening);
  const [style, setStyle] = useState<string | null>(null);
  const [shape, setShape] = useState<PictureShape>("square");
  const [tries, setTries] = useState<PictureTry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState(subject.title);
  const [busy, setBusy] = useState<"making" | "inserting" | null>(null);
  const [problem, setProblem] = useState<{ message: string; href?: string } | null>(null);
  const ids = { prompt: useId(), style: useId(), name: useId() };
  const strip = useRef<HTMLDivElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const ready = status.state === "ready" ? status.value : null;
  const list = tries ?? ready?.tries ?? [];
  const current = list.find((t) => t.id === chosen) ?? null;
  const styleText = style ?? ready?.style ?? "";

  // The prompt takes the focus once the panel can be used, so typing starts there.
  const usable = !!ready && !ready.off;
  useEffect(() => {
    if (usable && active) promptBox.current?.focus();
  }, [usable, active]);

  // The latest try is the one shown when the dialog opens.
  useEffect(() => {
    if (ready && tries === null) {
      setTries(ready.tries);
      setChosen(ready.tries[0]?.id ?? null);
    }
  }, [ready, tries]);

  async function make() {
    if (busy || offline || !ready || ready.off) return;
    if (!prompt.trim()) {
      setProblem({ message: "Describe the picture first." });
      return;
    }
    setBusy("making");
    setProblem(null);
    try {
      const { try: made } = await api.makePicture({
        entry: subject.path,
        prompt,
        style: styleText,
        shape,
      });
      setTries((t) => [made, ...(t ?? [])]);
      setChosen(made.id);
    } catch (err) {
      setProblem(
        err instanceof ApiFailure
          ? { message: err.message, ...(err.href ? { href: err.href } : {}) }
          : { message: "No picture came back." },
      );
    } finally {
      setBusy(null);
    }
  }

  async function insert() {
    if (!current || busy) return;
    setBusy("inserting");
    setProblem(null);
    try {
      const got = await api.insertPicture(current.id, name.trim());
      onPick([got.path], [got.embed.replace(/^!\[\[|\]\]$/g, "")]);
    } catch (err) {
      setProblem({
        message: err instanceof ApiFailure ? err.message : "Could not add the picture.",
      });
      setBusy(null);
    }
  }

  const canInsert = !!current && busy === null && !offline;
  submit.current = { ready: canInsert, insert: () => void insert() };
  useEffect(() => onChange(canInsert), [canInsert, onChange]);

  function choose(id: string) {
    const t = list.find((x) => x.id === id);
    setChosen(id);
    // A try made from another prompt brings its prompt back, so Again makes one like it.
    if (t) setPrompt(t.prompt);
  }

  function onStripKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = list.findIndex((t) => t.id === chosen);
    const next =
      list[Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))];
    if (!next) return;
    choose(next.id);
    strip.current?.querySelector<HTMLElement>(`[data-try="${next.id}"]`)?.focus();
  }

  if (status.state === "loading") return <p className="muted generate-panel">Loading…</p>;
  if (failureOf(status)) {
    return <Problem reason={failureOf(status)!.message} onRetry={status.retry} />;
  }
  if (ready?.off) {
    return (
      <div className="generate-off">
        <h3>{"Pictures can't be made yet"}</h3>
        <p>{ready.off.message}</p>
        {ready.off.href && (
          <Link className="button primary" to={ready.off.href}>
            Open the settings
          </Link>
        )}
      </div>
    );
  }

  const shownShape = current?.shape ?? shape;
  const [rw, rh] = ratioOf(shownShape);

  return (
    <div className="generate-panel">
      <div className="generate-form">
        <div className="generate-field">
          <label htmlFor={ids.prompt}>Describe the picture</label>
          <textarea
            id={ids.prompt}
            ref={promptBox}
            value={prompt}
            rows={6}
            maxLength={4000}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void make();
              }
            }}
          />
          <p className="generate-from">
            {from === "selection" ? "From the selection" : "From the title and first paragraph"}
            {subject.selection && subject.opening && (
              <>
                {" · "}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    const next = from === "selection" ? "opening" : "selection";
                    setFrom(next);
                    setPrompt(next === "selection" ? subject.selection : subject.opening);
                  }}
                >
                  {from === "selection" ? "Use the opening instead" : "Use the selection"}
                </button>
              </>
            )}
          </p>
        </div>
        <details className="generate-style">
          <summary>
            Style: <span>{styleText.trim() || "none set"}</span>
          </summary>
          <label htmlFor={ids.style}>
            For this picture only. The usual style is set in Settings › AI models.
          </label>
          <textarea
            id={ids.style}
            value={styleText}
            rows={3}
            maxLength={2000}
            onChange={(e) => setStyle(e.target.value)}
          />
        </details>
        <div className="generate-field">
          <span className="generate-label" id={`${ids.prompt}-shape`}>
            Shape
          </span>
          <div className="generate-shapes" role="group" aria-labelledby={`${ids.prompt}-shape`}>
            {SHAPES.map((s) => (
              <button
                key={s.shape}
                type="button"
                aria-pressed={shape === s.shape}
                onClick={() => setShape(s.shape)}
              >
                <i style={{ aspectRatio: `${s.ratio[0]} / ${s.ratio[1]}` }} aria-hidden="true" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="generate-go">
          <button
            type="button"
            className="primary"
            disabled={busy !== null || !!offline}
            onClick={() => void make()}
          >
            {list.length ? "Again" : "Generate"}
          </button>
          <span className="generate-cost">
            {offline
              ? "Making a picture needs a connection."
              : ready?.perPictureUsd != null
                ? `About ${price(ready.perPictureUsd)} a picture, paid to your provider`
                : "Paid to your own AI provider"}
          </span>
        </div>
      </div>

      <div className="generate-result">
        <div
          className="generate-stage"
          style={{ aspectRatio: `${rw} / ${rh}` }}
          aria-busy={busy === "making"}
        >
          {current ? (
            <img src={pictureUrl(current.id, 1024)} alt={current.prompt} />
          ) : (
            <p className="muted">Your picture appears here.</p>
          )}
          {busy === "making" && (
            <div className="generate-busy" role="status">
              Making the picture…
              <span className="generate-bar" aria-hidden="true">
                <i />
              </span>
            </div>
          )}
        </div>
        {problem && (
          <p className="generate-problem" role="alert">
            {problem.message}
            {problem.href && (
              <>
                {" "}
                <Link to={problem.href}>Open the settings</Link>
              </>
            )}
          </p>
        )}
        {current && (
          <div className="generate-name">
            <label htmlFor={ids.name}>Save as</label>
            <input
              id={ids.name}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <span className="muted">.{current.ext}</span>
          </div>
        )}
        {list.length > 0 && (
          <>
            <p className="generate-tries-head muted">
              <span>Tries for this entry ({list.length})</span>
              <span>Kept for 7 days</span>
            </p>
            <div
              className="generate-tries"
              role="listbox"
              aria-label="Tries"
              ref={strip}
              onKeyDown={onStripKey}
            >
              {list.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  data-try={t.id}
                  aria-selected={t.id === chosen}
                  aria-label={`Try ${list.length - i}`}
                  tabIndex={t.id === chosen || (!chosen && i === 0) ? 0 : -1}
                  onClick={() => choose(t.id)}
                >
                  <img src={pictureUrl(t.id, 160)} alt="" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
