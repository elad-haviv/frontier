import { useEffect, useId, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { ROLE_NAMES, useProject, useRole } from "../../components/projectContext.ts";
import { Link, useNavigate } from "../../nav.tsx";
import { OLD_SLUG_DAYS } from "@frontier/schema";
import { projectRoot } from "../../project.ts";
import { dropDeviceCopyOf } from "../../offline/copy.ts";
import { loadProjects, noteProject, useProjects } from "../../projects.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import { queue } from "../../sync/queue.ts";
import { useSlugCheck } from "../projects/useSlugCheck.ts";
import { message } from "./shared.tsx";

/** Why the first project cannot be deleted, in the server's words. */
export const FIRST_PROJECT_REASON =
  "This is the library the server started with. Its files sit in the server's own data folder, so it cannot be deleted from here.";
export const LAST_PROJECT_REASON = "The last project cannot be deleted.";

/**
 * Settings → This project → General (stage 31b): the project's name, address and description,
 * the people in it, and deleting it. An owner changes these; anyone else reads them. Changing the
 * address leaves the old one working for 90 days, which the page says before it is saved.
 */
export function General() {
  const project = useProject();
  const navigate = useNavigate();
  const { list } = useProjects();
  const offline = useNeedsConnection();
  const { isOwner: owner } = useRole();
  const record = project.record;
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [description, setDescription] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameId = useId();
  const slugId = useId();
  const aboutId = useId();
  const slugNote = useId();
  const check = useSlugCheck(slug, project.slug);

  // The record arrives after the list's summary: the fields follow it until the owner types.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setName(project.name);
    setSlug(project.slug);
    setDescription(project.description);
  }, [project.name, project.slug, project.description, touched]);

  const changed =
    name.trim() !== project.name ||
    slug !== project.slug ||
    description.trim() !== project.description;
  // An address that could not be checked is still sent: the server refuses a taken one.
  const slugOk = check.state === "same" || check.state === "free" || check.state === "unknown";
  const canSave = owner && changed && name.trim() !== "" && slugOk && !saving && !offline;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setProblem(null);
    setSaved(false);
    try {
      const next = await api.updateProject({
        name: name.trim(),
        ...(slug !== project.slug ? { slug } : {}),
        description: description.trim(),
      });
      noteProject({ id: next.id, slug: next.slug, name: next.name, description: next.description });
      setTouched(false);
      setSaved(true);
      project.reload();
      // The address in the bar follows a new address; the old one still works for a while.
      if (next.slug !== project.slug) {
        void navigate(`${projectRoot(next.slug)}/settings/general`, { replace: true });
      }
    } catch (err) {
      setProblem(message(err));
    } finally {
      setSaving(false);
    }
  }

  const members = record?.members ?? [];
  const onlyOne = (list?.projects.length ?? 0) <= 1;
  const cannotDelete =
    record && !record.deletable ? FIRST_PROJECT_REASON : onlyOne ? LAST_PROJECT_REASON : null;

  return (
    <>
      <section className="settings-block">
        {owner ? (
          <form
            className="general-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="field" htmlFor={nameId}>
              <span>Name</span>
              <input
                id={nameId}
                value={name}
                maxLength={80}
                onChange={(e) => {
                  setTouched(true);
                  setName(e.target.value);
                }}
              />
            </label>
            <label className="field" htmlFor={slugId}>
              <span>Address</span>
              <input
                id={slugId}
                value={slug}
                maxLength={40}
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={check.state === "bad" || check.state === "taken"}
                aria-describedby={slugNote}
                onChange={(e) => {
                  setTouched(true);
                  setSlug(e.target.value.trim().toLowerCase());
                }}
              />
            </label>
            <p
              id={slugNote}
              className={`general-note${check.state === "bad" || check.state === "taken" ? " error" : " muted"}`}
              role="status"
            >
              {window.location.origin}
              {projectRoot(slug || project.slug)} · {check.words}
              {check.state === "unknown" && (
                <>
                  {" "}
                  <button type="button" className="link" onClick={check.retry}>
                    Try again
                  </button>
                </>
              )}
            </p>
            {slug !== project.slug && check.state !== "bad" && (
              <p className="banner" role="note">
                The old address keeps working for {OLD_SLUG_DAYS} days, so links you have shared
                still open the project. After that they stop. Update bookmarks and links you keep.
              </p>
            )}
            <label className="field" htmlFor={aboutId}>
              <span>Description</span>
              <textarea
                id={aboutId}
                value={description}
                maxLength={300}
                rows={3}
                onChange={(e) => {
                  setTouched(true);
                  setDescription(e.target.value);
                }}
              />
            </label>
            <p className="general-actions">
              <button type="submit" className="primary" disabled={!canSave}>
                {saving ? "Saving…" : "Save"}
              </button>
              {offline && <span className="muted">{offline}</span>}
              {saved && !changed && <span role="status">Saved.</span>}
            </p>
            {problem && (
              <p className="error" role="alert">
                {problem}
              </p>
            )}
          </form>
        ) : (
          <>
            <p className="muted">Only an owner of the project can change these.</p>
            <dl className="facts">
              <dt>Name</dt>
              <dd>{project.name}</dd>
              <dt>Address</dt>
              <dd>
                {window.location.origin}
                {projectRoot(project.slug)}
              </dd>
              {project.description && (
                <>
                  <dt>Description</dt>
                  <dd>{project.description}</dd>
                </>
              )}
            </dl>
          </>
        )}
      </section>
      <section className="settings-block">
        <h2>People</h2>
        {record ? (
          <ul className="general-members">
            {members.map((m) => (
              <li key={m.id}>
                <span>{m.name}</span>
                <span className="muted"> · {ROLE_NAMES[m.role]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Loading…</p>
        )}
        <p>
          <Link to="/settings/members">
            {owner ? "Manage the members and invite links" : "See everyone in Members"}
          </Link>
        </p>
      </section>
      {owner && (
        <DeleteArea reason={cannotDelete} name={project.name} id={project.id} slug={project.slug} />
      )}
    </>
  );
}

/** Delete this project: the project's name typed first, so a stray press cannot do it. */
function DeleteArea({
  reason,
  name,
  id,
  slug,
}: {
  reason: string | null;
  name: string;
  id: string;
  slug: string;
}) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const offline = useNeedsConnection();
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useId();
  const why = useId();
  const disabled = reason !== null || offline !== undefined;

  async function remove() {
    if (typed.trim() !== name || disabled) return;
    // Changes still on this device for the project go with it: the person is told how many.
    const unsent = await queue.unsentIn(id);
    if (unsent > 0) {
      const ok = await dialogs.confirm({
        title: unsent === 1 ? "1 change is not sent yet" : `${unsent} changes are not sent yet`,
        body: `This device holds ${unsent === 1 ? "a change" : "changes"} to ${name} that ${unsent === 1 ? "has" : "have"} not reached the server. Deleting the project throws ${unsent === 1 ? "it" : "them"} away.`,
        action: "Delete the project and lose them",
        danger: true,
      });
      if (!ok) return;
    }
    setWorking(true);
    setProblem(null);
    try {
      await api.deleteProject(typed.trim());
    } catch (err) {
      setProblem(err instanceof ApiFailure ? err.message : message(err));
      setWorking(false);
      return;
    }
    // Nothing of it stays on this device, and the list no longer has it.
    await dropDeviceCopyOf({ id, slug }).catch(() => undefined);
    await queue.dropProject({ id, slug }).catch(() => undefined);
    const next = await loadProjects();
    void navigate(
      next && next.projects.length === 1 ? projectRoot(next.projects[0]!.slug) : "/projects",
      {
        replace: true,
      },
    );
  }

  return (
    <section className="settings-block general-danger" aria-labelledby={`${field}-h`}>
      <h2 id={`${field}-h`}>Delete this project</h2>
      <p className="muted">
        Its entries, maps, chronicles and saved versions are taken off the server. The files are
        moved to a trash folder there, not erased, so a mistake can be put right by hand.
      </p>
      {reason && (
        <p id={why} className="banner" role="note">
          {reason}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void remove();
        }}
      >
        <label className="field" htmlFor={field}>
          <span>Type the project's name, {name}, to delete it</span>
          <input
            id={field}
            value={typed}
            disabled={disabled}
            autoComplete="off"
            aria-describedby={reason ? why : undefined}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <p className="general-actions">
          <button
            type="submit"
            className="primary danger-solid"
            disabled={disabled || working || typed.trim() !== name}
            aria-describedby={reason ? why : undefined}
          >
            {working ? "Deleting…" : "Delete this project"}
          </button>
          {offline && !reason && <span className="muted">{offline}</span>}
        </p>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </section>
  );
}
