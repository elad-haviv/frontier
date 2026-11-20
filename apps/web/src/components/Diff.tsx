import { diffLines } from "diff";
import { useMemo } from "react";

/** Shows what changed between two texts, line by line, with unchanged stretches folded. */
export function Diff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => {
    const out: { kind: "add" | "del" | "same" | "gap"; text: string }[] = [];
    for (const part of diffLines(before, after)) {
      const lines = part.value.replace(/\n$/, "").split("\n");
      if (part.added) for (const l of lines) out.push({ kind: "add", text: l });
      else if (part.removed) for (const l of lines) out.push({ kind: "del", text: l });
      else if (lines.length <= 4) for (const l of lines) out.push({ kind: "same", text: l });
      else {
        out.push({ kind: "same", text: lines[0]! });
        out.push({ kind: "gap", text: `${lines.length - 2} unchanged lines` });
        out.push({ kind: "same", text: lines[lines.length - 1]! });
      }
    }
    return out;
  }, [before, after]);

  if (before === after) return <p className="muted">No difference.</p>;
  return (
    <pre className="diff">
      {rows.map((r, i) => (
        <span key={i} className={`diff-${r.kind}`}>
          <span className="diff-mark" aria-hidden="true">
            {r.kind === "add" ? "+" : r.kind === "del" ? "−" : r.kind === "gap" ? "⋯" : " "}
          </span>
          {r.text || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
