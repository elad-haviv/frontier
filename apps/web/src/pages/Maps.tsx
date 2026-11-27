import { Globe2, Grid2x2, List, Plus, Search, X } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "../nav.tsx";
import { api, mapUrl } from "../api.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { MapArt } from "../components/maps/MapArt.tsx";
import { isDark, KIND_PICTURES } from "../components/maps/KindPictures.tsx";
import { type MapActions, MapCard, MapRowItem } from "../components/maps/MapItems.tsx";
import { NewMapDialog } from "../components/maps/NewMapDialog.tsx";
import { useCanWrite } from "../components/projectContext.ts";
import { useRefresh } from "../components/Shell.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useScope, useShortcut } from "../keys.ts";
import {
  byKind,
  counts,
  defaultView,
  filterAndSort,
  isFiltered,
  type Kind,
  KIND_CHIP,
  KIND_PLURAL,
  KIND_WORD,
  KINDS,
  type MapRow,
  metaText,
  NO_FILTERS,
  recentMaps,
  rowOf,
  savedView,
  saveView,
  type Sort,
  toolsFor,
} from "../map/mapsList.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { failureOf, useAsync } from "../useAsync.ts";
import "./Maps.css";
import { projectWork } from "../projectWork.ts";

/**
 * The library of maps (stage 23). Each map is one card with a picture; a map that has maps lying
 * under it is drawn as a deck, which is only how it looks. The page grows into its tools: nothing
 * but cards for a few maps, then search and sort, then filters and the maps opened last. New map
 * is a dialog, so the page is always the library and never a form.
 */
export function MapsPage() {
  const maps = useAsync(() => api.maps(), "maps");
  const navigate = useNavigate();
  const refresh = useRefresh();
  const dialogs = useDialogs();
  const offline = useNeedsConnection();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort] = useState<Sort | null>(null);
  const [view, setView] = useState<"grid" | "list" | null>(() => savedView());
  const [making, setMaking] = useState<Kind | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => (maps.state === "ready" ? maps.value.maps.map(rowOf) : []), [maps]);
  const hasEdits = rows.some((r) => r.edited !== null);
  const sortNow: Sort = sort ?? (hasEdits ? "recent" : "name");
  const viewNow = view ?? defaultView(rows.length);
  const filtering = isFiltered(filters);
  const tools = toolsFor(rows.length, filtering);
  const shown = useMemo(() => filterAndSort(rows, filters, sortNow), [rows, filters, sortNow]);
  const count = counts(rows);
  const recent = useMemo(
    () => (tools.recent && !filtering ? recentMaps(rows) : []),
    [rows, tools.recent, filtering],
  );

  useScope("maps");
  useShortcut("maps.find", () => {
    if (!search.current) return false;
    search.current.focus();
  });
  // Making, editing, renaming and deleting maps are writers' (stage 31c).
  const canWrite = useCanWrite();
  useShortcut("maps.new", () => (canWrite ? setMaking("flat") : false));

  const actions: MapActions = {
    offline,
    onEdit: (r) => navigate(`${mapUrl(r.id)}?edit=1`),
    onStack: (r) => navigate(`/stack/${r.id}`),
    onRename: async (r) => {
      // The project the map is in, taken before the dialog: the person may switch while it is open.
      const work = projectWork();
      const title = await dialogs.prompt({
        title: `Rename the map "${r.title}"`,
        label: "Title",
        initial: r.title,
        action: "Rename",
      });
      if (!title?.trim() || title.trim() === r.title) return;
      // Saved like any change to a map: kept on this device until the server has it.
      const made = await work.api.map(r.id);
      await work.queue.put(
        `map:${r.id}`,
        { ...made.map, title: title.trim() },
        { draftId: "", revision: made.revision, baseBlob: made.blob, base: made.map, delay: 0 },
      );
      await work.queue.sendNow(`map:${r.id}`);
      if (!work.open()) return;
      refresh();
      maps.retry();
    },
    onDelete: async (r) => {
      const work = projectWork();
      const under = rows.filter((x) => x.under === r.id).length;
      const ok = await dialogs.confirm({
        title: `Delete the map "${r.title}"?`,
        body: `It holds ${r.features} ${r.features === 1 ? "feature" : "features"}.${
          under ? ` The ${under === 1 ? "map" : `${under} maps`} lying under it stay.` : ""
        } It is removed from the library when you save a version.`,
        action: "Delete the map",
        danger: true,
      });
      if (!ok) return;
      await work.queue.drop(`map:${r.id}`);
      await work.api.deleteMap(r.id).catch(() => undefined);
      if (!work.open()) return;
      refresh();
      maps.retry();
    },
  };

  // The arrows move between cards and rows; Enter opens the one with the focus.
  function arrows(e: KeyboardEvent<HTMLElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key) || !(e.target instanceof HTMLAnchorElement)) return;
    const links = [...(grid.current?.querySelectorAll<HTMLAnchorElement>("a.map-link") ?? [])];
    const at = links.indexOf(e.target);
    if (at < 0) return;
    // In a grid a row is as many cards as lie on one line.
    const top = links[0]?.closest("li")?.getBoundingClientRect().top;
    const perRow =
      viewNow === "grid"
        ? Math.max(
            1,
            links.filter((l) => l.closest("li")?.getBoundingClientRect().top === top).length,
          )
        : 1;
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? perRow
            : -perRow;
    if (viewNow === "list" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) return;
    const next = links[at + step];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function clearSearch() {
    setFilters({ ...filters, query: "" });
    search.current?.focus();
  }

  const unreadable = maps.state === "ready" ? maps.value.problems : [];
  const loading = maps.state === "loading";
  const groups = sortNow === "kind" && tools.groups && !filtering && viewNow === "grid";

  return (
    <article className="entry wide maps maps-page">
      <header className="maps-head">
        <h1>Maps</h1>
        {rows.length > 0 && (
          <span className="maps-count" aria-live="polite">
            {filtering
              ? `${shown.length} of ${rows.length} maps`
              : `${rows.length} ${rows.length === 1 ? "map" : "maps"}`}
          </span>
        )}
        <span className="maps-grow" />
        {tools.view && (
          <div className="maps-toggle" role="group" aria-label="View">
            {(
              [
                ["grid", "Grid of cards", Grid2x2],
                ["list", "List", List],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                aria-pressed={viewNow === v}
                aria-label={label}
                title={label}
                onClick={() => {
                  setView(v);
                  saveView(v);
                }}
              >
                <Icon size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {canWrite && (
          <Link
            to="/world"
            className="maps-world"
            aria-label="New world"
            title="Build a world step by step and get its map"
          >
            <Globe2 size={18} aria-hidden="true" />
            <span className="maps-new-label">New world…</span>
          </Link>
        )}
        {canWrite && (
          <button type="button" className="primary maps-new" onClick={() => setMaking("flat")}>
            <Plus size={18} aria-hidden="true" />
            <span className="maps-new-label">New map</span>
          </button>
        )}
      </header>
      <p className="muted lede">
        A map is drawn over an image of yours, or, for a star map or a system model, in open space.
        Its markers, paths and zones point at entries.
      </p>

      {failureOf(maps) && <Problem reason={failureOf(maps)!.message} onRetry={maps.retry} />}
      {maps.reloading && <Progress />}
      {unreadable.length > 0 && (
        <div className="maps-banner" role="alert">
          <details open>
            <summary>
              {unreadable.length} {unreadable.length === 1 ? "map" : "maps"} could not be read
            </summary>
            {unreadable.map((p) => (
              <p key={p.path}>
                {p.path} is not shown as a map. {p.message}
              </p>
            ))}
          </details>
        </div>
      )}

      {(tools.search || tools.chips) && (
        <div className="maps-tools">
          {tools.search && (
            <div className="maps-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={search}
                type="search"
                placeholder="Find a map"
                aria-label="Find a map"
                value={filters.query}
                autoComplete="off"
                onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && filters.query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilters({ ...filters, query: "" });
                  } else if (e.key === "ArrowDown") {
                    const first = grid.current?.querySelector<HTMLAnchorElement>("a.map-link");
                    if (first) {
                      e.preventDefault();
                      first.focus();
                    }
                  }
                }}
              />
              {filters.query ? (
                <button type="button" aria-label="Clear search" onClick={clearSearch}>
                  <X size={16} aria-hidden="true" />
                </button>
              ) : (
                <kbd aria-hidden="true">/</kbd>
              )}
            </div>
          )}
          {tools.chips && (
            <div className="maps-chips" role="group" aria-label="Show">
              {(["all", ...KINDS] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  aria-pressed={filters.kind === k}
                  onClick={() => setFilters({ ...filters, kind: k })}
                >
                  {k === "all" ? "All" : KIND_CHIP[k]} <small>{count[k]}</small>
                </button>
              ))}
              <span className="maps-sep" aria-hidden="true" />
              <button
                type="button"
                className="chip"
                aria-pressed={filters.needsPublishing}
                onClick={() =>
                  setFilters({ ...filters, needsPublishing: !filters.needsPublishing })
                }
              >
                Needs publishing <small>{count.needsPublishing}</small>
              </button>
            </div>
          )}
          {rows.length >= 12 && (
            <label className="maps-sort">
              Sort
              <select
                value={sortNow}
                aria-label="Sort maps"
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="recent" disabled={!hasEdits}>
                  Recently edited
                </option>
                <option value="name">Name</option>
                <option value="kind">Kind</option>
              </select>
            </label>
          )}
        </div>
      )}

      {loading && (
        <ul className="maps-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="map-card skeleton">
              <div className="map-face">
                <span className="map-thumb" />
                <div className="map-body">
                  <h3>&nbsp;</h3>
                  <span className="map-meta">&nbsp;</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {maps.state === "ready" && rows.length === 0 && (
        <div className="maps-empty">
          <div className="maps-four" aria-hidden="true">
            {KINDS.map((k) => (
              <span key={k} className={`map-thumb${isDark(k) ? " dark" : ""}`}>
                <span className={`map-art drawing${isDark(k) ? " dark" : ""}`}>
                  {KIND_PICTURES[k]}
                </span>
              </span>
            ))}
          </div>
          <h2>No maps yet</h2>
          <p>
            Draw a world over an image of yours, or place stars and planets in open space. Each
            map's markers point at entries.
          </p>
          {canWrite && (
            <button type="button" className="primary" onClick={() => setMaking("flat")}>
              <Plus size={18} aria-hidden="true" /> Make the first map
            </button>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <section className="maps-recent" aria-label="Recently opened">
          <h2>Recently opened</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={mapUrl(r.id)} className={`recent-card`}>
                  <span className={`map-thumb${isDark(r.kind) ? " dark" : ""}`}>
                    <MapArt row={r} />
                  </span>
                  <span>
                    <b>{r.title}</b>
                    <small>
                      {KIND_WORD[r.kind]} · {metaText(r).split(" · ")[1] ?? ""}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {maps.state === "ready" && rows.length > 0 && shown.length === 0 && (
        <div className="maps-none">
          <b>
            {filters.query.trim()
              ? `No map is called “${filters.query.trim()}”.`
              : "No map matches these filters."}
          </b>
          {filters.query.trim() && (filters.kind !== "all" || filters.needsPublishing) && (
            <span>A filter is on as well.</span>
          )}
          <span>
            {filters.query.trim() && (
              <button type="button" onClick={clearSearch}>
                Clear search
              </button>
            )}
            {(filters.kind !== "all" || filters.needsPublishing) && (
              <button
                type="button"
                onClick={() => setFilters({ ...filters, kind: "all", needsPublishing: false })}
              >
                Show all kinds
              </button>
            )}
          </span>
        </div>
      )}

      {shown.length > 0 && viewNow === "grid" && !groups && (
        <ul className="maps-grid" ref={grid} aria-label="Maps" onKeyDown={arrows}>
          {shown.map((r) => (
            <MapCard key={r.id} row={r} rows={rows} query={filters.query} actions={actions} />
          ))}
          {canWrite && !filtering && tools.newTile && (
            <li className="map-newtile">
              <button type="button" onClick={() => setMaking("flat")}>
                <Plus size={20} aria-hidden="true" />
                <span>New map</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {shown.length > 0 && viewNow === "grid" && groups && (
        <div ref={undefined} onKeyDown={arrows}>
          {byKind(shown).map((g) => (
            <section key={g.kind} aria-label={KIND_PLURAL[g.kind]}>
              <h2 className="maps-group">
                {KIND_PLURAL[g.kind]} <small>{g.rows.length}</small>
              </h2>
              <ul className="maps-grid" ref={g.kind === byKind(shown)[0]!.kind ? grid : undefined}>
                {g.rows.map((r) => (
                  <MapCard key={r.id} row={r} rows={rows} query={filters.query} actions={actions} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {shown.length > 0 && viewNow === "list" && (
        <div className="maps-list" onKeyDown={arrows}>
          <div className="maps-list-head" aria-hidden="true">
            <span />
            <span>Name</span>
            <span>Kind</span>
            <span>Features</span>
            <span>State</span>
            <span />
          </div>
          <ul ref={grid} aria-label="Maps">
            {shown.map((r: MapRow) => (
              <MapRowItem key={r.id} row={r} rows={rows} query={filters.query} actions={actions} />
            ))}
          </ul>
        </div>
      )}

      {making && canWrite && <NewMapDialog initialKind={making} onClose={() => setMaking(null)} />}
    </article>
  );
}
