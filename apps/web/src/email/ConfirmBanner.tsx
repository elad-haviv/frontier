import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { loadMe, useMe } from "../me.ts";
import { connection } from "../sync/connection.ts";
import { ChangeAddress } from "./ChangeAddress.tsx";
import { bannerLead, bannerView, mailFailure, NOT_SENT, SENT_AGAIN } from "./emailModel.ts";
import "./email.css";

/** How often the banner asks again while it is shown: another device may have opened the link. */
const AGAIN_MS = 30_000;

/**
 * "Confirm your email: we sent a link to ..." above every page, with Resend and Change address
 * (stage 28). It has no close button and goes by itself once the address is confirmed, which it
 * learns by asking again when the person comes back to the tab, when the connection says things
 * may have changed, and every half minute. It is never drawn with mail off.
 */
export function ConfirmBanner() {
  const me = useMe();
  const view = bannerView(me?.emailInfo, me?.email ?? "");
  const shown = view !== null;
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const change = useRef<HTMLButtonElement>(null);
  const comeBack = useRef(false);

  useEffect(() => {
    if (!shown) return;
    let last = Date.now();
    const again = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < 5000) return;
      last = Date.now();
      void loadMe();
    };
    const stop = connection.onAccessMayHaveChanged(again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const timer = window.setInterval(again, AGAIN_MS);
    return () => {
      stop();
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      window.clearInterval(timer);
    };
  }, [shown]);

  // Closing the form puts the focus back on the button that opened it.
  useEffect(() => {
    if (!changing && comeBack.current) {
      comeBack.current = false;
      change.current?.focus();
    }
  }, [changing]);

  if (!me || !view) return null;

  async function resend() {
    setBusy(true);
    setSaid("");
    try {
      const result = await api.resendEmail();
      setSaid(result.mail === "failed" ? NOT_SENT : SENT_AGAIN);
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      setSaid(mailFailure(failure?.code ?? "", failure?.message ?? NOT_SENT));
    } finally {
      await loadMe();
      setBusy(false);
    }
  }

  async function cancelChange() {
    setBusy(true);
    setSaid("");
    try {
      await api.cancelEmailChange();
      setSaid("The change was cancelled.");
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      setSaid(
        mailFailure(failure?.code ?? "", failure?.message ?? "That did not work. Try again."),
      );
    } finally {
      await loadMe();
      setBusy(false);
    }
  }

  const close = () => {
    comeBack.current = true;
    setChanging(false);
  };

  let words;
  let actions;
  if (view.kind === "add") {
    words = (
      <p>
        <b>Add an email address:</b> the one this account had now belongs to a Google sign-in that
        verified it. Add another, so Frontier can reach you.
      </p>
    );
    actions = (
      <button
        ref={change}
        type="button"
        className="mail-link"
        onClick={() => setChanging(true)}
        aria-expanded={changing}
      >
        Add an address
      </button>
    );
  } else {
    const a = <b>{view.address}</b>;
    const line =
      view.state === "unsent" ? (
        <>we have not sent a link to {a} yet.</>
      ) : view.state === "failed" ? (
        <>we could not send the link to {a}.</>
      ) : view.state === "sending" ? (
        <>we are sending a link to {a}.</>
      ) : (
        <>we sent a link to {a}.</>
      );
    words = (
      <p>
        <b>{bannerLead(view)}</b> {line}
        {view.pending && <> Your address stays {view.current} until you open it.</>}
      </p>
    );
    const label =
      view.state === "unsent" ? "Send a link" : view.state === "failed" ? "Try again" : "Resend";
    actions = (
      <>
        <ActionButton
          type="button"
          className="mail-link"
          disabled={busy}
          onClick={() => void resend()}
        >
          {label}
        </ActionButton>
        {view.pending ? (
          <ActionButton
            type="button"
            className="mail-link"
            disabled={busy}
            onClick={() => void cancelChange()}
          >
            Cancel the change
          </ActionButton>
        ) : (
          <button
            ref={change}
            type="button"
            className="mail-link"
            onClick={() => setChanging(true)}
            aria-expanded={changing}
          >
            Change address
          </button>
        )}
      </>
    );
  }

  return (
    <aside className="confirm-banner" aria-label="Email address">
      <Icon icon={Mail} />
      <div className="confirm-banner-body">
        {words}
        {changing ? (
          <ChangeAddress
            me={me}
            mailOn
            adding={view.kind === "add"}
            onCancel={close}
            onDone={(text) => {
              setSaid(text);
              close();
            }}
          />
        ) : (
          <div className="confirm-banner-actions">{actions}</div>
        )}
        <div className="confirm-banner-said" role="status" aria-live="polite">
          {said}
        </div>
      </div>
    </aside>
  );
}
