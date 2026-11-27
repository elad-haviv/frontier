import type { ProjectSummary } from "@frontier/schema";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar.tsx";
import { ProjectMark } from "../../components/ui/ProjectMark.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { ROLE_NAMES } from "../../components/projectContext.ts";
import { Link } from "../../nav.tsx";
import { projectRoot } from "../../project.ts";
import { loadProjects, useOnDevice, useProjects } from "../../projects.ts";
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

/**
 * All projects (stage 27b): a card for each project the person is in, and, for someone who may
 * make one, a dashed card for a new project. Outside any project, so there is no side bar.
 */
export function AllProjects() {
  const { list, failed, loading } = useProjects();
  const onDevice = useOnDevice();
  const [params, setParams] = useSearchParams();
  const making = params.get("new") === "1";
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
        <p className="all-projects-empty">
          You're not in a project yet. Ask an owner for an invite link.
        </p>
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
        <p className="muted">You're not in a project yet. Make one to begin.</p>
      )}
      {making && list?.canCreate && <NewProjectDialog onClose={() => setMaking(false)} />}
    </section>
  );
}
