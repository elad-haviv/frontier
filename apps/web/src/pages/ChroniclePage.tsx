import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type ChronicleFile, mergeChronicles } from "@frontier/schema";
import { api, ApiFailure, chronicleUrl } from "../api.ts";
import { CompareView } from "../components/chronicle/CompareView.tsx";
import { Flags, redCount } from "../components/chronicle/Flags.tsx";
import { LaneList, UnitList } from "../components/chronicle/Lists.tsx";
import { OrderView } from "../components/chronicle/OrderView.tsx";
import { ScaleView } from "../components/chronicle/ScaleView.tsx";
import { ShiftForm } from "../components/chronicle/ShiftForm.tsx";
import { SpanForm } from "../components/chronicle/SpanForm.tsx";
import { newSpan, spanName, work } from "../components/chronicle/model.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useItemFile } from "../hooks/useItemFile.ts";

type Tab = "order" | "scale" | "compare" | "flags" | "setup";

const NARROW = "(max-width: 34rem)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const on = () => setNarrow(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return narrow;
}

const SAVING: Record<string, string> = {
  saved: "Saved as a draft",
  waiting: "Saving…",
  saving: "Saving…",
  failed: "Not saved",
};

/** One chronicle: its views, its lists, and the form for the selected span. */
export function ChroniclePage() {
  const { id = "" } = useParams();
  // A different chronicle gets a fresh page, with its own saving loop and undo history.
  return <Chronicle key={id} id={id} />;
}

function Chronicle({ id }: { id: string }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const dialogs = useDialogs();
  const narrow = useNarrow();
  const [tab, setTab] = useState<Tab>("order");
  const [selected, setSelected] = useState<string | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const file = useItemFile<ChronicleFile>({
    load: async () => {
      const loaded = await api.chronicle(id);
      return { value: loaded.chronicle, revision: loaded.revision };
    },
    save: async (value, revision) => {
      const saved = await api.saveChronicle(id, value, revision);
      return { value: saved.chronicle, revision: saved.revision };
    },
    merge: (base, mine, theirs) => mergeChronicles(base, mine, theirs).chronicle,
    onSaved: refresh,
  });
  const chronicle = file.value;
  const worked = useMemo(() => (chronicle ? work(chronicle) : null), [chronicle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) file.redo();
      else file.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file.undo, file.redo]);

  if (file.state === "loading") return <p className="center muted">Opening the chronicle…</p>;
  if (file.state === "failed" || !chronicle || !worked) {
    return (
      <div className="center">
        <p className="error">{file.error ?? "The chronicle could not be opened."}</p>
        <p>
          <Link to="/chronicles">All chronicles</Link>
        </p>
      </div>
    );
  }

  const span = chronicle.spans.find((s) => s.id === selected) ?? null;
  const openLane =
    chronicle.lanes.find((l) => l.id === lane)?.id ??
    chronicle.lanes.find((l) => chronicle.spans.some((s) => s.lane === l.id))?.id ??
    chronicle.lanes[0]!.id;
  const red = redCount(worked);

  const select = (next: string | null) => {
    setSelected(next);
    const to = chronicle.spans.find((s) => s.id === next);
    if (to) setLane(to.lane);
  };

  async function add(point: boolean) {
    const name = await dialogs.prompt({
      title: point ? "New event" : "New span",
      body: point
        ? "A single moment, such as a landing or a death."
        : "Something with a beginning and an end, such as a war or a people's presence.",
      label: "Name",
      action: "Add",
    });
    if (!name?.trim()) return;
    const made = newSpan(openLane, point, name.trim());
    file.change((c) => ({ ...c, spans: [...c.spans, made] }));
    setSelected(made.id);
    setTab((t) => (t === "setup" ? "order" : t));
  }

  async function rename() {
    const title = await dialogs.prompt({
      title: "Rename the chronicle",
      label: "Title",
      initial: chronicle!.title,
      action: "Rename",
    });
    if (title?.trim()) file.change((c) => ({ ...c, title: title.trim() }));
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: `Delete ${chronicle!.title}?`,
      body: "It is marked for deletion and goes when you save a version. Until then it can be brought back from the unsaved changes.",
      action: "Delete the chronicle",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteChronicle(id);
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be deleted.");
      return;
    }
    refresh();
    navigate("/chronicles");
  }

  async function copy() {
    try {
      const made = await api.copyChronicle(id);
      refresh();
      navigate(chronicleUrl(made.id));
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be copied.");
    }
  }

  async function makeMain() {
    try {
      await api.makeMainChronicle(id);
      // The server wrote the mark itself, so the page takes in what the server now holds.
      await file.reload();
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "It could not be made the main one.");
    }
  }

  const tabs: [Tab, string][] = [
    ["order", "Order"],
    ["scale", "Scale"],
    ["compare", "Compare"],
    ["flags", red > 0 ? `Does not fit (${red})` : "Does not fit"],
    ["setup", narrow ? "Set up" : "Lanes and units"],
  ];

  return (
    <div className={"ch-page" + (span ? " has-form" : "") + (span && folded ? " is-folded" : "")}>
      <header className="ch-bar">
        <Link to="/chronicles" className="map-back" aria-label="All chronicles">
          ←
        </Link>
        <h1>{chronicle.title}</h1>
        {chronicle.main && <span className="chip">main</span>}
        <span
          className={"ch-saving" + (file.saving === "failed" ? " error" : " muted")}
          role="status"
        >
          {SAVING[file.saving]}
        </span>
      </header>
      {notice && (
        <p className="banner" role="alert">
          {notice}{" "}
          <button type="button" className="plain" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {file.saving === "failed" && file.error && (
        <p className="banner" role="alert">
          {file.error}
        </p>
      )}

      <div className="ch-tools" role="toolbar" aria-label="Chronicle tools">
        <button type="button" className="primary" onClick={() => void add(false)}>
          + Span
        </button>
        <button type="button" className="primary" onClick={() => void add(true)}>
          + Event
        </button>
        <button
          type="button"
          className="quiet ch-icon"
          aria-label="Undo"
          disabled={!file.canUndo}
          onClick={file.undo}
        >
          <span aria-hidden="true">↶</span>
          <span className="ch-wide">Undo</span>
        </button>
        <button
          type="button"
          className="quiet ch-icon"
          aria-label="Redo"
          disabled={!file.canRedo}
          onClick={file.redo}
        >
          <span aria-hidden="true">↷</span>
          <span className="ch-wide">Redo</span>
        </button>
        <details className="ch-more">
          <summary>More</summary>
          <div>
            <button type="button" className="quiet" onClick={() => void rename()}>
              Rename
            </button>
            <button type="button" className="quiet" onClick={() => void copy()}>
              Copy, to try another version
            </button>
            {!chronicle.main && (
              <button type="button" className="quiet" onClick={() => void makeMain()}>
                Make this the main chronicle
              </button>
            )}
            <button type="button" className="plain danger" onClick={() => void remove()}>
              Delete the chronicle
            </button>
          </div>
        </details>
      </div>

      <div className="ch-tabs" role="tablist" aria-label="Views">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={(tab === key ? "is-on" : "") + (key === "flags" && red > 0 ? " is-red" : "")}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ch-body">
        <div className="ch-view">
          {tab === "order" && (
            <OrderView
              chronicle={chronicle}
              worked={worked}
              selected={selected}
              onSelect={select}
              narrow={narrow}
              openLane={openLane}
              onOpenLane={setLane}
            />
          )}
          {tab === "scale" && (
            <>
              <ScaleView
                chronicle={chronicle}
                worked={worked}
                selected={selected}
                onSelect={select}
                narrow={narrow}
                openLane={openLane}
                onOpenLane={setLane}
              />
              <ShiftForm chronicle={chronicle} change={file.change} />
            </>
          )}
          {tab === "compare" && (
            <CompareView
              chronicle={chronicle}
              worked={worked}
              change={file.change}
              onSelect={select}
            />
          )}
          {tab === "flags" && (
            <Flags chronicle={chronicle} worked={worked} change={file.change} onSelect={select} />
          )}
          {tab === "setup" && (
            <>
              <LaneList chronicle={chronicle} change={file.change} />
              <UnitList chronicle={chronicle} change={file.change} />
            </>
          )}
          <p className="ch-note muted">
            Working numbers, not lore. Nothing here is written into a note.
          </p>
        </div>

        {span && (
          <aside className="ch-sheet" aria-label={`${spanName(span)}: details`}>
            <header>
              <h2>{spanName(span)}</h2>
              {narrow && (
                <button
                  type="button"
                  className="quiet"
                  aria-expanded={!folded}
                  onClick={() => setFolded(!folded)}
                >
                  {folded ? "Edit" : "Fold"}
                </button>
              )}
              <button type="button" className="quiet" onClick={() => setSelected(null)}>
                Close
              </button>
            </header>
            <SpanForm
              key={span.id}
              chronicle={chronicle}
              worked={worked}
              span={span}
              change={file.change}
              onSelect={select}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
