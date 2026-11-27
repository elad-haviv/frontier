import type { ProjectSummary } from "@frontier/schema";
import { Plus } from "lucide-react";
import { useEffect, useId } from "react";
import { useSearchParams } from "react-router-dom";
import { clearAccessNotice, useAccessNotice } from "../../access.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { Avatar } from "../../components/ui/Avatar.tsx";
import { useCopyText } from "../../components/CopyText.tsx";
import { ProjectMark } from "../../components/ui/ProjectMark.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { ROLE_NAMES } from "../../components/projectContext.ts";
import { Link } from "../../nav.tsx";
import { projectRoot } from "../../project.ts";
import { loadProjects, useOnDevice, useProjects } from "../../projects.ts";
import { nameOf, type QueueRecord, queue, useStranded } from "../../sync/queue.ts";
import { ago } from "../settings/shared.tsx";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import "./AllProjects.css";

/** "12 entries · 3 maps", with what is not counted yet left out. */
export function countsText(p: Pick<ProjectSummary, "entries" | "maps">): string {
  const part = (n: number | null, one: string, many: string) =>
    n === null ? null : `${n} ${n === 1 ? one : many}`;
  return [part(p.entries, "entry", "entries"), part(p.maps, "map", "maps")]
    .filter(Boolean)
    .join(" · ");
}

function Card({ project, here }: { project: ProjectSummary; here: boolean }) {
  const counts = countsText(project);
  return (
    <li className="project-card-item">
      <Link
        to={projectRoot(project.slug)}
        className="project-card"
        aria-label={`${project.name}, ${ROLE_NAMES[project.role]}`}
      >
        <span className="project-card-head">
          <ProjectMark name={project.name} colour={project.colour} size="lg" />
          <span className="project-card-title">{project.name}</span>
          <span className={`project-role role-${project.role}`}>{ROLE_NAMES[project.role]}</span>
        </span>
        {project.description && <span className="project-card-about">{project.description}</span>}
        {counts && <span className="project-card-counts">{counts}</span>}
        <span className="project-card-people" aria-label={`${project.members.length} members`}>
          {project.members.slice(0, 5).map((m) => (
            <Avatar key={m.id} name={m.name} size="sm" />
          ))}
          {project.members.length > 5 && (
            <span className="project-more">+{project.members.length - 5}</span>
          )}
        </span>
        <span className="project-card-saved">
          {project.lastVersion
            ? `${project.lastVersion.by || "Someone"} saved a version ${ago(project.lastVersion.at)}`
            : "No version saved yet"}
          {here && <span className="project-card-here"> · on this device</span>}
        </span>
      </Link>
    </li>
  );
}

/** What a change holds, as text to copy out: an entry's own text, or a map or chronicle's file. */
export function textOfChange(record: Pick<QueueRecord, "value">): string {
  return typeof record.value === "string" ? record.value : JSON.stringify(record.value, null, 2);
}

/** One change that cannot be sent: its name, and ways to copy its text out or throw it away. */
function StrandedRow({ record, onDiscard }: { record: QueueRecord; onDiscard: () => void }) {
  const { copy, box } = useCopyText(nameOf(record));
  return (
    <li className="unsent-row">
      <p className="unsent-name">
        {nameOf(record)}
        {record.kind === "delete" && <span className="muted"> (delete)</span>}
      </p>
      <p className="unsent-actions">
        <button type="button" className="quiet" onClick={() => void copy(textOfChange(record))}>
          Copy the text
        </button>
        <button type="button" className="quiet danger" onClick={onDiscard}>
          Discard
        </button>
      </p>
      {box}
    </li>
  );
}

/**
 * Changes this device holds that cannot be sent: for projects the person can no longer open (the
 * project was deleted, or they were taken out of it), and for projects they can still read but
 * no longer change (their role was lowered, and the server refused the save). They are listed
 * here to copy out or throw away, and are not counted as waiting forever.
 */
function StrandedChanges() {
  const { stranded, refresh } = useStranded();
  const dialogs = useDialogs();
  const heading = useId();
  if (stranded.length === 0) return null;

  async function discard(projectId: string, record: QueueRecord, refused: boolean) {
    const ok = await dialogs.confirm({
      title: `Throw away the change to ${nameOf(record)}?`,
      body: refused
        ? "It exists only on this device. The project keeps what it has."
        : "It exists only on this device, and the project it belongs to cannot be opened.",
      action: "Discard",
      danger: true,
    });
    if (!ok) return;
    await queue.discardStranded(projectId, record.key).catch(() => undefined);
    refresh();
  }

  return (
    <section className="stranded" aria-labelledby={heading}>
      <h2 id={heading}>Changes that cannot be saved</h2>
      <p className="muted">
        These were made on this device and cannot be sent: the project was deleted, you were taken
        out of it, or your role in it no longer lets you change it. They exist only here. Copy the
        text if you want to keep it, then discard it.
      </p>
      {stranded.map((p) => (
        <div key={p.id} className="stranded-project">
          <h3>{p.name}</h3>
          {p.refused && (
            <p className="muted">
              You can still read this project, but your role no longer lets you change it.
            </p>
          )}
          <ul className="unsent-list">
            {p.records.map((r) => (
              <StrandedRow
                key={r.key}
                record={r}
                onDiscard={() => void discard(p.id, r, p.refused === true)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * All projects (stage 27b): a card for each project the person is in, and, for someone who may
 * make one, a dashed card for a new project. Outside any project, so there is no side bar.
 */
export function AllProjects() {
  const { list, failed, loading } = useProjects();
  const onDevice = useOnDevice();
  const [params, setParams] = useSearchParams();
  const making = params.get("new") === "1";
  const lostNotice = useAccessNotice();
  useEffect(() => void loadProjects(), []);
  useEffect(() => {
    document.title = "All projects · Frontier";
  }, []);

  function setMaking(on: boolean) {
    setParams(on ? { new: "1" } : {}, { replace: !on });
  }

  return (
    <section className="all-projects">
      <h1>Your projects</h1>
      {lostNotice && (
        <p className="banner banner-ok access-notice" role="status">
          {lostNotice}{" "}
          <button type="button" className="quiet" onClick={clearAccessNotice}>
            Dismiss
          </button>
        </p>
      )}
      {!list ? (
        failed ? (
          <Problem
            reason="Your projects could not be read. Check your connection, then try again."
            onRetry={() => void loadProjects()}
          />
        ) : (
          <p className="muted">{loading ? "Loading…" : ""}</p>
        )
      ) : list.projects.length === 0 && !list.canCreate ? (
        <div className="all-projects-empty">
          <p>You're not in a project yet.</p>
          <p className="muted">
            You join a project with an invite link from one of its owners. Ask an owner to make one
            for you and send it; opening it brings you in. Frontier sends no mail, so the link comes
            from them.
          </p>
        </div>
      ) : (
        <ul className="project-cards">
          {list.projects.map((p) => (
            <Card key={p.id} project={p} here={onDevice.has(p.id)} />
          ))}
          {list.canCreate && (
            <li className="project-card-item">
              <button type="button" className="project-card is-new" onClick={() => setMaking(true)}>
                <Plus aria-hidden="true" />
                <span>New project</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {list && list.projects.length === 0 && list.canCreate && (
        <p className="muted">
          You're not in a project yet. Make one to begin, or open an invite link from an owner of
          another.
        </p>
      )}
      <StrandedChanges />
      {making && list?.canCreate && <NewProjectDialog onClose={() => setMaking(false)} />}
    </section>
  );
}
