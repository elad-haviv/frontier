import type { InviteSummary, MemberRow, MembersResponse, ProjectRole } from "@frontier/schema";
import { Copy, Link2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  clearAccessNotice,
  isLeaving,
  markLeaving,
  recalledInviteLink,
  rememberInviteLink,
  unmarkLeaving,
  type MadeInvite,
} from "../../access.ts";
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
  ROLE_MAY,
  ROLE_ORDER,
  timeLeft,
  withArticle,
} from "./membersModel.ts";
import { message } from "./shared.tsx";
import "./members.css";

/** The server's words for a refusal, with the one the person can act on put plainly. */
const said = (err: unknown): string =>
  err instanceof ApiFailure && err.code === "last_owner" ? LAST_OWNER : message(err);

/**
 * Settings → This project → Members (stage 27c). Everyone in the project reads the list; owners
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
        <small>{[member.email, lastActive(member.lastActiveAt)].filter(Boolean).join(" · ")}</small>
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

/** Invite links: make one, copy it, and the ones still waiting. Owners only. */
function Invites({ projectName }: { projectName: string }) {
  const project = useProject();
  const dialogs = useDialogs();
  const toast = useToast();
  const offline = useNeedsConnection();
  const [role, setRole] = useState<ProjectRole>("writer");
  // The link just made is the server's one showing, so it is kept in memory (never in storage)
  // while the person moves between the sections of Settings in this tab.
  const [link, setLinkNow] = useState<MadeInvite | null>(() => recalledInviteLink(project.id));
  const setLink = (next: MadeInvite | null) => {
    rememberInviteLink(project.id, next);
    setLinkNow(next);
  };
  const [waiting, setWaiting] = useState<{ list: InviteSummary[]; at: number } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // Time left is worked out from when the list was read, and moves on each minute.
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLSpanElement>(null);
  const [byHand, setByHand] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const roleId = useId();
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const reload = useCallback(async () => {
    try {
      const read = (await api.invites()).invites;
      if (!live.current) return;
      setWaiting({ list: read, at: Date.now() });
      setNow(Date.now());
      setListError(null);
    } catch (err) {
      if (live.current) setListError(message(err));
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  /** The links that still work, with the seconds each has left now. */
  const alive =
    waiting === null
      ? null
      : waiting.list
          .map((w) => ({ ...w, left: w.secondsLeft - Math.floor((now - waiting.at) / 1000) }))
          .filter((w) => w.left > 0);

  async function make() {
    setError(null);
    // The link on the screen cannot be shown again once it is replaced: say so first.
    if (link) {
      const ok = await dialogs.confirm({
        title: "Make another link?",
        body: "The link on this page is shown only once, and making another takes it off the screen. It keeps working until someone uses it or you cancel it. Copy it first if you still need it.",
        action: "Make another link",
      });
      if (!ok) return;
    }
    // An owner link gives away the project: it is made on purpose, not by a stray press.
    if (role === "owner") {
      const ok = await dialogs.confirm({
        title: "Make a link that joins as an owner?",
        body: `Whoever uses it can change roles, remove people, make links and delete ${projectName}. Make it only for someone you trust with all of that.`,
        action: "Make an owner link",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const made = await api.createInvite(role);
      setLink({
        id: made.id,
        url: made.url || `${window.location.origin}${made.path}`,
        role: made.role,
      });
      setByHand(false);
      setSaid("");
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // The browser would not copy: the link is shown in a box, selected, to copy by hand.
  useEffect(() => {
    if (!byHand) return;
    area.current?.focus();
    area.current?.select();
  }, [byHand]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setByHand(false);
      toast({ message: "Copied the invite link." });
    } catch {
      // No clipboard (an insecure page, a locked-down browser): the link is selected to copy by hand.
      setByHand(true);
      toast({ message: "Select the link and copy it." });
    }
  }

  async function cancel(invite: InviteSummary) {
    setCancelling(invite.id);
    try {
      await api.cancelInvite(invite.id);
      // The link just made, cancelled: there is nothing left to copy, so it leaves the screen.
      if (link?.id === invite.id) setLink(null);
      setSaid("The invitation was cancelled. Its link no longer works.");
    } catch (err) {
      setSaid(message(err));
    } finally {
      await reload();
      if (live.current) setCancelling(null);
    }
  }

  return (
    <>
      <section className="settings-block members" aria-labelledby="invite-h">
        <h2 id="invite-h">Invite someone</h2>
        <div className="invite-box">
          <div className="invite-line">
            <label htmlFor={roleId}>They join as</label>
            <select
              id={roleId}
              className="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </select>
            <ActionButton
              type="button"
              className="primary"
              disabled={busy || offline !== undefined}
              onClick={() => void make()}
            >
              <Icon icon={Link2} size="sm" /> Make an invite link
            </ActionButton>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {link && (
            <div className="invite-made" role="group" aria-label="The invite link">
              <div className="invite-line">
                {byHand ? (
                  <textarea
                    ref={area}
                    className="linkbox"
                    data-testid="invite-link"
                    readOnly
                    rows={2}
                    value={link.url}
                    aria-label="The invite link, selected to copy"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                ) : (
                  <span className="linkbox" ref={box} data-testid="invite-link">
                    {link.url}
                  </span>
                )}
                <button type="button" className="quiet" onClick={() => void copy()}>
                  <Icon icon={Copy} size="sm" /> Copy
                </button>
              </div>
              <p className="muted invite-once">
                Send it to one person, who joins as {withArticle(ROLE_NAMES[link.role])}. It works
                once, for 7 days. Frontier sends no mail, and it will not show this link again once
                you make another or close this page, so copy it now.
              </p>
            </div>
          )}
          <dl className="roles-key">
            {([...ROLE_ORDER].reverse() as ProjectRole[]).map((r) => (
              <div key={r}>
                <dt>{ROLE_NAMES[r]}</dt>
                <dd>{ROLE_MAY[r]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="settings-block members" aria-labelledby="waiting-h">
        <h2 id="waiting-h">Invitations waiting</h2>
        {alive === null ? (
          listError ? (
            <Problem reason={listError} retryLabel="Try again" onRetry={() => void reload()} />
          ) : (
            <p className="muted">Loading…</p>
          )
        ) : alive.length === 0 ? (
          <p className="muted">No invitations are waiting.</p>
        ) : (
          <>
            {listError && (
              <Problem reason={listError} retryLabel="Try again" onRetry={() => void reload()} />
            )}
            <ul className="people">
              {alive.map((w) => (
                <li key={w.id} className="member-row invite-row">
                  <Icon icon={Link2} />
                  <span className="member-who">
                    <b>A link for one {ROLE_NAMES[w.role].toLowerCase()}</b>
                    <small>
                      Made by {w.createdBy.name || "an owner"} · not used yet · {timeLeft(w.left)}
                    </small>
                  </span>
                  <ActionButton
                    type="button"
                    className="quiet"
                    disabled={cancelling !== null}
                    aria-busy={cancelling === w.id || undefined}
                    aria-label={`Cancel the link for one ${ROLE_NAMES[w.role].toLowerCase()}, made by ${w.createdBy.name || "an owner"}`}
                    onClick={() => void cancel(w)}
                  >
                    {cancelling === w.id ? "Cancelling…" : "Cancel it"}
                  </ActionButton>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="said" role="status" aria-live="polite">
          {said}
        </div>
      </section>
    </>
  );
}
