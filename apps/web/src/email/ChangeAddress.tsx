import type { MeResponse } from "@frontier/schema";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { withRecentLogin } from "../components/LoginDialog.tsx";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { loadMe } from "../me.ts";
import { BAD_ADDRESS, looksLikeEmail, mailFailure, NEED_PASSWORD } from "./emailModel.ts";
import "./email.css";

/** Whether the account has a password that works, which Change address asks for. */
export const passwordWorks = (me: MeResponse): boolean => me.passwordSet && !me.passwordOff;

/** What a change of address said, for the place that asked to say it in its own words. */
export function changeWords(
  result: { applied: boolean; mail: "sent" | "failed" | "off" },
  address: string,
  old: string,
): string {
  if (result.applied) {
    if (result.mail === "off") return `Your address is now ${address}.`;
    return result.mail === "sent"
      ? `We sent a link to ${address}. Open it to confirm.`
      : `Your address is now ${address}, but we could not send the link. Press Resend to try again.`;
  }
  return result.mail === "sent"
    ? `We sent a link to ${address}. Your address stays ${old} until you open it.`
    : `We could not send the link to ${address}. Your address stays ${old}. Press Resend to try again.`;
}

/**
 * The form that changes, or first adds, the address (the banner's and Settings'). With mail on a
 * link goes to the new address and the old one stays until it is opened; with mail off the change
 * applies at once. It asks for the current password when the account has one that works, and for
 * a login from the last few minutes when it has not (the dialog for that opens by itself).
 */
export function ChangeAddress({
  me,
  mailOn,
  adding = false,
  onDone,
  onCancel,
}: {
  me: MeResponse;
  mailOn: boolean;
  /** The account has no address yet: the form says "Add" and not "Change". */
  adding?: boolean;
  onDone: (words: string) => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{
    field: "address" | "password" | "form";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const addressField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const ids = { address: useId(), password: useId(), help: useId(), error: useId() };
  const needsPassword = passwordWorks(me);
  // The first field has the focus when the form opens.
  useEffect(() => addressField.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const typed = address.trim();
    if (!looksLikeEmail(typed)) {
      setProblem({ field: "address", text: BAD_ADDRESS });
      addressField.current?.focus();
      return;
    }
    if (needsPassword && password === "") {
      setProblem({ field: "password", text: NEED_PASSWORD });
      passwordField.current?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const result = await withRecentLogin(() =>
        api.changeEmail(typed, needsPassword ? password : undefined),
      );
      await loadMe();
      onDone(changeWords(result, typed, me.email));
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      const text = mailFailure(
        failure?.code ?? "",
        failure?.message ?? "That did not work. Try again.",
      );
      // A wrong password is said under the password; the rest under the address.
      const field =
        failure?.code === "invalid" && /password/i.test(failure.message)
          ? "password"
          : failure?.code === "email_taken" || failure?.code === "invalid"
            ? "address"
            : "form";
      setProblem({ field, text });
      setBusy(false);
      (field === "password" ? passwordField : addressField).current?.focus();
    }
  }

  function keys(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onCancel();
  }

  const help = adding
    ? mailOn
      ? "We send a link to this address. Open it to confirm."
      : "The address applies at once."
    : mailOn
      ? `Your address stays ${me.email} until you open the link we send to the new one. We also tell ${me.email} about the change.`
      : "The change applies at once.";
  return (
    <form className="change-address" onSubmit={(e) => void submit(e)} onKeyDown={keys} noValidate>
      <label htmlFor={ids.address}>{adding ? "Your address" : "New address"}</label>
      <input
        id={ids.address}
        ref={addressField}
        type="email"
        autoComplete="email"
        placeholder="name@example.org"
        value={address}
        aria-invalid={problem?.field === "address" ? true : undefined}
        aria-describedby={problem?.field === "address" ? ids.error : ids.help}
        onChange={(e) => {
          setAddress(e.target.value);
          setProblem(null);
        }}
      />
      {needsPassword && (
        <>
          <label htmlFor={ids.password}>Your password</label>
          <input
            id={ids.password}
            ref={passwordField}
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={problem?.field === "password" ? true : undefined}
            aria-describedby={problem?.field === "password" ? ids.error : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
          />
        </>
      )}
      <small id={ids.help}>{help}</small>
      {problem && (
        <small id={ids.error} className="field-error" role="alert">
          {problem.text}
        </small>
      )}
      <div className="change-address-buttons">
        <ActionButton type="submit" className="primary" disabled={busy}>
          {busy
            ? "Sending…"
            : mailOn
              ? adding
                ? "Send a link"
                : "Send a link to the new address"
              : adding
                ? "Add the address"
                : "Change the address"}
        </ActionButton>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
