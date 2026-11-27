/**
 * The graph screen: every entry as a dot coloured by its folder, every link as a line. Hover
 * shows an entry's opening, a click selects it, Enter or a second tap opens it. The Entries tab
 * and the find field are the keyboard's and screen reader's way in; the Filters tab chooses the
 * top-level folders shown.
 */
import { OfflineCopy } from "../components/OfflineCopy.tsx";
import { List, Maximize, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "../nav.tsx";
import { entryUrl } from "../api.ts";
import { usePageTitle, usePanel, useRightBar } from "../components/shell/panels.tsx";
import { IconButton } from "../components/ui/IconButton.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { colourNameOf, folderColour, useTheme } from "../graph/colours.ts";
import { useGraphData } from "../graph/data.ts";
import { EntriesPanel } from "../graph/EntriesPanel.tsx";
import { FiltersPanel } from "../graph/FiltersPanel.tsx";
import { FindField } from "../graph/FindField.tsx";
import { GraphCanvas, type GraphCanvasHandle } from "../graph/GraphCanvas.tsx";
import { Layout } from "../graph/layout.ts";
import { describeNode, emptyReason, filterGraph, tickedFolders } from "../graph/model.ts";
import type { FlatView } from "../graph/pointer.ts";
import { readView, writeView } from "../graph/settings.ts";
import { SelectionCard } from "../graph/SelectionCard.tsx";
import { useShortcut } from "../keys.ts";
import "./Graph.css";

/** Kept for the visit: the laid-out picture, and the folders ticked and unticked. */
const layout = new Layout();
const choices = new Map<string, boolean>();

const ZOOM_STEP = 1.4;

/**
 * Whether the graph's Enter and Esc may act: not while a button, a link, a field or a side-bar
 * panel has the focus, which handle the key themselves.
 */
const graphHasKeys = () =>
  !document.activeElement?.closest(
    "button, a, input, textarea, select, [role=listbox], .right-bar, .bottom-sheet",
  );

export function GraphPage() {
  const data = useGraphData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const bar = useRightBar();
  const theme = useTheme();
  const [ticks, setTicks] = useState(() => new Map(choices));
  const canvas = useRef<GraphCanvasHandle>(null);
  const find = useRef<HTMLInputElement>(null);
  const { model } = data;

  const ticked = useMemo(
    () => (model ? tickedFolders(model, ticks) : new Set<string>()),
    [model, ticks],
  );
  const shown = useMemo(() => (model ? filterGraph(model, ticked) : null), [model, ticked]);
  const focusPath = params.get("focus");
  const wanted = model && focusPath !== null ? (model.byPath.get(focusPath) ?? null) : null;
  const selected = wanted !== null && shown?.has[wanted] ? wanted : null;

  // Where the canvas opens: the entry in the address, else the view left in this session.
  const arrival = useRef<{ focus: number | null; view: FlatView | null } | null>(null);
  if (model && arrival.current === null) arrival.current = { focus: wanted, view: readView() };

  const select = (i: number | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (i === null || !model) next.delete("focus");
        else next.set("focus", model.nodes[i]!.path);
        return next;
      },
      { replace: true },
    );
  const selectAndCentre = (i: number) => {
    select(i);
    canvas.current?.centre(i);
  };
  const open = (i: number) => model && navigate(entryUrl(model.nodes[i]!.path));
  const tick = (folder: string, on: boolean) => {
    choices.set(folder, on);
    setTicks(new Map(choices));
  };
  const tickAll = () => {
    for (const f of model?.folders ?? []) choices.set(f.path, true);
    setTicks(new Map(choices));
  };

  useShortcut("graph.find", () => find.current?.focus(), model !== null);
  useShortcut(
    "graph.open",
    () => {
      if (selected === null || !graphHasKeys()) return false;
      open(selected);
    },
    model !== null,
  );
  useShortcut(
    "graph.clear",
    () => {
      if (selected === null || !graphHasKeys()) return false;
      select(null);
    },
    model !== null,
  );
  useShortcut("graph.fit", () => canvas.current?.fit(), model !== null);
  useShortcut("graph.zoomIn", () => canvas.current?.zoom(ZOOM_STEP), model !== null);
  useShortcut("graph.zoomOut", () => canvas.current?.zoom(1 / ZOOM_STEP), model !== null);

  usePanel(
    model && shown
      ? {
          id: "entries",
          title: "Entries",
          icon: List,
          render: () => (
            <EntriesPanel
              model={model}
              shown={shown}
              selected={selected}
              onSelect={selectAndCentre}
              onOpen={open}
            />
          ),
        }
      : null,
  );
  usePanel(
    model
      ? {
          id: "filters",
          title: "Filters",
          icon: SlidersHorizontal,
          render: () => <FiltersPanel model={model} ticked={ticked} theme={theme} onTick={tick} />,
        }
      : null,
  );
  usePageTitle(
    "Graph",
    model ? (
      <IconButton
        label="Filters"
        icon={SlidersHorizontal}
        size="sm"
        className="graph-phone-filters"
        aria-pressed={bar.open === "filters"}
        onClick={() => bar.toggle("filters")}
      />
    ) : undefined,
  );

  if (!model || !shown) {
    return (
      <div className="graph-page">
        {data.loading && <Progress label="Loading the graph" />}
        {data.error ? (
          <div className="graph-message">
            <Problem reason={data.error} onRetry={data.retry} />
          </div>
        ) : (
          <p className="center muted">Loading the graph…</p>
        )}
      </div>
    );
  }

  const empty = emptyReason(model, shown);
  const node = selected !== null ? model.nodes[selected]! : null;
  return (
    <div className="graph-page">
      {data.loading && <Progress label="Loading the graph again" />}
      <div className="graph-frame">
        <OfflineCopy at={data.at ?? null} className="graph-offline" />
        {empty ? (
          <Empty reason={empty} onTickAll={tickAll} />
        ) : (
          <GraphCanvas
            ref={canvas}
            model={model}
            shown={shown}
            layout={layout}
            selected={selected}
            onSelect={select}
            onOpen={open}
            arrival={arrival.current!}
            onViewSettled={writeView}
            label={describeGraph(shown.nodes.length, shown.edges.length)}
          />
        )}
        <div className="graph-tools">
          <FindField
            model={model}
            shown={shown}
            inputRef={find}
            onChoose={(i) => {
              selectAndCentre(i);
              canvas.current?.focus();
            }}
            onLeave={() => canvas.current?.focus()}
          />
          <div className="graph-zoom" role="group" aria-label="Zoom">
            <IconButton
              label="Zoom in"
              icon={ZoomIn}
              shortcut="graph.zoomIn"
              onClick={() => canvas.current?.zoom(ZOOM_STEP)}
            />
            <IconButton
              label="Zoom out"
              icon={ZoomOut}
              shortcut="graph.zoomOut"
              onClick={() => canvas.current?.zoom(1 / ZOOM_STEP)}
            />
            <IconButton
              label="Fit the graph"
              icon={Maximize}
              shortcut="graph.fit"
              onClick={() => canvas.current?.fit()}
            />
          </div>
        </div>
        <div className="graph-panel-buttons">
          <IconButton
            label="Entries"
            icon={List}
            showLabel
            aria-pressed={bar.open === "entries"}
            onClick={() => bar.toggle("entries")}
          />
          <IconButton
            label="Filters"
            icon={SlidersHorizontal}
            showLabel
            aria-pressed={bar.open === "filters"}
            onClick={() => bar.toggle("filters")}
          />
        </div>
        {node && (
          <SelectionCard
            node={node}
            colour={folderColour(colourNameOf(model, node), theme)}
            onOpen={() => open(selected!)}
            onClear={() => select(null)}
          />
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {selected !== null ? describeNode(model, shown, selected) : ""}
      </p>
    </div>
  );
}

const describeGraph = (nodes: number, edges: number) =>
  `Graph of ${nodes.toLocaleString("en")} ${nodes === 1 ? "entry" : "entries"} and ` +
  `${edges.toLocaleString("en")} ${edges === 1 ? "link" : "links"}. The Entries tab lists them.`;

/** Nothing is shown: an empty library, or every folder unticked. */
function Empty({
  reason,
  onTickAll,
}: {
  reason: NonNullable<ReturnType<typeof emptyReason>>;
  onTickAll: () => void;
}) {
  return (
    <div className="graph-message graph-empty">
      <h2>Nothing to show</h2>
      {reason === "empty" ? (
        <p className="muted">The library has no entries yet.</p>
      ) : (
        <>
          <p className="muted">Every folder is unticked in Filters.</p>
          <button type="button" className="quiet" onClick={onTickAll}>
            Tick all folders
          </button>
        </>
      )}
    </div>
  );
}
