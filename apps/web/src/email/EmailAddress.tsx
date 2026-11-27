import type { MeResponse } from "@frontier/schema";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { loadMe } from "../me.ts";
import { ChangeAddress } from "./ChangeAddress.tsx";
import { mailFailure, mailState, NOT_SENT, SENT_AGAIN, type MailState } from "./emailModel.ts";
import "./email.css";

/** What the block says under an unconfirmed address, by what became of the latest link. */
export function unconfirmedWords(state: MailState): string {
  switch (state) {
    case "unsent":
      return "We have not sent a link to this address yet. Until you confirm it, we cannot be sure it is yours. You can still use Frontier.";
    case "failed":
      return "We could not send the link to this address. Try again. You can still use Frontier.";
    case "sending":
      return "A link is on its way to this address. Until you open it, we cannot be sure it is yours. You can still use Frontier.";
    default:
      return "We sent a link to this address. Until you open it, we cannot be sure it is yours. You can still use Frontier.";
  }
}

/**
 * Settings → You → Signing in → Email address (stage 28): the address, whether it is confirmed
 * (and by what), Resend, Change address, and a change that waits for its link. With mail off it is
 * the plain address and a Change address that applies at once.
 */
export function EmailAddress({ me }: { me: MeResponse }) {
  const info = me.emailInfo;
  const mailOn = info?.mailOn === true;
  const [changing, setChanging] = useState(false);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const change = useRef<HTMLButtonElement>(null);
  const comeBack = useRef(false);
  useEffect(() => {
    if (!changing && comeBack.current) {
      comeBack.current = false;
      change.current?.focus();
    }
  }, [changing]);

  const close = () => {
    comeBack.current = true;
    setChanging(false);
  };

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setSaid("");
    try {
      setSaid(await work());
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      setSaid(mailFailure(failure?.code ?? "", failure?.message ?? NOT_SENT));
    } finally {
      await loadMe();
      setBusy(false);
    }
  }
  const resend = () =>
    run(async () => ((await api.resendEmail()).mail === "failed" ? NOT_SENT : SENT_AGAIN));
  const cancelChange = () =>
    run(async () => {
      await api.cancelEmailChange();
      return "The change was cancelled.";
    });

  const none = me.email.trim() === "";
  const unconfirmed = mailOn && info?.status === "unconfirmed";
  const confirmed = mailOn && info?.status === "confirmed";
  const pending = mailOn ? (info?.pending ?? null) : null;
  const state = mailState(info?.sent ?? null);

  const changeButton = (label: string) => (
    <button
      ref={change}
      type="button"
      className="quiet"
      aria-expanded={changing}
      onClick={() => setChanging(true)}
    >
      {label}
    </button>
  );

  return (
    <>
      <h2>Email address</h2>
      <p className="muted">
        {mailOn
          ? "Used for invitations to you, password resets and notices about your account."
          : "What logging in asks for, and what a saved version carries as its author."}
      </p>
      <div className="email-block" data-testid="email-block">
        {none ? (
          <p>
            {info?.needsAddress
              ? "The address this account had now belongs to a Google sign-in that verified it. Add another, so Frontier can reach you."
              : "This account has no email address yet."}
          </p>
        ) : (
          <div className="email-line">
            <b>{me.email}</b>
            {unconfirmed && <span className="tag tag-unconfirmed">Unconfirmed</span>}
            {confirmed && (
              <span className="email-confirmed">
                <Icon icon={Check} size="sm" />
                {info?.confirmedBy === "google" ? "Confirmed by Google" : "Confirmed"}
              </span>
            )}
          </div>
        )}
        {unconfirmed && !pending && <p>{unconfirmedWords(state)}</p>}
        {confirmed && info?.confirmedBy === "google" && (
          <p className="muted">This is the address of your linked Google account.</p>
        )}
        {pending && (
          <div className="email-pending">
            <p>
              {mailState(pending.sent) === "failed" ? (
                <>
                  <b>We could not send the link to {pending.address}.</b> Your address stays{" "}
                  {me.email} until it is confirmed.
                </>
              ) : (
                <>
                  <b>Waiting for you to confirm {pending.address}.</b> We sent a link there, and
                  told {me.email} about the change. Until you open it, your address stays {me.email}
                  .
                </>
              )}
            </p>
          </div>
        )}
        {changing ? (
          <ChangeAddress
            me={me}
            mailOn={mailOn}
            adding={none}
            onCancel={close}
            onDone={(words) => {
              setSaid(words);
              close();
            }}
          />
        ) : (
          <div className="email-actions">
            {pending ? (
              <>
                <ActionButton
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  {mailState(pending.sent) === "failed" ? "Try again" : "Resend"}
                </ActionButton>
                <ActionButton
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => void cancelChange()}
                >
                  Cancel the change
                </ActionButton>
              </>
            ) : (
              <>
                {unconfirmed && (
                  <ActionButton
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => void resend()}
                  >
                    {state === "unsent"
                      ? "Send a link"
                      : state === "failed"
                        ? "Try again"
                        : "Resend link"}
                  </ActionButton>
                )}
                {changeButton(none ? "Add an address" : "Change address")}
              </>
            )}
          </div>
        )}
        <div className="email-said" role="status" aria-live="polite">
          {said}
        </div>
      </div>
    </>
  );
}
