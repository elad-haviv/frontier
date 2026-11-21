import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure } from "../api.ts";
import { useRefresh, useStatus } from "./Shell.tsx";

/** Asks the AI for the dates and type the entry's published text states. Shown only when AI is set up. */
export function ProposeFields({ path }: { path: string }) {
  const status = useStatus();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ made: number } | { error: string } | null>(null);

  if (!status?.ai.on) return null;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.proposeFields(path));
      refresh();
    } catch (err) {
      setResult({ error: err instanceof ApiFailure ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="propose">
      <button type="button" className="plain" disabled={busy} onClick={run}>
        {busy ? "Reading the entry…" : "Propose fields"}
      </button>
      {result && "error" in result && <span className="error"> {result.error}</span>}
      {result && "made" in result && (
        <span className="muted">
          {" "}
          {result.made === 0 ? (
            "Nothing new to propose."
          ) : (
            <>
              {result.made} proposed. <Link to="/inbox">Decide in the inbox</Link>
            </>
          )}
        </span>
      )}
    </p>
  );
}
