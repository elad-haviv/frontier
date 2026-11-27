import type { MemberRow, MembersResponse, ProjectRole } from "@frontier/schema";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { clearAccessNotice, isLeaving, markLeaving, unmarkLeaving } from "../../access.ts";
import { api, ApiFailure } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { ROLE_NAMES, useProject, useRole } from "../../components/projectContext.ts";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { Avatar } from "../../components/ui/Avatar.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { useToast } from "../../components/ui/Toast.tsx";
import { useNavigate } from "../../nav.tsx";
import { forgetProjectCopy } from "../../offline/copy.ts";
import { loadProjects } from "../../projects.ts";
import { keptText } from "../../people/model.ts";
import { connection, useNeedsConnection } from "../../sync/connection.ts";
import {
  isOnlyOwner,
  LAST_OWNER,
  lastActive,
  peopleLine,
  ROLE_ORDER,
  withArticle,
} from "./membersModel.ts";
import { Invites } from "./Invites.tsx";
import { message } from "./shared.tsx";
import "../../email/email.css";
import "./members.css";

/** The server's words for a refusal, with the one the person can act on put plainly. */
const said = (err: unknown): string =>
  err instanceof ApiFailure && err.code === "last_owner" ? LAST_OWNER : message(err);

/**
 * Settings → This project → Members (stage 31c). Everyone in the project reads the list; owners
 * change roles, remove people and make invite links, and see each person's email. Anyone may leave.
 */
export function Members() {
  const project = useProject();
  const { isOwner, known } = useRole();
  const [list, setList] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  /** What the last change did, said once in words for screen readers too. */
  const [status, setStatus] = useState("");
  const live = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const next = await api.members();
      if (!live.current) return;
      setList(next);
      setError(null);
    } catch (err) {
      if (live.current)
        setError(err instanceof ApiFailure ? err : new ApiFailure(0, "unknown", ""));
    }
  }, []);
  // Read again when the project is (the role may have changed under us).
  useEffect(() => void reload(), [reload, project.record?.role]);
  // Someone may have joined, left or been given another role since: the list is read again when
  // the server says access may have changed, when the person comes back to this tab, and now and
  // then while it is open and in view.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "hidden") void reload();
    };
    const stop = connection.onAccessMayHaveChanged(again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const timer = window.setInterval(again, 60_000);
    return () => {
      stop();
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      window.clearInterval(timer);
    };
  }, [reload]);

  if (!list) {
    return error ? (
      <Problem reason={error.message} onRetry={() => void reload()} />
    ) : (
      <p className="muted">Loading…</p>
    );
  }

  const owner = list.canManage;
  return (
    <>
      <section className="settings-block members" aria-labelledby="members-h">
        <h2 id="members-h" ref={heading} tabIndex={-1}>
          People
        </h2>
        <p className="muted">{peopleLine(list.members.length, project.name, owner)}</p>
        {!owner && known && !isOwner && (
          <p className="muted">Only an owner of the project can change roles or invite people.</p>
        )}
        <ul className="people">
          {list.members.map((m) => (
            <Row
              key={m.id}
              member={m}
              all={list.members}
              owner={owner}
              onChanged={async (words, removed) => {
                setStatus(words);
                await reload();
                project.reload();
                // The row that had the focus is gone: it goes to the list's heading.
                if (removed) heading.current?.focus();
              }}
              onProblem={setStatus}
            />
          ))}
        </ul>
        <div className="said" role="status" aria-live="polite">
          {status}
        </div>
        <Leave members={list.members} />
      </section>
      {owner && <Invites projectName={project.name} />}
    </>
  );
}

/** One person: who they are, their role, and, for an owner, the controls. */
function Row({
  member,
  all,
  owner,
  onChanged,
  onProblem,
}: {
  member: MemberRow;
  all: MemberRow[];
  owner: boolean;
  onChanged: (words: string, removed?: boolean) => Promise<void>;
  onProblem: (words: string) => void;
}) {
  const dialogs = useDialogs();
  const offline = useNeedsConnection();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const only = isOnlyOwner(member, all);
  /** The role the person chose, shown while the server is asked (not the old one, snapping back). */
  const [pending, setPending] = useState<ProjectRole | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const first = member.name.split(/\s+/)[0] || member.name;

  // Asking "Remove X?" moves the focus to the safe answer, and back to the row's button after.
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      remove.current?.focus();
    }
  }, [asking]);
  /** Not removing: back to the row, with the focus on the button that asked. */
  const keepThem = () => {
    refocus.current = true;
    setAsking(false);
  };

  async function setRole(role: ProjectRole) {
    if (role === member.role) return;
    // Stepping down from owner, for yourself, takes the controls away: say so first.
    if (member.you && member.role === "owner") {
      const ok = await dialogs.confirm({
        title: `Make yourself ${withArticle(ROLE_NAMES[role])}?`,
        body: "You will no longer be an owner here. You could not change this back yourself: another owner would have to.",
        action: `Become ${withArticle(ROLE_NAMES[role])}`,
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setPending(role);
    try {
      await api.changeRole(member.id, role);
      // A person's own change is said once, by the notice the page gives when its role changes.
      await onChanged(member.you ? "" : `${member.name} is now ${withArticle(ROLE_NAMES[role])}.`);
    } catch (err) {
      onProblem(said(err));
      await onChanged("").catch(() => undefined);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function take() {
    setBusy(true);
    try {
      const kept = await api.removeMember(member.id);
      setAsking(false);
      const note = keptText(kept, "their");
      await onChanged(
        `${member.name} was removed. What they wrote stays, under their name.${note ? ` Their ${note}` : ""}`,
        true,
      );
    } catch (err) {
      keepThem();
      onProblem(said(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="member-row" data-member={member.id}>
      <Avatar name={member.name} email={member.email ?? ""} />
      <span className="member-who">
        <span className="member-name">
          <b>{member.name}</b>
          {member.you && <span className="tag member-you">You</span>}
        </span>
        <small>
          {member.email ? (
            <>
              {member.email}
              {member.unconfirmed && (
                <span
                  className="tag tag-unconfirmed"
                  title={`${member.email} has not been confirmed yet`}
                >
                  Unconfirmed
                </span>
              )}
              {" · "}
            </>
          ) : null}
          {lastActive(member.lastActiveAt)}
        </small>
      </span>
      {owner ? (
        asking ? (
          <span
            className="member-ask"
            role="group"
            aria-label={`Remove ${member.name}?`}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              keepThem();
            }}
          >
            <span>Remove {first}?</span>
            <ActionButton
              type="button"
              className="primary danger-solid"
              disabled={busy}
              onClick={() => void take()}
            >
              Remove
            </ActionButton>
            <button ref={keep} type="button" className="quiet" onClick={keepThem}>
              Keep
            </button>
          </span>
        ) : (
          <span className="member-controls">
            <select
              className="member-role"
              aria-label={`Role of ${member.name}`}
              value={pending ?? member.role}
              aria-busy={pending !== null || undefined}
              disabled={busy || only || offline !== undefined}
              title={only ? LAST_OWNER : undefined}
              onChange={(e) => void setRole(e.target.value as ProjectRole)}
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </select>
            {pending !== null && <span className="muted member-saving">Saving…</span>}
            {only ? (
              <span className="muted member-only">the only owner</span>
            ) : member.you ? (
              <span className="member-gap" aria-hidden="true" />
            ) : (
              <ActionButton
                ref={remove}
                type="button"
                className="quiet member-remove"
                aria-label={`Remove ${member.name}`}
                disabled={busy}
                onClick={() => setAsking(true)}
              >
                <Icon icon={X} size="sm" />
              </ActionButton>
            )}
          </span>
        )
      ) : (
        <span className={`project-role role-${member.role}`}>{ROLE_NAMES[member.role]}</span>
      )}
    </li>
  );
}

/** Leave this project: for yourself, whatever your role. */
function Leave({ members }: { members: MemberRow[] }) {
  const project = useProject();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const offline = useNeedsConnection();
  const toast = useToast();
  const me = members.find((m) => m.you);
  const [problem, setProblem] = useState<string | null>(null);
  const only = me ? isOnlyOwner(me, members) : false;
  const why = useId();
  if (!me) return null;

  async function leave() {
    setProblem(null);
    const ok = await dialogs.confirm({
      title: `Leave ${project.name}?`,
      body: "You will not be able to open it any more. What you wrote stays, under your name. To come back you need a new invite link from an owner.",
      action: "Leave",
      danger: true,
    });
    if (!ok) return;
    const { slug, name, id } = project;
    markLeaving(slug);
    let kept: Awaited<ReturnType<typeof api.leaveProject>> | undefined;
    try {
      kept = await api.leaveProject();
    } catch (err) {
      if (isLeaving(slug)) unmarkLeaving(slug);
      setProblem(said(err));
      return;
    }
    clearAccessNotice();
    await loadProjects();
    const note = keptText(kept, "your");
    toast({ message: `You left ${name}.${note ? ` Your ${note}` : ""}` });
    void navigate("/projects", { replace: true });
    // The project's page unmarks the leaving when it goes, so that a loss reported while it is
    // still on the screen is not worded as one. Its copy on this device goes too; the changes not
    // sent yet stay, to copy out from All projects.
    void forgetProjectCopy({ id, slug });
  }

  return (
    <div className="member-leave">
      <ActionButton
        type="button"
        className="quiet danger"
        disabled={only || offline !== undefined}
        aria-describedby={only ? why : undefined}
        onClick={() => void leave()}
      >
        Leave this project
      </ActionButton>
      {only && (
        <p id={why} className="muted">
          You are the only owner. {LAST_OWNER}
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
