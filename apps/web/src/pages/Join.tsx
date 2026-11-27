import type { JoinInfo } from "@frontier/schema";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { rememberJoined } from "../access.ts";
import { keysOwner } from "../aiKeys.ts";
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
  | { state: "ready"; info: JoinInfo; person: { id: string; name: string; email: string } | null }
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
  load: loadAddress = (to) => window.location.assign(to),
}: {
  code: string;
  /**
   * Loads an address afresh, the whole app again. Used after a session was started here, so
   * nothing the browser still holds for someone logged in before can be used by the new person:
   * their AI keys, their queue, their list of projects.
   */
  load?: ((to: string) => void) | undefined;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  // The reason a Google trip came back is said once, and taken off the address.
  const [problem] = useState(() => new URLSearchParams(location.search).get("problem"));
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("problem")) return;
    void navigate(
      { pathname: location.pathname, search: "", hash: location.hash },
      { replace: true },
    );
  }, []);

  useEffect(() => {
    document.title =
      load.state === "ready"
        ? `Join ${load.info.project.name} · Frontier`
        : "Invitation · Frontier";
  }, [load]);

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

  /**
   * In: the project opens. A session started here (a new account, or a login) is followed by a
   * full load of the project, never by moving inside this page: the app that is running may be
   * the one of someone who was logged in before. Someone who was logged in already and is not
   * the person the app is set up for (the session changed in another tab) gets the same.
   */
  async function done(
    slug: string,
    role: string,
    project: string,
    started: boolean,
    already = false,
  ) {
    const there = `/p/${encodeURIComponent(slug)}`;
    const words = `You joined ${project} as ${withArticle(role)}.`;
    const person = load.state === "ready" ? load.person : null;
    const otherPerson = person !== null && keysOwner() !== null && keysOwner() !== person.id;
    if (started || otherPerson) {
      if (!already) rememberJoined(words);
      loadAddress(there);
      return;
    }
    void loadProjects();
    // Someone who was in the project already is simply taken to it.
    if (!already) toast({ message: words });
    void navigate(there, { replace: true });
  }

  /** The link stopped working while the page was open: the page says so, as on opening it. */
  function dead(failure: ApiFailure) {
    setLoad({ state: "dead", code: failure.code, inviter: failure.inviter });
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
            onDead={dead}
            reload={loadAddress}
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
  onDead,
  reload,
}: {
  code: string;
  info: JoinInfo;
  person: { id: string; name: string; email: string } | null;
  problem: string | null;
  onJoined: (
    slug: string,
    role: string,
    project: string,
    started: boolean,
    already?: boolean,
  ) => Promise<void>;
  onDead: (failure: ApiFailure) => void;
  reload: (to: string) => void;
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
  const [error, setError] = useState<string | null>(googleProblem(problem));
  // Why the page turned into a login form, when it did by itself.
  const [switched, setSwitched] = useState<string | null>(
    problem === "account_exists" ? ACCOUNT_EXISTS : null,
  );
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const logout = useLogoutAction(`/join/${code}`);
  const accepted = useRef(false);
  const ids = { name: useId(), email: useId(), password: useId() };
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // A passkey is made by the browser: without it there is nothing to offer.
  const passkeys = browserSupportsWebAuthn();
  // Focus goes somewhere sensible when the page changes: the login form's first field on its own
  // (see `LoginToJoin`), the name when the person comes back to joining.
  const comingBack = useRef(false);
  useEffect(() => {
    if (mode === "join" && comingBack.current) {
      comingBack.current = false;
      nameField.current?.focus();
    }
  }, [mode]);

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
      if (err instanceof ApiFailure && deadLink(err.code, err.inviter)) {
        onDead(err);
        return;
      }
      setBusy(null);
      const failure = err instanceof ApiFailure ? err : null;
      setError(
        joinFailure(failure?.code ?? "", failure?.message ?? "Joining did not work. Try again."),
      );
    }
  }

  /**
   * What the name and email must be before any way of joining is tried. The first field that is
   * not right is said (and announced) beside it and takes the focus.
   */
  function check(needPassword: boolean): boolean {
    const found: typeof fieldErrors = {};
    if (typedName.trim() === "") found.name = "Give your name.";
    if (email.trim() === "") found.email = "Give your email.";
    else if (!EMAIL.test(email.trim())) found.email = "This is not an email address.";
    if (needPassword && password.length < 12) found.password = "Use at least 12 characters.";
    setFieldErrors(found);
    const first = found.name
      ? nameField
      : found.email
        ? emailField
        : found.password
          ? passwordField
          : null;
    first?.current?.focus();
    return Object.keys(found).length === 0;
  }

  /** A way of joining failed: the words, or the sign that this email has an account. */
  function failed(err: unknown, fallback: string) {
    setBusy(null);
    if (err instanceof ApiFailure && err.code === "account_exists") {
      // The page turns into the login form: it says why, and keeps the name and email typed.
      setError(null);
      setSwitched(ACCOUNT_EXISTS);
      setMode("login");
      return;
    }
    if (err instanceof ApiFailure && err.code === "already_member" && err.project) {
      void onJoined(err.project, role, name, false, true);
      return;
    }
    if (err instanceof ApiFailure && deadLink(err.code, err.inviter)) {
      // The link died while the form was open: the page says so.
      onDead(err);
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

  /**
   * Enter in the name or the email moves on, and does not join with a password nobody has typed:
   * to the next field that is empty (the password last).
   */
  function enter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || password !== "") return;
    e.preventDefault();
    const next =
      typedName.trim() === "" ? nameField : email.trim() === "" ? emailField : passwordField;
    next.current?.focus();
  }

  /**
   * Log in with the existing account, then take the invitation into it. A session was started
   * here, so whatever happens next the app is loaded afresh: the project when it worked, this
   * page again (which now knows who is logged in, and shows a dead link as one) when it did not.
   */
  async function logInAndAccept(how: () => Promise<unknown>) {
    setBusy("login");
    setError(null);
    try {
      await how();
    } catch (err) {
      setBusy(null);
      setError(
        err instanceof ApiFailure
          ? joinFailure(err.code, err.message)
          : "That did not work. Try again.",
      );
      return;
    }
    try {
      const joined = await api.acceptInvite(code);
      await onJoined(joined.project, joined.role, name, true);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "already_member" && err.project) {
        await onJoined(err.project, role, name, true, true);
        return;
      }
      reload(`/join/${encodeURIComponent(code)}`);
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
        notice={switched}
        google={info.google}
        passkeysHere={passkeys}
        onBack={() => {
          comingBack.current = true;
          setMode("join");
          setError(null);
          setSwitched(null);
        }}
        onLogin={(how) => void logInAndAccept(how)}
        keyNote={keyNote}
      />
    );
  }

  const invalid = (field: "name" | "email" | "password") => (fieldErrors[field] ? true : undefined);
  return (
    <>
      {head}
      <form className="login-form join-form" onSubmit={(e) => void withPassword(e)} noValidate>
        <label htmlFor={ids.name}>Your name</label>
        <input
          id={ids.name}
          ref={nameField}
          autoComplete="name"
          value={typedName}
          aria-invalid={invalid("name")}
          aria-describedby={fieldErrors.name ? `${ids.name}-e` : undefined}
          onChange={(e) => setTypedName(e.target.value)}
          onKeyDown={enter}
        />
        {fieldErrors.name && (
          <em id={`${ids.name}-e`} className="field-error" role="alert">
            {fieldErrors.name}
          </em>
        )}
        <label htmlFor={ids.email}>Email</label>
        <input
          id={ids.email}
          ref={emailField}
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={invalid("email")}
          aria-describedby={fieldErrors.email ? `${ids.email}-e` : undefined}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={enter}
        />
        {fieldErrors.email && (
          <em id={`${ids.email}-e`} className="field-error" role="alert">
            {fieldErrors.email}
          </em>
        )}
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
        {passkeys && (
          <button
            type="button"
            className="login-passkey"
            disabled={busy !== null}
            onClick={() => void withPasskey()}
          >
            <Icon icon={Fingerprint} size="md" />
            {busy === "passkey" ? "Waiting for your device…" : "Join with a passkey on this device"}
          </button>
        )}
        <p className="login-or">or with a password</p>
        <label htmlFor={ids.password}>Password</label>
        <input
          id={ids.password}
          ref={passwordField}
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={invalid("password")}
          aria-describedby={`${ids.password}-e`}
          onChange={(e) => setPassword(e.target.value)}
        />
        <em
          id={`${ids.password}-e`}
          className={fieldErrors.password ? "field-error" : "muted"}
          role={fieldErrors.password ? "alert" : undefined}
        >
          {fieldErrors.password ?? "At least 12 characters."}
        </em>
        {problemLine}
        <button type="submit" className="secondary" disabled={busy !== null}>
          {busy === "password" ? "Joining…" : `Join ${name}`}
        </button>
      </form>
      <p className="muted join-note">
        Have an account?{" "}
        <button
          type="button"
          className="join-link"
          onClick={() => {
            setSwitched(null);
            setMode("login");
          }}
        >
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
  notice,
  google,
  passkeysHere,
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
  /** Why this form is here, when the page turned into it by itself. */
  notice: string | null;
  google: boolean;
  passkeysHere: boolean;
  onBack: () => void;
  onLogin: (how: () => Promise<unknown>) => void;
  keyNote: React.ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [ways, setWays] = useState({ passkeys: false, password: true });
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password }),
      () => undefined,
    );
  }, []);
  // The form's first field has the focus when it appears, and again if the ways in change which
  // one that is.
  useEffect(() => {
    const first =
      root.current?.querySelector<HTMLElement>("input") ??
      root.current?.querySelector<HTMLElement>("button.login-passkey, button.join-google");
    first?.focus();
  }, [ways.password, ways.passkeys]);
  const showPasskey = ways.passkeys && passkeysHere;
  return (
    <div ref={root} className="join-login">
      {head}
      {notice && (
        <p className="join-switched" role="status">
          {notice}
        </p>
      )}
      <p>Log in with your account, and this invitation goes into it. Nothing is made twice.</p>
      {showPasskey && (
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
    </div>
  );
}
