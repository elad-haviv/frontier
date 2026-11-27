import { type ReactNode } from "react";
import { entryUrl } from "../api.ts";
import { Link, useLocation } from "../nav.tsx";
import { ROLE_NAMES, useProject, useRole } from "./projectContext.ts";
import { currentEntryPath } from "./shell/entryPath.ts";
import { Progress } from "./ui/Progress.tsx";
import { useUnsent } from "../sync/queue.ts";
import { showUnsent } from "./unsentPanel.ts";
import "./ProjectScope.css";

/**
 * A page that changes the project (the editor, unsaved changes, the inbox, import, two texts to
 * compare): opened by a reader, by an address typed or kept, it says what the role allows and
 * where to read instead, in place of a page that could only fail (stage 31c). While the role is
 * not known yet it shows neither the page nor the notice.
 */
export function WriterOnly({ what, children }: { what: string; children: ReactNode }) {
  const { known, canWrite, role } = useRole();
  const project = useProject();
  const { pathname } = useLocation();
  const unsent = useUnsent();
  if (!known) return <Progress label="Opening" />;
  if (canWrite) return <>{children}</>;
  const entry = currentEntryPath(pathname);
  const name = entry ? (entry.split("/").pop() ?? entry).replace(/\.md$/i, "") : "";
  // Text typed here that the server has not taken: it is kept on this device, and said so.
  const kept = entry !== "" && unsent.some((r) => r.key === `entry:${entry}`);
  return (
    <div className="project-note" role="status">
      <h1>You can read this, not change it</h1>
      <p>
        You are {role === "owner" ? "an" : "a"} {ROLE_NAMES[role ?? "reader"]} in {project.name}.
        Only writers and owners can {what}. An owner can change your role in Settings, under
        Members.
      </p>
      {kept && (
        <p role="alert">
          <b>
            Your last changes to {name} were not saved, because your role changed while you were
            writing.
          </b>{" "}
          They are still kept on this device. Copy the text from{" "}
          <button type="button" className="plain" onClick={showUnsent}>
            Not sent yet
          </button>
          , or leave it there until an owner makes you a writer again.
        </p>
      )}
      <p className="project-note-actions">
        {entry && (
          <Link to={entryUrl(entry)} className="primary">
            Read {name}
          </Link>
        )}
        <Link to="/">Back to Home</Link>
      </p>
    </div>
  );
}
