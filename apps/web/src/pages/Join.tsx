import type { JoinInfo } from "@frontier/schema";
import { Fingerprint } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure, googleStartUrl } from "../api.ts";
import { useLogoutAction } from "../components/useLogoutAction.ts";
import { Icon } from "../components/ui/Icon.tsx";
import { ProjectMark } from "../components/ui/ProjectMark.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { ROLE_NAMES } from "../components/projectContext.ts";
import { loadProjects } from "../projects.ts";
import { Link, useLocation, useNavigate } from "../nav.tsx";
import { withArticle } from "./settings/membersModel.ts";
import {
  ACCOUNT_EXISTS,
  AI_KEY_NOTE,
  deadLink,
  googleProblem,
  inviteHeading,
  joinFailure,
  projectCounts,
  ROLE_ALLOWS,
} from "./joinModel.ts";
import "./Join.css";

type Load =
  | { state: "loading" }
  | { state: "ready"; info: JoinInfo; person: { name: string; email: string } | null }
  | { state: "dead"; code: string; inviter: string | undefined }
  | { state: "failed"; code: string; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The page an invite link opens (`/join/<code>`, stage 27c): outside every project, and open to
 * someone who is not logged in. It says who invited you, to what and as what, and lets you join:
 * with a passkey on this device, with Google, or with an email and a password. A person who is
 * logged in joins with the account they have; one whose email already has an account is asked to
 * log in, and comes back to this link to accept it.
 */
export function JoinPage({
  code,
  onSignedIn,
}: {
  code: string;
  /** Called once a session was started here, so the app opens as logged in. */
  onSignedIn?: (() => void) | undefined;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const search = useLocation().search;
  const problem = new URLSearchParams(search).get("problem");

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    void (async () => {
      try {
        const [info, session] = await Promise.all([api.joinInfo(code), api.session()]);
        if (!live) return;
        setLoad({
          state: "ready",
          info,
          person: session.loggedIn && session.person ? session.person : null,
        });
      } catch (err) {
        if (!live) return;
        const failure = err instanceof ApiFailure ? err : new ApiFailure(0, "offline", "");
        if (deadLink(failure.code, failure.inviter)) {
          setLoad({ state: "dead", code: failure.code, inviter: failure.inviter });
        } else {
          setLoad({
            state: "failed",
            code: failure.code,
            message: joinFailure(failure.code, failure.message),
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [code, attempt]);

  /** In: the project opens. A session started here is told to the app first. */
  async function done(
    slug: string,
    role: string,
    project: string,
    started: boolean,
    already = false,
  ) {
    if (started) onSignedIn?.();
    else void loadProjects();
    // Someone who was in the project already is simply taken to it.
    if (!already) toast({ message: `You joined ${project} as ${withArticle(role)}.` });
    void navigate(`/p/${encodeURIComponent(slug)}`, { replace: true });
  }

  return (
    <main className="login join">
      <div className="login-card join-card">
        <Link to="/login" className="wordmark join-wordmark" aria-label="Frontier">
          Frontier
        </Link>
        {load.state === "loading" && <Progress label="Opening the invitation" />}
        {load.state === "dead" && <Dead load={load} />}
        {load.state === "failed" && (
          <>
            <h1 className="join-title">The invitation could not be opened</h1>
            <p className="error" role="alert">
              {load.message || "Check your connection, then try again."}
            </p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        )}
        {load.state === "ready" && (
          <Invitation
            code={code}
            info={load.info}
            person={load.person}
            problem={problem}
            onJoined={done}
          />
        )}
      </div>
    </main>
  );
}

/** A link that does not work, and what to do about it. */
function Dead({ load }: { load: Extract<Load, { state: "dead" }> }) {
  const words = deadLink(load.code, load.inviter)!;
  return (
    <>
      <h1 className="join-title">{words.title}</h1>
      <p role="status">{words.body}</p>
      <p className="muted join-note">
        Have an account? <Link to="/login">Log in</Link>.
      </p>
    </>
  );
}

function Invitation({
  code,
  info,
  person,
  problem,
  onJoined,
}: {
  code: string;
  info: JoinInfo;
  person: { name: string; email: string } | null;
  problem: string | null;
  onJoined: (
    slug: string,
    role: string,
    project: string,
    started: boolean,
    already?: boolean,
  ) => Promise<void>;
}) {
  const name = info.project.name;
  const role = info.role;
  const [mode, setMode] = useState<"join" | "login">(
    problem === "account_exists" ? "login" : "join",
  );
  const [typedName, setTypedName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "passkey" | "password" | "accept" | "login">(null);
  const [error, setError] = useState<string | null>(
    googleProblem(problem) ?? (problem === "account_exists" ? ACCOUNT_EXISTS : null),
  );
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const logout = useLogoutAction(`/join/${code}`);
  const accepted = useRef(false);
  const ids = { name: useId(), email: useId(), password: useId() };

  // Opened by someone already in the project: nothing to accept, the project opens.
  useEffect(() => {
    if (!info.alreadyMember || accepted.current) return;
    accepted.current = true;
    void accept();
    // Once, when the page is first drawn for this link.
  }, []);

  async function accept() {
    setBusy("accept");
    setError(null);
    try {
      const joined = await api.acceptInvite(code);
      await onJoined(joined.project, joined.role, name, false);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "already_member" && err.project) {
        void loadProjects();
        await onJoined(err.project, role, name, false, true).catch(() => undefined);
        return;
      }
      setBusy(null);
      const failure = err instanceof ApiFailure ? err : null;
      setError(
        joinFailure(failure?.code ?? "", failure?.message ?? "Joining did not work. Try again."),
      );
    }
  }

  /** What the name and email must be before any way of joining is tried. */
  function check(needPassword: boolean): boolean {
    const found: typeof fieldErrors = {};
    if (typedName.trim() === "") found.name = "Give your name.";
    if (email.trim() === "") found.email = "Give your email.";
    else if (!EMAIL.test(email.trim())) found.email = "This is not an email address.";
    if (needPassword && password.length < 12) found.password = "Use at least 12 characters.";
    setFieldErrors(found);
    return Object.keys(found).length === 0;
  }

  /** A way of joining failed: the words, or the sign that this email has an account. */
  function failed(err: unknown, fallback: string) {
    setBusy(null);
    if (err instanceof ApiFailure && err.code === "account_exists") {
      setError(null);
      setMode("login");
      return;
    }
    if (err instanceof ApiFailure && err.code === "already_member" && err.project) {
      void onJoined(err.project, role, name, false, true);
      return;
    }
    if (err instanceof ApiFailure && deadLink(err.code, err.inviter)) {
      // The link died while the form was open: the page says so.
      window.location.reload();
      return;
    }
    setError(err instanceof ApiFailure ? joinFailure(err.code, err.message) : fallback);
  }

  async function withPasskey() {
    setError(null);
    if (!check(false)) return;
    setBusy("passkey");
    try {
      const joined = await api.joinWithPasskey(code, {
        name: typedName.trim(),
        email: email.trim(),
      });
      await onJoined(joined.project, joined.role, name, true);
    } catch (err) {
      failed(err, "The passkey was not made. Try again, or join another way.");
    }
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!check(true)) return;
    setBusy("password");
    try {
      const joined = await api.joinWithPassword(code, {
        name: typedName.trim(),
        email: email.trim(),
        password,
      });
      await onJoined(joined.project, joined.role, name, true);
    } catch (err) {
      failed(err, "Joining did not work. Try again.");
    }
  }

  /** Log in with the existing account, then take the invitation into it. */
  async function logInAndAccept(how: () => Promise<unknown>) {
    setBusy("login");
    setError(null);
    try {
      await how();
      // The invitation goes into the account first; the app is told of the session with the move
      // into the project, so this page is not replaced while it is still working.
      const joined = await api.acceptInvite(code);
      await onJoined(joined.project, joined.role, name, true);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "already_member" && err.project) {
        await onJoined(err.project, role, name, true, true);
        return;
      }
      setBusy(null);
      setError(
        err instanceof ApiFailure
          ? joinFailure(err.code, err.message)
          : "That did not work. Try again.",
      );
    }
  }

  const head = (
    <>
      <span className="eyebrow join-eyebrow">Invitation</span>
      <h1 className="join-title">{inviteHeading(info.inviter.name, name, role)}</h1>
      <div className="join-project">
        <ProjectMark name={name} colour={info.project.colour} size="lg" />
        <span className="join-project-text">
          <b>{name}</b>
          <small className="muted">{projectCounts(info.project)}</small>
        </span>
        <span className={`project-role role-${role}`}>{ROLE_NAMES[role]}</span>
      </div>
      <p className="join-allows">{ROLE_ALLOWS[role]}</p>
    </>
  );
  const problemLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  const keyNote = <p className="muted join-note">{AI_KEY_NOTE}</p>;

  // Logged in already: join with this account (or log out to use another).
  if (person) {
    const who = person.name || person.email || "this account";
    return (
      <>
        {head}
        <p>
          You are logged in as <b>{who}</b>.
        </p>
        {problemLine}
        <button type="button" disabled={busy !== null} onClick={() => void accept()}>
          {busy === "accept" ? "Joining…" : `Join as ${who}`}
        </button>
        <p className="muted join-note">
          Someone else?{" "}
          <button type="button" className="join-link" onClick={logout}>
            Log out and use another account
          </button>
        </p>
        {keyNote}
      </>
    );
  }

  // An email that has an account: log in, and the invitation is taken into that account.
  if (mode === "login") {
    return (
      <LoginToJoin
        head={head}
        code={code}
        email={email}
        onEmail={setEmail}
        busy={busy === "login"}
        error={error}
        google={info.google}
        onBack={() => {
          setMode("join");
          setError(null);
        }}
        onLogin={(how) => void logInAndAccept(how)}
        keyNote={keyNote}
      />
    );
  }

  return (
    <>
      {head}
      <form className="login-form join-form" onSubmit={(e) => void withPassword(e)} noValidate>
        <label htmlFor={ids.name}>Your name</label>
        <input
          id={ids.name}
          autoComplete="name"
          value={typedName}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? `${ids.name}-e` : undefined}
          onChange={(e) => setTypedName(e.target.value)}
        />
        {fieldErrors.name && (
          <em id={`${ids.name}-e`} className="field-error">
            {fieldErrors.name}
          </em>
        )}
        <label htmlFor={ids.email}>Email</label>
        <input
          id={ids.email}
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? `${ids.email}-e` : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {fieldErrors.email && (
          <em id={`${ids.email}-e`} className="field-error">
            {fieldErrors.email}
          </em>
        )}
        <button
          type="button"
          className="login-passkey"
          disabled={busy !== null}
          onClick={() => void withPasskey()}
        >
          <Icon icon={Fingerprint} size="md" />
          {busy === "passkey" ? "Waiting for your device…" : "Join with a passkey on this device"}
        </button>
        {info.google && (
          <button
            type="button"
            className="secondary join-google"
            disabled={busy !== null}
            onClick={() => window.location.assign(googleStartUrl({ invite: code }))}
          >
            <span className="gm" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
        )}
        <p className="login-or">or with a password</p>
        <label htmlFor={ids.password}>Password</label>
        <input
          id={ids.password}
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={`${ids.password}-e`}
          onChange={(e) => setPassword(e.target.value)}
        />
        <em id={`${ids.password}-e`} className={fieldErrors.password ? "field-error" : "muted"}>
          {fieldErrors.password ?? "At least 12 characters."}
        </em>
        {problemLine}
        <button type="submit" className="secondary" disabled={busy !== null}>
          {busy === "password" ? "Joining…" : `Join ${name}`}
        </button>
      </form>
      <p className="muted join-note">
        Have an account?{" "}
        <button type="button" className="join-link" onClick={() => setMode("login")}>
          Log in to join
        </button>
      </p>
      {keyNote}
    </>
  );
}

/** The login form of the join page: the same ways as the login page, ending in the invitation. */
function LoginToJoin({
  head,
  code,
  email,
  onEmail,
  busy,
  error,
  google,
  onBack,
  onLogin,
  keyNote,
}: {
  head: React.ReactNode;
  code: string;
  email: string;
  onEmail: (email: string) => void;
  busy: boolean;
  error: string | null;
  google: boolean;
  onBack: () => void;
  onLogin: (how: () => Promise<unknown>) => void;
  keyNote: React.ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [ways, setWays] = useState({ passkeys: false, password: true });
  const id = useId();
  useEffect(() => {
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password }),
      () => undefined,
    );
  }, []);
  return (
    <>
      {head}
      <p role="status">
        Log in with your account, and this invitation goes into it. Nothing is made twice.
      </p>
      {ways.passkeys && (
        <button
          type="button"
          className="login-passkey"
          disabled={busy}
          onClick={() => onLogin(() => api.loginWithPasskey())}
        >
          <Icon icon={Fingerprint} size="md" />
          Use a passkey
        </button>
      )}
      {google && (
        <button
          type="button"
          className="secondary join-google"
          disabled={busy}
          onClick={() => window.location.assign(googleStartUrl({ invite: code }))}
        >
          <span className="gm" aria-hidden="true">
            G
          </span>
          Continue with Google
        </button>
      )}
      {ways.password && (
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(() => api.login(email, password));
          }}
        >
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
          />
          <label htmlFor={`${id}-password`}>Password</label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="secondary" disabled={busy || password === ""}>
            {busy ? "Checking…" : "Log in and join"}
          </button>
        </form>
      )}
      {!ways.password && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted join-note">
        New here?{" "}
        <button type="button" className="join-link" onClick={onBack}>
          Join with a new account
        </button>
      </p>
      {keyNote}
    </>
  );
}
