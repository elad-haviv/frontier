import { useMemo } from "react";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { LaneCanvas } from "./LaneCanvas.tsx";
import { type Worked, spanName } from "./model.ts";
import { type OrderSizes, layoutOrder } from "./orderLayout.ts";

const ACROSS: OrderSizes = { unit: 150, pad: 16, gap: 120, eventBefore: 10, eventAfter: 150 };
const DOWN: OrderSizes = { unit: 64, pad: 12, gap: 64, eventBefore: 22, eventAfter: 26 };

export interface ViewProps {
  chronicle: ChronicleFile;
  worked: Worked;
  selected: string | null;
  onSelect: (id: string) => void;
  /** True on a phone: time runs down the page and one lane is open. */
  narrow: boolean;
  openLane: string;
  onOpenLane: (id: string) => void;
}

/** Spans listed under their lane, for those a view has no place for. */
export function LooseSpans(p: {
  title: string;
  chronicle: ChronicleFile;
  spans: readonly ChronicleSpan[];
  selected: string | null;
  onSelect: (id: string) => void;
  detail?: (span: ChronicleSpan) => string;
}) {
  if (p.spans.length === 0) return null;
  return (
    <section className="ch-loose" aria-label={p.title}>
      <h3>{p.title}</h3>
      {p.chronicle.lanes.map((lane) => {
        const mine = p.spans.filter((s) => s.lane === lane.id);
        if (mine.length === 0) return null;
        return (
          <p key={lane.id}>
            <span className="ch-loose-lane" style={{ color: lane.color }}>
              {lane.name}
            </span>
            {mine.map((s) => (
              <button
                key={s.id}
                type="button"
                data-span={s.id}
                className={"ch-chip" + (p.selected === s.id ? " is-selected" : "")}
                onClick={() => p.onSelect(s.id)}
              >
                {s.point ? "◆ " : ""}
                {spanName(s)}
                {p.detail ? ` · ${p.detail(s)}` : ""}
              </button>
            ))}
          </p>
        );
      })}
    </section>
  );
}

/** Spans in the order the author stated, lane by lane. Widths come from ranks, never lengths. */
export function OrderView(p: ViewProps) {
  const { chronicle, worked, narrow } = p;
  const byId = useMemo(() => new Map(chronicle.spans.map((s) => [s.id, s])), [chronicle.spans]);
  const sizes = narrow ? DOWN : ACROSS;
  const layout = useMemo(
    () =>
      layoutOrder(
        worked.order,
        new Set(chronicle.spans.filter((s) => s.point).map((s) => s.id)),
        chronicle.lanes.map((l) => l.id),
        sizes,
      ),
    [worked.order, chronicle.spans, chronicle.lanes, sizes],
  );
  const notOrdered = worked.order.notOrdered
    .map((id) => byId.get(id))
    .filter((s): s is ChronicleSpan => s !== undefined);

  return (
    <div className="ch-order">
      <p className="ch-note muted">Order only, not to scale.</p>
      {layout.spans.length === 0 && (
        <p className="empty">
          {chronicle.spans.length === 0
            ? "Nothing here yet. Add a span or an event."
            : "No order stated yet. Select a span and say how it relates to another."}
        </p>
      )}
      {layout.spans.length > 0 && (
        <LaneCanvas
          lanes={chronicle.lanes}
          spans={layout.spans}
          tracks={layout.tracks}
          length={layout.length}
          gaps={layout.blocks.slice(0, -1).map((b) => ({ at: b.at + b.length, size: sizes.gap }))}
          eventRoom={ACROSS.eventAfter}
          nameOf={(id) => spanName(byId.get(id) ?? { name: "" })}
          markOf={(id) => worked.marks.get(id)}
          selected={p.selected}
          onSelect={p.onSelect}
          narrow={narrow}
          openLane={p.openLane}
          onOpenLane={p.onOpenLane}
        />
      )}
      <LooseSpans
        title="Not ordered yet"
        chronicle={chronicle}
        spans={notOrdered}
        selected={p.selected}
        onSelect={p.onSelect}
      />
    </div>
  );
}
