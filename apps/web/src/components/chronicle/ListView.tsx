import type { CSSProperties } from "react";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { formatYears } from "@frontier/time";
import { type Worked, spanName } from "./model.ts";
import { centuryOf, whenText } from "./timelineLayout.ts";

interface Item {
  span: ChronicleSpan;
  /** Where it sorts: its earliest start, or −∞ for an open start; null with no dates. */
  at: number | null;
}

/** Every event in order of start, under headings by century, with the map year between them. */
export function listOf(
  chronicle: ChronicleFile,
  worked: Worked,
): { head: string; items: Item[] }[] {
  const items: Item[] = chronicle.spans.map((span) => {
    const p = worked.points.get(span.id);
    const at = p?.start?.lo ?? p?.end?.lo ?? null;
    return { span, at: at === null || Number.isNaN(at) ? null : at };
  });
  const placed = items
    .filter((i) => i.at !== null)
    .sort(
      (a, b) => a.at! - b.at! || chronicle.spans.indexOf(a.span) - chronicle.spans.indexOf(b.span),
    );
  const groups: { head: string; items: Item[] }[] = [];
  for (const item of placed) {
    const head = item.at === -Infinity ? "Older than anything shown" : centuryOf(item.at!);
    const last = groups.at(-1);
    if (last?.head === head) last.items.push(item);
    else groups.push({ head, items: [item] });
  }
  const none = items.filter((i) => i.at === null);
  if (none.length > 0) groups.push({ head: "No dates yet", items: none });
  return groups;
}

/** The List view: the best way to read a chronicle on a phone, and an alternative to the chart. */
export function ListView(p: {
  chronicle: ChronicleFile;
  worked: Worked;
  selected: string | null;
  onSelect: (id: string) => void;
  mapYear: number | null;
}) {
  const groups = listOf(p.chronicle, p.worked);
  const lane = (s: ChronicleSpan) => p.chronicle.lanes.find((l) => l.id === s.lane);
  let marked = p.mapYear === null;
  const marker = (key: string) => (
    <li key={key} className="ch-list-mapyear" aria-label={`Maps show year ${p.mapYear}`}>
      <span>Maps: year {formatYears(p.mapYear!, p.mapYear!)}</span>
    </li>
  );

  if (p.chronicle.spans.length === 0) {
    return <p className="empty ch-list-empty">No events yet. Add one with + Add.</p>;
  }
  return (
    <div className="ch-listview">
      {groups.map((g) => (
        <section key={g.head}>
          <h3>{g.head}</h3>
          <ul>
            {g.items.map((item) => {
              const before =
                !marked && item.at !== null && p.mapYear !== null && item.at > p.mapYear;
              if (before) marked = true;
              const l = lane(item.span);
              return [
                before ? marker(`m-${item.span.id}`) : null,
                <li key={item.span.id}>
                  <button
                    type="button"
                    className={`ch-list-item${p.selected === item.span.id ? " is-selected" : ""}`}
                    style={{ "--lane": l?.color ?? "var(--accent)" } as CSSProperties}
                    onClick={() => p.onSelect(item.span.id)}
                  >
                    <span className="ch-list-when">
                      {whenText(item.span, p.worked.points.get(item.span.id))}
                    </span>
                    <span className="ch-list-name">
                      <i
                        className={`tl-kind-dot${item.span.point ? " is-moment" : ""}`}
                        aria-hidden="true"
                      />
                      {spanName(item.span)}
                      {p.worked.marks.get(item.span.id) === "red" && (
                        <span className="tl-red" aria-label="Doesn't fit">
                          {" "}
                          ⚠
                        </span>
                      )}
                      <span className="muted"> · {l?.name}</span>
                    </span>
                  </button>
                </li>,
              ];
            })}
          </ul>
        </section>
      ))}
      {!marked && <ul>{marker("m-end")}</ul>}
    </div>
  );
}
