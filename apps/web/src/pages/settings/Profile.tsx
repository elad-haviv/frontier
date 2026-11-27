import { type FormEvent, useEffect, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { Avatar } from "../../components/ui/Avatar.tsx";
import { missing, noteMe, useMe } from "../../me.ts";
import { NoMe } from "./NoMe.tsx";

/** What the browser can say before the server does: the same rules as the server's. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkProfile(name: string, email: string): { name?: string; email?: string } {
  const problems: { name?: string; email?: string } = {};
  if (name.trim() === "") problems.name = "Give a name.";
  else if (name.trim().length > 80) problems.name = "Use 80 characters or fewer.";
  if (email.trim() === "") problems.email = "Give an email.";
  else if (!EMAIL.test(email.trim())) problems.email = "This is not an email address.";
  return problems;
}

/** Your name and email: how others see you, what saved versions carry, and what logging in asks for. */
export function Profile() {
  const me = useMe();
  const [name, setName] = useState(me?.name ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [problems, setProblems] = useState<{
    name?: string | undefined;
    email?: string | undefined;
    form?: string | undefined;
  }>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // The form starts from the account once it is known, and from nothing the person already typed.
  const [started, setStarted] = useState(me !== null);
  useEffect(() => {
    if (me && !started) {
      setName(me.name);
      // An account with no email is offered the commit author's, to be saved only if they say so.
      setEmail(me.email || me.suggestedEmail);
      setStarted(true);
    }
  }, [me, started]);

  if (!me) return <NoMe />;

  const changed = name.trim() !== me.name || email.trim() !== me.email;

  async function save(e: FormEvent) {
    e.preventDefault();
    const found = checkProfile(name, email);
    setProblems(found);
    setSaved(false);
    if (found.name || found.email) return;
    setBusy(true);
    try {
      const next = await api.saveProfile({ name: name.trim(), email: email.trim() });
      noteMe(next);
      setName(next.name);
      setEmail(next.email);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "email_taken")
        setProblems({ email: err.message });
      else
        setProblems({
          form: err instanceof ApiFailure ? err.message : "The profile was not saved. Try again.",
        });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block">
      <p className="muted">
        Your name and email are what logging in asks for, and what a saved version carries as its
        author.
      </p>
      {me.needsProfile && (
        <p className="banner" role="status">
          Add your {missing(me.name, me.email)}. Until then, saved versions carry the author set on
          the server.
        </p>
      )}
      <form onSubmit={save} noValidate>
        <p className="profile-who">
          <Avatar name={name} email={email} />
          <span className="muted">{me.admin ? "The first account on this server" : "Account"}</span>
        </p>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            aria-invalid={problems.name ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
              setProblems((p) => ({ ...p, name: undefined }));
            }}
          />
          {problems.name && <em className="field-error">{problems.name}</em>}
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={problems.email ? true : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
              setProblems((p) => ({ ...p, email: undefined }));
            }}
          />
          {problems.email && <em className="field-error">{problems.email}</em>}
        </label>
        {problems.form && (
          <p className="field-error" role="alert">
            {problems.form}
          </p>
        )}
        <p className="change-actions">
          <ActionButton type="submit" className="primary" disabled={busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </ActionButton>
          {saved && (
            <span className="field-ok" role="status">
              Saved.
            </span>
          )}
        </p>
      </form>
    </section>
  );
}
