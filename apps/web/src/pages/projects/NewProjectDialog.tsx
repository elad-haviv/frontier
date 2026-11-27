import { slugFromName } from "@frontier/schema";
import { useId, useRef, useState } from "react";
import { api, ApiFailure, uploadVault } from "../../api.ts";
import { DialogFrame } from "../../components/Dialogs.tsx";
import { useNavigate } from "../../nav.tsx";
import { projectRoot } from "../../project.ts";
import { loadProjects } from "../../projects.ts";
import { useSlugCheck } from "./useSlugCheck.ts";
import "./NewProjectDialog.css";

type Start = "empty" | "zip" | "sample";

const START_WORDS: Record<Start, { title: string; about: string }> = {
  empty: { title: "An empty library", about: "One welcome entry to begin with." },
  zip: {
    title: "A vault zip",
    about: "Notes and pictures from a folder you zipped, such as an Obsidian vault.",
  },
  sample: { title: "The sample", about: "A small made-up world, to see how Frontier works." },
};

/** The project made, and the zip that did not go in. */
interface Half {
  slug: string;
  name: string;
  message: string;
}

/**
 * Makes a project (stage 27b): its name, its address (filled in from the name until it is
 * edited, and checked as it is typed) and what it starts with. A zip is sent to the new project
 * after it exists, with its progress shown; if that fails the project is still there, and the
 * dialog says so and offers to try again.
 */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [start, setStart] = useState<Start>("empty");
  const [zip, setZip] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [half, setHalf] = useState<Half | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const slugId = useId();
  const slugNote = useId();

  const check = useSlugCheck(slug);
  const slugState = check.state;
  const slugWords = check.words;

  // The address follows the name until the person edits it.
  function typeName(value: string) {
    setName(value);
    if (!edited) setSlug(/[a-z0-9]/i.test(value) ? slugFromName(value) : "");
  }

  const ready =
    name.trim() !== "" && slugState === "free" && (start !== "zip" || zip !== null) && !working;

  async function send(target: string, file: File): Promise<boolean> {
    setSent(0);
    try {
      await uploadVault(target, file, "Imported from a vault zip", (done, total) =>
        setSent(Math.round((done / Math.max(1, total)) * 100)),
      );
      return true;
    } catch (err) {
      setHalf({
        slug: target,
        name: name.trim(),
        message: err instanceof ApiFailure ? err.message : "The zip could not be sent.",
      });
      return false;
    } finally {
      setSent(null);
    }
  }

  async function open(target: string) {
    await loadProjects();
    onClose();
    void navigate(projectRoot(target));
  }

  async function make() {
    if (!ready) return;
    setWorking(true);
    setProblem(null);
    try {
      await api.createProject({
        name: name.trim(),
        slug,
        description: "",
        start: start === "sample" ? "sample" : "empty",
      });
    } catch (err) {
      setProblem(err instanceof ApiFailure ? err.message : "The project could not be made.");
      setWorking(false);
      return;
    }
    if (start === "zip" && zip && !(await send(slug, zip))) {
      setWorking(false);
      return;
    }
    await open(slug);
  }

  async function retry() {
    if (!half || !zip) return;
    setWorking(true);
    const ok = await send(half.slug, zip);
    setWorking(false);
    if (ok) await open(half.slug);
  }

  if (half) {
    return (
      <DialogFrame
        title={`${half.name} is made`}
        onCancel={() => void open(half.slug)}
        onSubmit={() => void retry()}
        className="new-project"
      >
        <p className="dialog-body" role="alert">
          The project exists, but the zip did not go in: {half.message}
        </p>
        {sent !== null && <UploadProgress percent={sent} />}
        <p className="dialog-actions">
          <button type="button" className="quiet" onClick={() => void open(half.slug)}>
            Open it empty
          </button>
          <button type="submit" className="primary" disabled={working}>
            {working ? "Sending…" : "Try the zip again"}
          </button>
        </p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      title="New project"
      onCancel={() => !working && onClose()}
      onSubmit={() => void make()}
      initialFocus={field}
      className="new-project"
    >
      <label className="dialog-field" htmlFor={nameId}>
        <span>Name</span>
        <input
          id={nameId}
          ref={field}
          type="text"
          value={name}
          maxLength={80}
          autoComplete="off"
          disabled={working}
          onChange={(e) => typeName(e.target.value)}
        />
      </label>
      <label className="dialog-field" htmlFor={slugId}>
        <span>Address</span>
        <input
          id={slugId}
          type="text"
          value={slug}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={working}
          aria-invalid={slugState === "bad" || slugState === "taken"}
          aria-describedby={slugNote}
          onChange={(e) => {
            setEdited(true);
            setSlug(e.target.value.trim().toLowerCase());
          }}
        />
      </label>
      <p
        id={slugNote}
        className={`new-project-note${slugState === "bad" || slugState === "taken" ? " error" : ""}`}
        role="status"
      >
        {slug !== "" && slugState !== "bad" && (
          <span className="new-project-url">
            {window.location.origin}
            {projectRoot(slug)}
          </span>
        )}
        <span>{slugWords}</span>
      </p>
      <fieldset className="new-project-start" disabled={working}>
        <legend>Start with</legend>
        {(Object.keys(START_WORDS) as Start[]).map((k) => (
          <label key={k} className="new-project-choice">
            <input type="radio" name="start" checked={start === k} onChange={() => setStart(k)} />
            <span>
              <strong>{START_WORDS[k].title}</strong>
              <small>{START_WORDS[k].about}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {start === "zip" && (
        <label className="dialog-field">
          <span>Zip file</span>
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={working}
            onChange={(e) => setZip(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      {sent !== null && <UploadProgress percent={sent} />}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready}>
          {working ? "Making it…" : "Make the project"}
        </button>
      </p>
    </DialogFrame>
  );
}

function UploadProgress({ percent }: { percent: number }) {
  return (
    <p className="new-project-progress">
      <progress value={percent} max={100} aria-label="Sending the zip" />
      <span>Sending the zip, {percent}%</span>
    </p>
  );
}
