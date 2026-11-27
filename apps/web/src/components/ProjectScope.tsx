import type { ProjectResponse } from "@frontier/schema";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLocation as useRouterLocation,
  useNavigate as useRouterNavigate,
  useParams,
} from "react-router-dom";
import { ROLE_RANK } from "@frontier/schema";
import { api, apiFor, ApiFailure } from "../api.ts";
import { isLeaving, noteAccessLost, takeJoined, unmarkLeaving } from "../access.ts";
import { forgetProjectCopy } from "../offline/copy.ts";
import { resumeProposals } from "../proposeAfterPublish.ts";
import { currentProject, projectRoot, setCurrentProject, withoutProject } from "../project.ts";
import {
  hasLegacyFlags,
  isOnDevice,
  loadProjects,
  noteLast,
  noteProject,
  projectAt,
  useOnDevice,
  useProjects,
} from "../projects.ts";
import { connection, useConnection } from "../sync/connection.ts";
import { queue } from "../sync/queue.ts";
import { Link } from "../nav.tsx";
import { useToast } from "./ui/Toast.tsx";
import { OutsideShell } from "./OutsideShell.tsx";
import { ProjectContext, type ProjectInfo, ROLE_NAMES } from "./projectContext.ts";
import { showUnsent } from "./unsentPanel.ts";
import { rememberRole, resolveRole } from "./projectRole.ts";
import { Shell } from "./Shell.tsx";
import { Problem } from "./ui/Problem.tsx";
import { Progress } from "./ui/Progress.tsx";
import "./ProjectScope.css";

/** What reading the project's record gave, for the address that was asked. */
interface Answer {
  asked: string;
  record: ProjectResponse | null;
  error: ApiFailure | null;
}

/**
 * A project's pages (stage 27b), at `/p/<slug>/...`. It finds out which project the address names
 * (from the person's list, or by asking the server, which also knows an address the project had
 * before it was renamed), opens it for the app (`setCurrentProject`), and draws the shell around
 * the pages. Another project is a whole new tree under a new key, so nothing of the last one
 * stays on the screen or in a page's state; what sits in memory beside it lets go on
 * `onProjectChange`.
 */
export function ProjectScope({ children }: { children: ReactNode }) {
  const { slug = "" } = useParams();
  const { list } = useProjects();
  const navigate = useRouterNavigate();
  const location = useRouterLocation();
  const onDevice = useOnDevice();
  const { state: connectionState } = useConnection();
  const known = list?.projects.find((p) => p.slug === slug) ?? null;

  // The server's record of the project: who is in it, and what the person may do.
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    apiFor(slug)
      .project()
      .then(
        (record) => live && setAnswer({ asked: slug, record, error: null }),
        (err: unknown) =>
          live &&
          setAnswer({
            asked: slug,
            record: null,
            error: err instanceof ApiFailure ? err : new ApiFailure(0, "unknown", String(err)),
          }),
      );
    return () => {
      live = false;
    };
  }, [slug, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const heard = answer?.asked === slug ? answer : null;
  const record = heard?.record ?? null;
  const error = heard?.error ?? null;

  // The project's record is read again, quietly, when the server may have changed what the person
  // may do here (stage 27c): its status stream ends when a role changes or someone is removed,
  // and a request refused for want of a role says so too. A failure to reach the server leaves
  // what is known as it is. Kept for one address: an answer that comes after the person went to
  // another project is let go, and does not touch that project's record.
  useEffect(() => {
    let live = true;
    let refreshing = false;
    const stop = connection.onAccessMayHaveChanged(() => {
      if (refreshing) return;
      refreshing = true;
      apiFor(slug)
        .project()
        .then(
          (next) => live && setAnswer({ asked: slug, record: next, error: null }),
          (err: unknown) => {
            if (live && err instanceof ApiFailure && err.code === "no_project") {
              setAnswer({ asked: slug, record: null, error: err });
            }
          },
        )
        .finally(() => {
          refreshing = false;
        });
    });
    return () => {
      live = false;
      stop();
    };
  }, [slug]);

  // What is known of the address that is open: whether the person was in it, and what it was
  // called. It belongs to the address, so another project (one the person is not in) never
  // inherits it, and is not reported as lost. A rename carries it to the new address.
  const seen = useRef({
    slug,
    hadIt: false,
    id: null as string | null,
    name: known?.name ?? "this project",
  });
  const renamedTo = useRef<string | null>(null);
  if (seen.current.slug !== slug) {
    seen.current =
      renamedTo.current === slug
        ? { ...seen.current, slug }
        : { slug, hadIt: false, id: null, name: known?.name ?? "this project" };
    renamedTo.current = null;
  }
  if (record) {
    seen.current.hadIt = true;
    seen.current.id = record.id;
    seen.current.name = record.name;
  } else if (known) {
    seen.current.hadIt = true;
    seen.current.id = known.id;
    seen.current.name = known.name;
  }

  // Taken out of the project while it is open, or opened from a list that is out of date: All
  // projects, with a plain note. An address that never named a project the person is in is the
  // page that says so (`NoProject`).
  const lost = error?.code === "no_project" && seen.current.hadIt;
  useEffect(() => {
    if (!lost) return;
    const { id: lostId, name } = seen.current;
    if (!isLeaving(slug)) noteAccessLost(name);
    // What this device kept of the project to read goes; the changes not sent yet stay, for the
    // person to copy out from All projects.
    if (lostId) void forgetProjectCopy({ id: lostId, slug });
    void loadProjects();
    void navigate("/projects", { replace: true });
  }, [lost, slug]);
  // Leaving on purpose is marked until this page is gone, so it is never also reported as a loss.
  useEffect(() => () => unmarkLeaving(slug), [slug]);

  // The owner renamed the address, here or elsewhere: the address in the bar follows, and what
  // the person typed after it stays.
  useEffect(() => {
    if (!record) return;
    noteProject({ id: record.id, slug: record.slug, name: record.name });
    if (record.slug !== slug) {
      renamedTo.current = record.slug;
      const { rest } = withoutProject(location.pathname);
      void navigate(
        `${projectRoot(record.slug)}${rest === "/" ? "" : rest}${location.search}${location.hash}`,
        {
          replace: true,
        },
      );
    }
    // Only a new record moves the address.
  }, [record]);

  // Not before the list of projects says which one is the legacy one: that decides whose the
  // device's old data is, and a queue made too early would file this project's changes wrongly.
  const listed = hasLegacyFlags(list);
  const ref = !listed
    ? null
    : record
      ? { id: record.id, slug: record.slug }
      : known && !(error && error.code === "no_project")
        ? { id: known.id, slug: known.slug }
        : null;

  // The project is opened for the app after the first draw that knows it, so that what hears of
  // it (the queue, the device copy, the status stream) does not change a page while it renders.
  const [opened, setOpened] = useState<string | null>(null);
  const id = ref?.id ?? null;
  const address = ref?.slug ?? null;
  useLayoutEffect(() => {
    if (id === null || address === null) return;
    setCurrentProject({ id, slug: address });
    connection.projectChanged();
    // The page says which project it shows (the browser tests read what the device keeps for it).
    document.documentElement.dataset.project = id;
    setOpened(id);
    return () => {
      if (currentProject()?.id === id) {
        delete document.documentElement.dataset.project;
        setCurrentProject(null);
        setOpened(null);
      }
    };
  }, [id]);
  useLayoutEffect(() => {
    if (id !== null && address !== null && opened === id) {
      setCurrentProject({ id, slug: address });
      connection.projectChanged();
    }
  }, [address]);

  // Back with a connection: the record is read again, which opens a project that could not be.
  useEffect(() => {
    if (connectionState === "online" && error && error.status === 0) reload();
  }, [connectionState]);

  const summary = known ?? (ref ? projectAt(ref.slug) : undefined);
  // Not "reader" for a role that has not arrived: the record, else the list, else what this device
  // knew last time, else unknown.
  const role = ref ? resolveRole(ref.id, { record: record?.role, summary: summary?.role }) : null;
  useEffect(() => {
    // What the server said is remembered, so the shell is right the next time, offline too.
    const said = record?.role ?? summary?.role;
    if (ref && said) rememberRole(ref.id, said);
  }, [ref?.id, record?.role, summary?.role]);
  // What belongs to opening the project, once the app has it.
  useEffect(() => {
    if (opened === null || address === null) return;
    noteLast(address);
    void api.setLastProject(address).catch(() => undefined);
  }, [opened]);
  // Proposals a save left waiting in this project go on, with this person's keys: only for a
  // writer, since a reader's requests for them would be refused (stage 27c).
  const mayWrite = role === "writer" || role === "owner";
  useEffect(() => {
    if (opened === null || !mayWrite) return;
    void resumeProposals();
    // Saves that were refused while the role was lower go back to waiting.
    void queue.resumeRefused();
  }, [opened, mayWrite]);

  // Joined from the join page, which loaded the project afresh: said once, here.
  const joinedToast = useToast();
  useEffect(() => {
    if (opened === null) return;
    const words = takeJoined();
    if (words) joinedToast({ message: words });
  }, [opened]);

  // A role that changed while the project is open is said once; the shell follows it by itself.
  const toast = useToast();
  const before = useRef<{ id: string; role: NonNullable<typeof role> } | null>(null);
  useEffect(() => {
    if (!ref || !role) return;
    const was = before.current;
    before.current = { id: ref.id, role };
    if (!was || was.id !== ref.id || was.role === role) return;
    const lowered = ROLE_RANK[role] < ROLE_RANK[was.role];
    const article = role === "owner" ? "an" : "a";
    // Changes that were waiting to be sent are not lost, but they will not be saved: said where
    // they can be copied from.
    const unsent = lowered && role === "reader" && queue.current().length > 0;
    toast({
      message: `You are now ${article} ${ROLE_NAMES[role]} here.${
        lowered && role === "reader" ? " You can read and ask, but not change the project." : ""
      }${
        unsent
          ? " Your last changes were not saved. They are kept on this device, in Not sent yet."
          : ""
      }`,
      ...(unsent ? { action: { label: "Open Not sent yet", run: showUnsent } } : {}),
    });
  }, [ref?.id, role]);
  const info: ProjectInfo | null = useMemo(() => {
    if (!ref) return null;
    const base = record ?? summary;
    if (!base) return null;
    return {
      id: ref.id,
      slug: ref.slug,
      name: base.name,
      description: base.description,
      colour: base.colour,
      role,
      record,
      reload,
    };
  }, [ref?.id, ref?.slug, record, summary, role, reload]);

  if (!ref) {
    if (error?.code === "no_project") return <NoProject />;
    if (error) {
      return error.status === 0 ? (
        <NotOnDevice name={null} retry={reload} />
      ) : (
        <OutsideShell>
          <div className="project-note">
            <Problem reason={error.message} onRetry={reload} />
          </div>
        </OutsideShell>
      );
    }
    return <Progress label="Opening the project" />;
  }
  // A project this device has never kept, with no connection: it is said, not shown empty.
  if (error && error.status === 0 && !isOnDevice(ref.id) && !onDevice.has(ref.id)) {
    return <NotOnDevice name={info?.name ?? null} retry={reload} />;
  }
  if (error && error.code === "no_project") return <NoProject />;
  if (!info || opened !== ref.id) return <Progress label="Opening the project" />;
  return (
    <ProjectContext.Provider value={info}>
      <Shell key={ref.id}>{children}</Shell>
    </ProjectContext.Provider>
  );
}

/** An address that names no project the person is in (or one that does not exist: the same words). */
function NoProject() {
  return (
    <OutsideShell>
      <div className="project-note">
        <h1>There is no project here that you can open</h1>
        <p>
          The address may be mistyped, or the project may have been removed, or you may not be in
          it. <Link to="/projects">See your projects</Link>.
        </p>
      </div>
    </OutsideShell>
  );
}

/**
 * A project the server cannot be asked about and this device has no copy of: the way back is
 * here, with the projects that are on this device offered instead.
 */
function NotOnDevice({ name, retry }: { name: string | null; retry: () => void }) {
  const { list } = useProjects();
  const onDevice = useOnDevice();
  const here = (list?.projects ?? []).filter((p) => onDevice.has(p.id));
  return (
    <OutsideShell>
      <div className="project-note" role="status">
        <h1>{name ?? "This project"} is not on this device</h1>
        <p>
          Frontier keeps a project's pages on a device once you have opened it there with a
          connection. This one has not been opened here yet, and there is no connection now. It
          opens when you are connected.
        </p>
        <p className="project-note-actions">
          <button type="button" className="primary" onClick={retry}>
            Try again
          </button>
          <Link to="/projects">All projects</Link>
        </p>
        {here.length > 0 && (
          <>
            <h2>On this device</h2>
            <ul>
              {here.map((p) => (
                <li key={p.id}>
                  <Link to={`/p/${encodeURIComponent(p.slug)}`}>{p.name}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </OutsideShell>
  );
}
