import type { ConfirmResponse } from "@frontier/schema";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { Progress } from "../components/ui/Progress.tsx";
import { loadMe } from "../me.ts";
import { useNavigate } from "../nav.tsx";
import { homeProject, useProjects } from "../projects.ts";
import { MailPage } from "./MailPage.tsx";
import { mailFailure, NOT_SENT } from "./emailModel.ts";
import "./email.css";

/**
 * What the page asked the server about each link, kept for a few seconds in memory (never in
 * storage). In development React runs the page's effect twice; both runs share one request, so the
 * link is used once and a second answer ("already confirmed") never replaces the first.
 */
const asked = new Map<string, Promise<ConfirmResponse>>();
const KEEP_MS = 10_000;

export function confirmOnce(
  code: string,
  call: (code: string) => Promise<ConfirmResponse> = api.confirmEmail,
): Promise<ConfirmResponse> {
  let answer = asked.get(code);
  if (!answer) {
    answer = call(code);
    asked.set(code, answer);
    const forget = () => void setTimeout(() => asked.delete(code), KEEP_MS);
    answer.then(forget, () => asked.delete(code));
  }
  return answer;
}

type Load =
  | { state: "loading" }
  | { state: "done"; answer: ConfirmResponse }
  | { state: "dead" }
  | { state: "failed"; message: string };

/**
 * `/confirm/<code>`: the page the link in the confirm email opens, for someone logged in or not
 * (stage 32). It uses the link when it loads, and says one thing with one button. It never starts
 * or changes a session. The code stays in the address and nowhere else.
 */
export function ConfirmPage({
  code,
  loggedIn,
  confirm = confirmOnce,
}: {
  code: string;
  loggedIn: boolean;
  confirm?: ((code: string) => Promise<ConfirmResponse>) | undefined;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const { list } = useProjects();
  const project = homeProject(list);

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    confirm(code).then(
      (answer) => {
        if (!live) return;
        setLoad({ state: "done", answer });
        // The banner learns that the address is confirmed.
        if (loggedIn) void loadMe();
      },
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

  const toApp = () => void navigate("/", { replace: true });

  if (load.state === "loading") {
    return (
      <MailPage eyebrow="Email" title="Confirming your email" busy title_="Confirming">
        <Progress label="Confirming your email" />
      </MailPage>
    );
  }
  if (load.state === "failed") {
    return (
      <MailPage eyebrow="Email" title="The link could not be checked" title_="Confirm your email">
        <p className="error" role="alert">
          {load.message}
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </MailPage>
    );
  }
  if (load.state === "dead") return <Dead loggedIn={loggedIn} onOpen={toApp} />;

  const { status, you } = load.answer;
  const [eyebrow, title, body] =
    status === "already_confirmed"
      ? [
          "Already confirmed",
          "This address is already confirmed",
          "It was confirmed earlier. You are all set.",
        ]
      : status === "changed"
        ? [
            "Address changed",
            "Your email address was changed",
            "The new address is confirmed and now the one on your account.",
          ]
        : [
            "Email confirmed",
            "Your email address is confirmed",
            "Thank you. There is nothing else to do.",
          ];
  return (
    <MailPage eyebrow={eyebrow} title={title} mark={Check} title_="Email confirmed">
      <p role="status">{body}</p>
      {you ? (
        <button type="button" onClick={toApp}>
          {project ? `Open ${project.name}` : "Open Frontier"}
        </button>
      ) : loggedIn ? (
        <button type="button" onClick={toApp}>
          Open Frontier
        </button>
      ) : (
        <button type="button" onClick={() => void navigate("/login")}>
          Log in
        </button>
      )}
    </MailPage>
  );
}

/** A link that has run out, was used, or was replaced: log in, and press Resend for a new one. */
function Dead({ loggedIn, onOpen }: { loggedIn: boolean; onOpen: () => void }) {
  const navigate = useNavigate();
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    setSaid("");
    try {
      const result = await api.resendEmail();
      setSaid(
        result.mail === "failed"
          ? NOT_SENT
          : "Sent. Check your inbox and spam. The new link works once, for 24 hours.",
      );
      void loadMe();
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      setSaid(mailFailure(failure?.code ?? "", failure?.message ?? NOT_SENT));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MailPage
      eyebrow="Link not working"
      title="This link has expired or was already used"
      mark={X}
      bad
      title_="Link not working"
    >
      <p>
        Confirmation links work once and for 24 hours.{" "}
        {loggedIn
          ? "Send yourself a new one."
          : "Log in, then press Resend in the banner at the top of the page, or under Settings, Signing in. A new link is on its way."}
      </p>
      {loggedIn ? (
        <>
          <button type="button" disabled={busy} onClick={() => void resend()}>
            Send a new link
          </button>
          <button type="button" className="secondary" onClick={onOpen}>
            Open Frontier
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void navigate("/login")}>
          Log in
        </button>
      )}
      <p className="mail-said" role="status" aria-live="polite">
        {said}
      </p>
    </MailPage>
  );
}
