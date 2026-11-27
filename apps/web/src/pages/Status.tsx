import { Link } from "../nav.tsx";
import { api, entryUrl, libraryZipUrl } from "../api.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useAsync } from "../useAsync.ts";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StatusPage() {
  const data = useAsync(() => Promise.all([api.status(), api.attention()]), "status");
  if (data.state === "loading") return <p className="center muted">Loading…</p>;
  if (data.state === "failed") {
    return (
      <div className="center">
        <Problem reason={data.error.message} onRetry={data.retry} />
      </div>
    );
  }
  const [s, a] = data.value;

  return (
    <article className="entry">
      {data.reloading && <Progress />}
      <header className="entry-head">
        <h1>Status</h1>
      </header>
      {data.error && <Problem reason={data.error.message} onRetry={data.retry} />}
      <dl className="facts">
        <dt>Vault last fetched</dt>
        <dd>{when(s.lastFetchAt)}</dd>
        <dt>Index built from commit</dt>
        <dd>
          <code>{s.indexCommit?.slice(0, 10) ?? "none"}</code>
          {s.indexStale && <span className="error"> · out of date</span>}
        </dd>
        <dt>Last publish</dt>
        <dd>{when(s.lastPushAt)}</dd>
        <dt>Last backup</dt>
        <dd>
          {when(s.lastBackupAt)}
          {s.backupError && <span className="error"> · {s.backupError}</span>}
        </dd>
        <dt>Unpublished changes</dt>
        <dd>{s.unpublished}</dd>
      </dl>

      {s.library === "own" && !s.backupOutside && (
        <p className="banner" role="alert">
          The library lives on this server's disk and is backed up only to that same disk. Set up a
          storage bucket for backups, and export the library now and then.{" "}
          <a href={libraryZipUrl()}>Export the library</a>
        </p>
      )}
      {s.problems.map((p) => (
        <p key={p} className="banner" role="alert">
          {p}
        </p>
      ))}
      <h2>Needs your attention</h2>
      <Section title="Texts from other devices to compare" empty="None.">
        {a.versions.map((v) => (
          <li key={v.draftId}>
            <Link to={`/versions/${v.draftId}`}>{v.path}</Link>
            <span className="muted">
              : {v.count} {v.count === 1 ? "text" : "texts"} kept beside the draft
            </span>
          </li>
        ))}
      </Section>
      <Section title="Links that match more than one file" empty="None.">
        {a.ambiguousLinks.map((l, i) => (
          <li key={i}>
            <Link to={entryUrl(l.path)}>{l.path}</Link>: <code>{l.raw}</code>
            <span className="muted"> could be {l.candidates.join(" or ")}</span>
          </li>
        ))}
      </Section>
      <Section title="Image names used more than once" empty="None.">
        {a.duplicateImages.map((group, i) => (
          <li key={i}>{group.join(" · ")}</li>
        ))}
      </Section>
      <Section title="Unresolved links in append-only files" empty="None.">
        {a.brokenAppendixLinks.map((l, i) => (
          <li key={i}>
            <Link to={entryUrl(l.path)}>{l.path}</Link>: <code>{l.raw}</code>
          </li>
        ))}
      </Section>
      <Section title="Files that mix two kinds of line endings (read-only)" empty="None.">
        {a.mixedEndings.map((p) => (
          <li key={p}>
            <Link to={entryUrl(p)}>{p}</Link>
          </li>
        ))}
      </Section>
      <Section title="Fields that cannot be read" empty="None.">
        {a.unreadableFields.map((f) => (
          <li key={f.path}>
            <Link to={entryUrl(f.path)}>{f.path}</Link>
            <span className="muted">: {f.problems.join(" ")}</span>
          </li>
        ))}
      </Section>
      <Section title="The same id in two entries" empty="None.">
        {a.duplicateIds.map((d) => (
          <li key={d.id}>
            <code>{d.id}</code>: {d.paths.join(" · ")}
          </li>
        ))}
      </Section>
      <Section title="Notes that almost share their folder's name" empty="None.">
        {a.nearFolderNotes.map((p) => (
          <li key={p}>
            <Link to={entryUrl(p)}>{p}</Link>
          </li>
        ))}
      </Section>
    </article>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="attention">
      <h3>
        {title} <span className="count">{children.length}</span>
      </h3>
      {children.length === 0 ? <p className="muted">{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}
