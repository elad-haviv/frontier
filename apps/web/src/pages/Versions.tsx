import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiFailure } from "../api.ts";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { Diff } from "../components/Diff.tsx";

/** Two versions of one draft, typed on two devices. The author combines them. */
export function VersionsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ current: string; other: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = useRef("");

  useEffect(() => {
    api.versions(id).then(
      (v) => {
        text.current = v.current.text;
        setData({ current: v.current.text, other: v.other.text });
      },
      (err: unknown) => setError(err instanceof ApiFailure ? err.message : "Could not load."),
    );
  }, [id]);

  if (error) return <p className="center error">{error}</p>;
  if (!data) return <p className="center muted">Loading…</p>;

  return (
    <article className="entry wide">
      <header className="entry-head">
        <h1>Two versions</h1>
        <p className="muted lede">
          This draft was changed on two devices. Edit the text below until it holds what you want
          from both.
        </p>
      </header>
      <h3>The other device's version, compared with the one below</h3>
      <Diff before={data.current} after={data.other} />
      <h3>The version to keep</h3>
      <div className="boxed">
        <CodeEditor initial={data.current} onChange={(t) => (text.current = t)} />
      </div>
      <p className="plan-actions">
        <button
          type="button"
          className="primary big"
          onClick={() =>
            api.mergeVersions(id, text.current).then(
              () => navigate("/unpublished"),
              (err: unknown) =>
                setError(err instanceof ApiFailure ? err.message : "Could not save."),
            )
          }
        >
          Keep this text
        </button>
      </p>
    </article>
  );
}
