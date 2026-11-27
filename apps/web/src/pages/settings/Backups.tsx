import { Link } from "../../nav.tsx";
import { api, libraryZipUrl } from "../../api.ts";
import { useCanWrite } from "../../components/projectContext.ts";
import { Problem } from "../../components/ui/Problem.tsx";
import { useAsync } from "../../useAsync.ts";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "never";

/** The last backup and its warning (the same as Status shows), with Export and Import. */
export function Backups() {
  const status = useAsync(() => api.status(), "settings-backups");
  const canWrite = useCanWrite();
  if (status.state === "loading") return <p className="muted">Loading…</p>;
  if (status.state === "failed")
    return <Problem reason={status.error.message} onRetry={status.retry} />;
  const s = status.value;
  return (
    <section className="settings-block">
      <dl className="facts">
        <dt>Last backup</dt>
        <dd>
          {when(s.lastBackupAt)}
          {s.backupError && <span className="error"> · {s.backupError}</span>}
        </dd>
      </dl>
      {s.library === "own" && !s.backupOutside && (
        <p className="banner" role="alert">
          The library lives on this server's disk and is backed up only to that same disk. Set up a
          storage bucket for backups, and export the library now and then.
        </p>
      )}
      <ul className="settings-links">
        <li>
          <Link to="/export">Export the library</Link>
          <span className="muted"> as Markdown files, a web page or a PDF.</span>
        </li>
        <li>
          <a href={libraryZipUrl()}>Download the whole library</a>
          <span className="muted"> as a zip of the vault.</span>
        </li>
        {canWrite && (
          <li>
            <Link to="/import">Import</Link>
            <span className="muted"> notes and pictures into the library.</span>
          </li>
        )}
      </ul>
    </section>
  );
}
