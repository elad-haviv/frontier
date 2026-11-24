import { useState } from "react";
import { api } from "../../api.ts";
import { Problem } from "../../components/ui/Problem.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { useAsync } from "../../useAsync.ts";

/** The types and `what` names fields use: the vault's own list or the built-in one. */
export function Types() {
  const schema = useAsync(() => api.schema(), "schema");
  const [copied, setCopied] = useState(false);
  if (schema.state === "loading") return <p className="muted">Loading…</p>;
  if (schema.state === "failed")
    return <Problem reason={schema.error.message} onRetry={schema.retry} />;
  const s = schema.value;
  return (
    <section className="settings-block">
      {schema.reloading && <Progress />}
      <p className="muted">
        {s.builtIn ? (
          <>
            Frontier's built-in list is in use. To change it, save this text in the vault as{" "}
            <code>.frontier/schema.yaml</code> and edit it there.
          </>
        ) : (
          <>
            The list comes from <code>.frontier/schema.yaml</code> in the vault.
          </>
        )}
      </p>
      {s.problem && <p className="error">{s.problem}</p>}
      <p>
        {s.types.length} types, {s.what.length} names for dates.
      </p>
      <details>
        <summary>Show the list</summary>
        {s.builtIn && (
          <p>
            <button
              type="button"
              className="quiet"
              onClick={() =>
                void navigator.clipboard?.writeText(s.text).then(
                  () => setCopied(true),
                  () => undefined,
                )
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </p>
        )}
        <pre className="schema-text">{s.text}</pre>
      </details>
    </section>
  );
}
