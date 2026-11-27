import { Check, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { Progress } from "../components/ui/Progress.tsx";
import { useNavigate } from "../nav.tsx";
import { MailPage } from "./MailPage.tsx";
import { mailFailure, PASSWORD_MIN, passwordCount, takeInvitation } from "./emailModel.ts";
import "./email.css";

type Load =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "dead" }
  | { state: "done" }
  | { state: "failed"; message: string };

/**
 * `/reset/<code>`: the page the link in the reset email opens (stage 32). It checks the link when
 * it loads (a GET, which uses nothing up), takes a new password of 12 or more characters with a
 * live count, and says that other devices were logged out. Nobody is logged in by it. The code
 * stays in the address and nowhere else.
 */
export function ResetPage({ code, loggedIn }: { code: string; loggedIn: boolean }) {
  const [load, setLoad] = useState<Load>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ state: "checking" });
    api.checkReset(code).then(
      () => live && setLoad({ state: "ready" }),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiFailure && err.code === "link_invalid") setLoad({ state: "dead" });
        else
          setLoad({
            state: "failed",
            message:
              err instanceof ApiFailure
                ? mailFailure(err.code, err.message)
                : "Check your connection, then try again.",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [code, attempt]);

  if (load.state === "checking") {
    return (
      <MailPage eyebrow="Reset password" title="Checking the link" busy title_="Reset password">
        <Progress label="Checking the link" />
      </MailPage>
    );
  }
  if (load.state === "failed") {
    return (
      <MailPage eyebrow="Reset password" title="The link could not be checked">
        <p className="error" role="alert">
          {load.message}
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </MailPage>
    );
  }
  if (load.state === "dead") return <Expired />;
  if (load.state === "done") return <Done loggedIn={loggedIn} />;
  return (
    <NewPassword
      code={code}
      onDone={() => setLoad({ state: "done" })}
      onDead={() => setLoad({ state: "dead" })}
    />
  );
}

function NewPassword({
  code,
  onDone,
  onDead,
}: {
  code: string;
  onDone: () => void;
  onDead: () => void;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => field.current?.focus(), []);
  const valid = password.length >= PASSWORD_MIN;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.resetPassword(code, password);
      setPassword("");
      onDone();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "link_invalid") {
        onDead();
        return;
      }
      setProblem(
        err instanceof ApiFailure
          ? mailFailure(err.code, err.message)
          : "That did not work. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <MailPage eyebrow="Reset password" title="Choose a new password" busy title_="Reset password">
      <p>At least 12 characters. You will be logged out on your other devices.</p>
      <form className="login-form" onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={id}>New password</label>
        <input
          id={id}
          ref={field}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          aria-describedby={`${id}-count`}
          onChange={(e) => {
            setPassword(e.target.value);
            setProblem(null);
          }}
        />
        <p id={`${id}-count`} className="mail-hint" data-testid="password-count">
          {passwordCount(password.length)}
        </p>
        <label className="mail-show">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show the password
        </label>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" disabled={!valid || busy}>
          {busy ? "Setting…" : "Set the password"}
        </button>
      </form>
    </MailPage>
  );
}

/** A reset link that has run out or was used: a new one is asked for on the page before. */
function Expired() {
  const navigate = useNavigate();
  return (
    <MailPage
      eyebrow="Link not working"
      title="This link has expired or was already used"
      mark={X}
      bad
      title_="Link not working"
    >
      <p>Reset links work once and for 30 minutes. Ask for a new one; it takes a moment.</p>
      <button type="button" onClick={() => void navigate("/forgot-password")}>
        Ask for a new link
      </button>
    </MailPage>
  );
}

/**
 * The password is set and the other devices are logged out. The person logs in again, and an
 * invitation they asked from is opened after, if this browser remembers one.
 */
function Done({ loggedIn }: { loggedIn: boolean }) {
  const navigate = useNavigate();
  const logIn = () => {
    const back = takeInvitation();
    // A browser that was logged in has a session the reset just ended: load the app afresh.
    if (loggedIn) window.location.assign(back ?? "/login");
    else void navigate("/login", back ? { state: { from: back } } : undefined);
  };
  return (
    <MailPage eyebrow="Done" title="Your password is changed" mark={Check}>
      <p role="status">We logged you out everywhere else. Log in with the new password.</p>
      <button type="button" onClick={logIn}>
        Log in
      </button>
    </MailPage>
  );
}
