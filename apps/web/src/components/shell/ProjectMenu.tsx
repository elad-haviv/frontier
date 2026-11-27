import type { Ref } from "react";
import { Check, ChevronsUpDown, HardDrive, Layers, Plus } from "lucide-react";
import { useNavigate } from "../../nav.tsx";
import { projectRoot } from "../../project.ts";
import { useOnDevice, useProjects } from "../../projects.ts";
import { queue } from "../../sync/queue.ts";
import { ROLE_NAMES, useProject } from "../projectContext.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { ProjectMark } from "../ui/ProjectMark.tsx";
import { Tip } from "../ui/Tip.tsx";
import { NEW_PROJECT } from "../../pages/projects/newProject.ts";
import "./ProjectMenu.css";

/**
 * The button that opens the menu. The menu's trigger gives it a ref and its own props, which go
 * on the `<button>`; in the rail a tooltip names the project, since only its letter shows.
 */
function ProjectButton({
  rail,
  name,
  colour,
  ref,
  ...rest
}: {
  rail: boolean;
  name: string;
  colour: number;
  ref?: Ref<HTMLButtonElement>;
}) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={`project-button${rail ? " is-rail" : ""}`}
      aria-label={`${name}, switch project`}
    >
      <ProjectMark name={name} colour={colour} />
      {!rail && (
        <>
          <span className="project-button-name">{name}</span>
          <Icon icon={ChevronsUpDown} size="sm" />
        </>
      )}
    </button>
  );
  return rail ? <Tip label={name}>{button}</Tip> : button;
}

/**
 * The project switcher (stage 27b): the open project's letter and name at the head of the left
 * bar, which opens the list of the person's projects, then All projects and New project. It is an
 * ordinary menu, so arrows, Enter, Escape and typing a name's first letters all work. In the
 * folded rail it is the letter alone, with the name as its tooltip; on the phone it is this same
 * button at the head of the drawer, and the list opens in place.
 */
export function ProjectMenu({ rail = false }: { rail?: boolean }) {
  const project = useProject();
  const { list } = useProjects();
  const onDevice = useOnDevice();
  const navigate = useNavigate();
  const waiting = new Map(queue.waitingElsewhere().map((w) => [w.id, w.count]));
  return (
    <Menu
      label="Projects"
      align="start"
      contentClassName="project-menu"
      trigger={<ProjectButton rail={rail} name={project.name} colour={project.colour} />}
    >
      <MenuHeading>Your projects</MenuHeading>
      {(list?.projects ?? []).map((p) => {
        const open = p.id === project.id;
        const details = [
          ROLE_NAMES[p.role],
          p.entries === null ? null : `${p.entries} ${p.entries === 1 ? "entry" : "entries"}`,
          waiting.get(p.id) ? `${waiting.get(p.id)} not sent` : null,
        ].filter(Boolean);
        return (
          <MenuItem
            key={p.id}
            textValue={p.name}
            checked={open}
            onSelect={() => {
              if (!open) void navigate(projectRoot(p.slug));
            }}
          >
            <span className="project-row">
              <ProjectMark name={p.name} colour={p.colour} size="sm" />
              <span className="project-row-text">
                <span className="project-row-name">{p.name}</span>
                <span className="project-row-detail">{details.join(" · ")}</span>
              </span>
              <span className="project-row-marks">
                {onDevice.has(p.id) && (
                  <>
                    <Icon icon={HardDrive} size="sm" />
                    <span className="sr-only">On this device</span>
                  </>
                )}
                {open && <Icon icon={Check} size="sm" className="is-open" />}
              </span>
            </span>
          </MenuItem>
        );
      })}
      <MenuSeparator />
      <MenuItem icon={Layers} keys="g p" onSelect={() => void navigate("/projects")}>
        All projects
      </MenuItem>
      {list?.canCreate && (
        <MenuItem icon={Plus} onSelect={() => void navigate(NEW_PROJECT)}>
          New project
        </MenuItem>
      )}
    </Menu>
  );
}
