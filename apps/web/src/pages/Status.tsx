import { Link } from "react-router-dom";
import { api, entryUrl } from "../api.ts";
import { useAsync } from "../useAsync.ts";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StatusPage() {
  const data = useAsync(() => Promise.all([api.status(), api.attention()]), "status");
  if (data.state === "loading") return <p className="center muted">Loading…</p>;
  if (data.state === "failed") return <p className="center error">{data.error.message}</p>;
  const [s, a] = data.value;

  return (
    <article className="entry">
      <header className="entry-head">
        <h1>Status</h1>
      </header>
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

      <h2>Needs your attention</h2>
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
