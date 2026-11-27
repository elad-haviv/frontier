import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { Link, useLocation } from "../nav.tsx";
import { MailPage } from "./MailPage.tsx";
import {
  BAD_ADDRESS,
  isJoinPath,
  looksLikeEmail,
  mailFailure,
  rememberInvitation,
} from "./emailModel.ts";
import "./email.css";

/**
 * `/forgot-password`: one field, then the same answer for every address (stage 28). A person with
 * only a passkey or Google, and a stranger's address, read exactly what a person with a password
 * reads: the difference is in the inbox. Coming from an invitation's login form, the invitation's
 * address is remembered for an hour, so the link in the email can bring the person back to it.
 */
export function ForgotPage() {
  const location = useLocation();
  const from = (location.state as { from?: string; email?: string } | null) ?? {};
  const [address, setAddress] = useState(typeof from.email === "string" ? from.email : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<"ask" | "sent" | "off">("ask");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const back = isJoinPath(from.from) ? from.from : undefined;

  // Without mail there is nothing to send: the page says so instead of asking.
  useEffect(() => {
    let live = true;
    api.session().then(
      (s) => live && !s.mail && setState("off"),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (state === "ask") field.current?.focus();
  }, [state]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(address)) {
      setProblem(BAD_ADDRESS);
      field.current?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await api.forgotPassword(address.trim());
      rememberInvitation(back);
      setState("sent");
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "mail_off") setState("off");
      else
        setProblem(
          err instanceof ApiFailure
            ? err.code === "invalid"
              ? BAD_ADDRESS
              : mailFailure(err.code, err.message)
            : "That did not work. Check your connection and try again.",
        );
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <p className="mail-back">
      <Link to="/login" {...(back ? { state: { from: back } } : {})}>
        Back to log in
      </Link>
    </p>
  );

  if (state === "off") {
    return (
      <MailPage
        eyebrow="Forgot password"
        title="This server cannot send email"
        mark={Mail}
        title_="Forgot password"
      >
        <p>
          A forgotten password cannot be reset by email here. Ask whoever runs this server to set a
          new one.
        </p>
        {backLink}
      </MailPage>
    );
  }
  if (state === "sent") {
    return (
      <MailPage
        eyebrow="Check your email"
        title="If that address has an account, we sent a link"
        mark={Mail}
        title_="Check your email"
      >
        <p role="status">
          It works once and for 30 minutes. If nothing comes, look in spam, or try again in a
          minute.
        </p>
        <button
          type="button"
          className="mail-link"
          onClick={() => {
            setState("ask");
            setAddress("");
          }}
        >
          Use another address
        </button>
        {backLink}
      </MailPage>
    );
  }
  return (
    <MailPage eyebrow="Forgot password" title="Reset your password" busy>
      <p>Enter the address you log in with. We will email you a link.</p>
      <form className="login-form" onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={id}>Email</label>
        <input
          id={id}
          ref={field}
          type="email"
          autoComplete="email"
          value={address}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-e` : undefined}
          onChange={(e) => {
            setAddress(e.target.value);
            setProblem(null);
          }}
        />
        {problem && (
          <p id={`${id}-e`} className="error" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send the link"}
        </button>
      </form>
      {backLink}
    </MailPage>
  );
}
