import { diffLines, diffWordsWithSpace } from "diff";
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

export interface WordPart {
  kind: "add" | "del" | "same";
  text: string;
}

/**
 * What changed between two passages, word by word, and the share of their words that changed
 * (0 to 1), which decides whether a suggestion opens showing its changes or its clean text.
 */
export function wordChanges(before: string, after: string): { parts: WordPart[]; share: number } {
  const parts: WordPart[] = diffWordsWithSpace(before, after).map((p) => ({
    kind: p.added ? "add" : p.removed ? "del" : "same",
    text: p.value,
  }));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  let changed = 0;
  let same = 0;
  for (const p of parts) {
    if (p.kind === "same") same += words(p.text);
    else changed += words(p.text);
  }
  return { parts, share: changed + same === 0 ? 0 : changed / (changed + same) };
}

/** A passage's changes word by word, set as prose: removed words struck, new ones marked. */
export function WordDiff({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "add" ? (
          <ins key={i}>{p.text}</ins>
        ) : p.kind === "del" ? (
          <del key={i}>{p.text}</del>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
