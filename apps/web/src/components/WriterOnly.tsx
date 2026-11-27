import { type ReactNode } from "react";
import { entryUrl } from "../api.ts";
import { Link, useLocation } from "../nav.tsx";
import { ROLE_NAMES, useProject, useRole } from "./projectContext.ts";
import { currentEntryPath } from "./shell/entryPath.ts";
import { Progress } from "./ui/Progress.tsx";
import "./ProjectScope.css";

/**
 * A page that changes the project (the editor, unsaved changes, the inbox, import, two texts to
 * compare): opened by a reader, by an address typed or kept, it says what the role allows and
 * where to read instead, in place of a page that could only fail (stage 27c). While the role is
 * not known yet it shows neither the page nor the notice.
 */
export function WriterOnly({ what, children }: { what: string; children: ReactNode }) {
  const { known, canWrite, role } = useRole();
  const project = useProject();
  const { pathname } = useLocation();
  if (!known) return <Progress label="Opening" />;
  if (canWrite) return <>{children}</>;
  const entry = currentEntryPath(pathname);
  const name = entry ? (entry.split("/").pop() ?? entry).replace(/\.md$/i, "") : "";
  return (
    <div className="project-note" role="status">
      <h1>You can read this, not change it</h1>
      <p>
        You are {role === "owner" ? "an" : "a"} {ROLE_NAMES[role ?? "reader"]} in {project.name}.
        Only writers and owners can {what}. An owner can change your role in Settings, under
        Members.
      </p>
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
