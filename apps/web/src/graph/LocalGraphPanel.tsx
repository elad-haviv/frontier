/**
 * An entry's Graph tab: the entry ringed in the middle with its neighbours around it (depth 1, or
 * 2 by the switch), drawn by the graph screen's own canvas, with the same hover, select and open.
 * Under the drawing, the neighbours as links are the keyboard's and screen reader's way. Loaded
 * only when the tab is opened, so an entry page that never opens it loads none of the graph.
 */
import { byName } from "@frontier/schema";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { entryUrl } from "../api.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { colourNameOf, folderColour, useTheme } from "./colours.ts";
import { useGraphData } from "./data.ts";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { Layout } from "./layout.ts";
import { describeNode, neighbourhood } from "./model.ts";
import { readDepth, writeDepth } from "./settings.ts";
import { SelectionCard } from "./SelectionCard.tsx";
import "./LocalGraphPanel.css";

/**
 * The last local graph's picture, kept for the visit: coming back to the same entry shows it
 * settled, and the depth switch or a refetch restarts it warm. Another entry starts afresh.
 */
let kept: { path: string; layout: Layout } | null = null;
function layoutFor(path: string): Layout {
  if (kept?.path !== path) kept = { path, layout: new Layout() };
  return kept.layout;
}

const ARRIVAL = { focus: null, view: null };

function fullGraphUrl(path: string): string {
  return `/graph?focus=${encodeURIComponent(path)}`;
}

export default function LocalGraphPanel({ path }: { path: string }) {
  const data = useGraphData();
  const navigate = useNavigate();
  const theme = useTheme();
  const [depth, setDepth] = useState(readDepth);
  const [selected, setSelected] = useState<number | null>(null);
  const { model } = data;
  const shown = useMemo(
    () => (model ? neighbourhood(model, path, depth) : null),
    [model, path, depth],
  );
  const centre = model?.byPath.get(path) ?? null;
  const layout = useMemo(() => layoutFor(path), [path]);
  const order = useMemo(
    () =>
      model && shown
        ? shown.nodes
            .filter((i) => i !== centre)
            .sort(
              (a, b) =>
                byName(model.nodes[a]!.title, model.nodes[b]!.title) ||
                byName(model.nodes[a]!.path, model.nodes[b]!.path),
            )
        : [],
    [model, shown, centre],
  );

  const choose = (d: 1 | 2) => {
    writeDepth(d);
    setDepth(d);
  };
  const open = (i: number) => model && navigate(entryUrl(model.nodes[i]!.path));

  if (!model) {
    return (
      <div className="local-graph">
        {data.loading && <Progress label="Loading the graph" />}
        {data.error ? (
          <Problem reason={data.error} onRetry={data.retry} />
        ) : (
          <p className="muted local-graph-note">Loading the graph…</p>
        )}
      </div>
    );
  }

  // The selection may have left with a change of depth or a refetch.
  const current = selected !== null && shown?.has[selected] ? selected : null;
  const node = current !== null ? model.nodes[current]! : null;
  return (
    <div className="local-graph">
      {data.loading && <Progress label="Loading the graph again" />}
      <div className="local-graph-bar">
        <div className="local-graph-depth" role="group" aria-label="Depth">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              className="quiet"
              aria-pressed={depth === d}
              onClick={() => choose(d)}
            >
              Depth {d}
            </button>
          ))}
        </div>
        <Link to={fullGraphUrl(path)} className="local-graph-full">
          Open in full graph
        </Link>
      </div>
      {!shown || centre === null ? (
        <p className="muted local-graph-note">
          This entry is not in the graph. A deleted entry has no place in it.
        </p>
      ) : (
        <>
          <div className="local-graph-frame">
            <GraphCanvas
              // A new depth is fitted again once it has settled.
              key={depth}
              model={model}
              shown={shown}
              layout={layout}
              centre={centre}
              selected={current}
              onSelect={setSelected}
              onOpen={open}
              arrival={ARRIVAL}
              label={describeLocal(model.nodes[centre]!.title, order.length)}
            />
            {node && (
              <SelectionCard
                node={node}
                colour={folderColour(colourNameOf(model, node), theme)}
                keys={false}
                onOpen={() => open(current!)}
                onClear={() => setSelected(null)}
              />
            )}
          </div>
          {order.length === 0 ? (
            <p className="muted local-graph-note">
              No other entry links here, nor is linked from here.
            </p>
          ) : (
            <ul className="local-graph-list" aria-label="Neighbours">
              {order.map((i) => {
                const n = model.nodes[i]!;
                return (
                  <li key={n.path}>
                    <Link to={entryUrl(n.path)} className="local-graph-link">
                      <span className="local-graph-name">{n.title}</span>
                      <span className="local-graph-folder">
                        {n.folder || "Top level"}
                        {n.unpublished && " · unpublished"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {current !== null ? describeNode(model, shown, current) : ""}
          </p>
        </>
      )}
    </div>
  );
}

const describeLocal = (title: string, neighbours: number) =>
  `Graph of ${title} and ${neighbours} ${neighbours === 1 ? "neighbour" : "neighbours"}. ` +
  "The list below names them.";
