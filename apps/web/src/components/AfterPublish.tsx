import type { AfterPublishStep } from "@frontier/schema";
import { Dices } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { entryUrl } from "../api.ts";
import { openRandom } from "../keepGoing/random.ts";
import { stepWords } from "../keepGoing/strip.ts";
import { Icon } from "./ui/Icon.tsx";
import { useToast } from "./ui/Toast.tsx";
import { useWriteIt } from "./WriteIt.tsx";
import "./AfterPublish.css";

/** How long the nudge stays when nothing is pressed, in milliseconds. */
export const NUDGE_MS = 10_000;

/** Keys that only move the focus or hold a modifier; they do not mean "I am going on". */
const QUIET_KEYS = new Set(["Tab", "Shift", "Control", "Alt", "Meta"]);

/**
 * What follows "Published." (stage 25): up to three next steps from what was just published. It
 * goes away after ten seconds or on the first key pressed, though a key that only moves the focus
 * (Tab) or is pressed on the nudge itself does not count, so it can be reached from the keyboard.
 * A name asked for stays open as the New entry dialog, whatever the nudge does.
 */
export function AfterPublish({
  steps,
  verb,
}: {
  steps: readonly AfterPublishStep[];
  /** "Published" in a shared library; "Saved" in one of Frontier's own. */
  verb: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { write, dialog } = useWriteIt();
  const [shown, setShown] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = () => setShown(false);
    const timer = window.setTimeout(away, NUDGE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (QUIET_KEYS.has(e.key) || box.current?.contains(e.target as Node)) return;
      away();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function roll() {
    try {
      const found = await openRandom(navigate, { kind: "old" });
      if (!found) toast({ message: "No entry has gone untouched for six months." });
    } catch {
      toast({ message: "A random entry could not be found." });
    }
  }

  return (
    <>
      {shown && (
        <div className="banner banner-ok nudge" role="status" ref={box}>
          <p className="nudge-head">
            <b>{verb}.</b> Keep going?
          </p>
          <ul className="nudge-steps">
            {steps.map((step) => {
              const words = stepWords(step);
              return (
                <li key={step.kind} className={`nudge-${step.kind}`}>
                  <span className="nudge-words">
                    {words.lead}
                    {step.kind === "stub" && <Link to={entryUrl(step.path)}>{words.name}</Link>}
                    {step.kind === "missing" && (
                      <span className="link-unresolved" title="No entry yet">
                        {words.name}
                      </span>
                    )}
                    {words.tail}
                  </span>
                  {step.kind === "stub" && (
                    <button
                      type="button"
                      className="quiet nudge-go"
                      onClick={() => navigate(entryUrl(step.path))}
                    >
                      Open
                    </button>
                  )}
                  {step.kind === "missing" && (
                    <button
                      type="button"
                      className="quiet nudge-go"
                      onClick={() => write({ name: step.name, folder: step.folder })}
                    >
                      Write it
                    </button>
                  )}
                  {step.kind === "old" && (
                    <button type="button" className="quiet nudge-go" onClick={() => void roll()}>
                      <Icon icon={Dices} size="sm" /> Roll
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted nudge-foot">Shown for 10 seconds, or until you start typing.</p>
        </div>
      )}
      {dialog}
    </>
  );
}
