import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "../nav.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import "./email.css";

/**
 * The card the pages of a link in an email share (stage 32): outside the shell, centred, one
 * short message and one button, the same on a phone and on a desktop. The heading takes the focus
 * when the answer is in, so a screen reader reads it.
 */
export function MailPage({
  eyebrow,
  title,
  mark,
  bad = false,
  busy = false,
  title_,
  children,
}: {
  eyebrow: string;
  title: string;
  mark?: LucideIcon;
  /** The mark is the colour of a problem. */
  bad?: boolean;
  /** Still waiting for the answer: the focus is not taken yet. */
  busy?: boolean;
  /** The document title, when it should differ from the heading. */
  title_?: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title_ ?? title} · Frontier`;
    if (!busy) heading.current?.focus();
  }, [title, title_, busy]);
  return (
    <main className="login mail-page">
      <div className="login-card mail-card">
        <Link to="/login" className="wordmark" aria-label="Frontier">
          Frontier
        </Link>
        {mark && (
          <span className={`mail-mark${bad ? " is-bad" : ""}`}>
            <Icon icon={mark} size="lg" />
          </span>
        )}
        <span className="mail-eyebrow">{eyebrow}</span>
        <h1 ref={heading} className="mail-title" tabIndex={-1}>
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
