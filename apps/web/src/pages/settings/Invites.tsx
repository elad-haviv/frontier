import type { InviteSummary, ProjectRole } from "@frontier/schema";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { type MadeInvite, recalledInviteLink, rememberInviteLink } from "../../access.ts";
import { api, ApiFailure } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { ROLE_NAMES, useProject } from "../../components/projectContext.ts";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Problem } from "../../components/ui/Problem.tsx";
import { useToast } from "../../components/ui/Toast.tsx";
import { BAD_ADDRESS, looksLikeEmail, NO_MAIL } from "../../email/emailModel.ts";
import { useMailOn } from "../../me.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import {
  inviteFailure,
  inviteNote,
  resentWords,
  ROLE_MAY,
  ROLE_ORDER,
  sentLine,
  timeLeft,
} from "./membersModel.ts";
import { message } from "./shared.tsx";
import "../../email/email.css";
import "./members.css";

/**
 * Invite links: make one, copy it, and the ones still waiting. Owners only. With mail on (stage 32)
 * the link can also be emailed: an optional address beside the role, "Send the invite" instead of
 * "Make the link", and a waiting invitation that was emailed says where, and can be sent again
 * (which makes a new link, since the server keeps only a fingerprint of each one). The link is
 * shown either way, once. With mail off the box looks as it did, and says the server cannot send.
 */
export function Invites({ projectName }: { projectName: string }) {
  const project = useProject();
  const dialogs = useDialogs();
  const toast = useToast();
  const offline = useNeedsConnection();
  const mailOn = useMailOn();
  const [role, setRole] = useState<ProjectRole>("writer");
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  // The link just made is the server's one showing, so it is kept in memory (never in storage)
  // while the person moves between the sections of Settings in this tab.
  const [link, setLinkNow] = useState<MadeInvite | null>(() => recalledInviteLink(project.id));
  const setLink = (next: MadeInvite | null) => {
    rememberInviteLink(project.id, next);
    setLinkNow(next);
  };
  // The new link of a resend whose mail failed, kept with its own row: the link shown above is
  // another invitation's and is not replaced without asking.
  const [rowLinks, setRowLinks] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<{ list: InviteSummary[]; at: number } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // Time left is worked out from when the list was read, and moves on each minute.
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLSpanElement>(null);
  const [byHand, setByHand] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const addressField = useRef<HTMLInputElement>(null);
  const ids = { role: useId(), address: useId(), error: useId(), help: useId() };
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

  const typed = mailOn ? address.trim() : "";

  async function make(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (typed && !looksLikeEmail(typed)) {
      setAddressError(BAD_ADDRESS);
      addressField.current?.focus();
      return;
    }
    setAddressError(null);
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
      const made = await api.createInvite(role, typed || undefined);
      setLink({
        id: made.id,
        url: made.url || `${window.location.origin}${made.path}`,
        role: made.role,
        sentTo: made.sentTo,
        mail: made.mail,
      });
      setByHand(false);
      setSaid("");
      setAddress("");
      await reload();
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      if (failure?.code === "invalid" && typed) {
        setAddressError(BAD_ADDRESS);
        addressField.current?.focus();
      } else if (failure && mailOn !== null && typed)
        setError(inviteFailure(failure.code, failure.message));
      else setError(message(err));
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

  /** Sends an emailed invitation again: a new link, the earlier one cancelled, said plainly. */
  async function resend(invite: InviteSummary) {
    setResending(invite.id);
    setSaid("");
    try {
      const made = await api.resendInvite(invite.id);
      const to = made.sentTo ?? invite.sentTo ?? "";
      const url = made.url || `${window.location.origin}${made.path}`;
      // The new link is shown above when no link is on screen, and when the one on screen was
      // this invitation's (which just stopped working). When the mail failed and the link above
      // is another invitation's, it is shown in the new invitation's own row, so nothing the
      // person may still need to copy is replaced without asking.
      if (link === null || link.id === invite.id) {
        setLink({
          id: made.id,
          url,
          role: made.role,
          sentTo: made.sentTo,
          mail: made.mail,
        });
        setByHand(false);
      } else if (made.mail === "failed") {
        setRowLinks((was) => ({ ...was, [made.id]: url }));
      }
      setSaid(resentWords(to, made.mail));
    } catch (err) {
      setSaid(err instanceof ApiFailure ? inviteFailure(err.code, err.message) : message(err));
    } finally {
      await reload();
      if (live.current) setResending(null);
    }
  }

  const mailed = link?.sentTo ? link : null;
  return (
    <>
      <section className="settings-block members" aria-labelledby="invite-h">
        <h2 id="invite-h">Invite someone</h2>
        <div className="invite-box">
          <form onSubmit={(e) => void make(e)} noValidate className="invite-form">
            <div className="invite-line">
              <label htmlFor={ids.role}>They join as</label>
              <select
                id={ids.role}
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
              {mailOn !== true && (
                <ActionButton
                  type="submit"
                  className="primary"
                  disabled={busy || offline !== undefined}
                >
                  <Icon icon={Link2} size="sm" /> Make an invite link
                </ActionButton>
              )}
            </div>
            {mailOn === true && (
              <>
                <div className="invite-send">
                  <label htmlFor={ids.address}>
                    Send it to <span className="muted">(optional)</span>
                  </label>
                  <input
                    id={ids.address}
                    ref={addressField}
                    type="email"
                    autoComplete="off"
                    placeholder="name@example.org"
                    value={address}
                    aria-invalid={addressError ? true : undefined}
                    aria-describedby={addressError ? ids.error : ids.help}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setAddressError(null);
                    }}
                  />
                  <small id={ids.help} className="muted">
                    We email the link, and you still get it here to copy.
                  </small>
                  {addressError && (
                    <small id={ids.error} className="field-error" role="alert">
                      {addressError}
                    </small>
                  )}
                </div>
                <p className="muted invite-once">
                  The link works once and for 7 days. <b>Anyone who opens it can join with it</b>,
                  whoever you send it to.
                </p>
                <div className="invite-line">
                  <ActionButton
                    type="submit"
                    className="primary"
                    disabled={busy || offline !== undefined}
                  >
                    <Icon icon={typed ? Mail : Link2} size="sm" />{" "}
                    {typed ? "Send the invite" : "Make the link"}
                  </ActionButton>
                </div>
              </>
            )}
            {mailOn === false && (
              <p className="muted invite-once invite-nomail">
                <Icon icon={Mail} size="sm" />
                <span>{NO_MAIL}</span>
              </p>
            )}
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {link && (
            <div className="invite-made" role="group" aria-label="The invite link">
              {mailed && link.mail === "sent" && (
                <p className="invite-sent" role="status">
                  <Icon icon={Check} size="sm" />
                  <span>
                    Sent to <b>{mailed.sentTo}</b>.
                  </span>
                </p>
              )}
              {mailed && link.mail === "failed" && (
                <p className="invite-failed" role="status">
                  <Icon icon={Mail} size="sm" />
                  <span>
                    <b>We made the link but could not send the email to {mailed.sentTo}.</b> Copy it
                    and send it yourself, or press Resend in the list below to try again.
                  </span>
                </p>
              )}
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
              <p className="muted invite-once">{inviteNote(link.role, mailOn)}</p>
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
              {alive.map((w) => {
                const sent = mailOn ? sentLine(w) : null;
                const who = w.createdBy.name || "an owner";
                return (
                  <li key={w.id} className="member-row invite-row">
                    <Icon icon={w.sentTo && mailOn ? Mail : Link2} />
                    <span className="member-who">
                      <b>A link for one {ROLE_NAMES[w.role].toLowerCase()}</b>
                      <small>
                        {sent ? `${sent} · ` : ""}Made by {who} · not used yet · {timeLeft(w.left)}
                      </small>
                    </span>
                    {w.sentTo && mailOn && (
                      <ActionButton
                        type="button"
                        className="quiet"
                        disabled={cancelling !== null || resending !== null}
                        aria-busy={resending === w.id || undefined}
                        aria-label={`Resend the invitation to ${w.sentTo}, with a new link`}
                        onClick={() => void resend(w)}
                      >
                        {resending === w.id ? "Sending…" : "Resend"}
                      </ActionButton>
                    )}
                    <ActionButton
                      type="button"
                      className="quiet"
                      disabled={cancelling !== null || resending !== null}
                      aria-busy={cancelling === w.id || undefined}
                      aria-label={`Cancel the link for one ${ROLE_NAMES[w.role].toLowerCase()}, made by ${who}`}
                      onClick={() => void cancel(w)}
                    >
                      {cancelling === w.id ? "Cancelling…" : "Cancel it"}
                    </ActionButton>
                    {rowLinks[w.id] && (
                      <div className="invite-rowlink" role="group" aria-label="The new invite link">
                        <p className="invite-failed" role="status">
                          <Icon icon={Mail} size="sm" />
                          <span>
                            <b>We made a new link but could not send the email to {w.sentTo}.</b>{" "}
                            Copy it and send it yourself.
                          </span>
                        </p>
                        <span className="linkbox" data-testid="invite-row-link">
                          {rowLinks[w.id]}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
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
