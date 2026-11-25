import { Layers3, Pencil, Trash2, SquarePen, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { mapUrl } from "../../api.ts";
import {
  deckDepth,
  inStack,
  KIND_WORD,
  type MapRow,
  metaText,
  stackText,
  stateText,
} from "../../map/mapsList.ts";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Icon } from "../ui/Icon.tsx";
import { MapArt } from "./MapArt.tsx";
import { isDark } from "./KindPictures.tsx";

export interface MapActions {
  onEdit: (row: MapRow) => void;
  onStack: (row: MapRow) => void;
  onRename: (row: MapRow) => void;
  onDelete: (row: MapRow) => void;
  /** Why renaming and deleting are not possible now, such as no connection; undefined when they are. */
  offline: string | undefined;
}

/** The title with the letters that were searched for marked. */
export function Marked({ text, query }: { text: string; query: string }): ReactNode {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** The state of a map as a dot and words, never colour alone. Nothing for a published map. */
function StateMark({ row, short = false }: { row: MapRow; short?: boolean }) {
  if (row.state === "published") return <span className="state">&nbsp;</span>;
  return (
    <span className="state">
      <span className={`dot ${row.state === "new" ? "hollow" : "solid"}`} aria-hidden="true" />
      <span className={short ? "state-words short" : "state-words"}>{stateText(row.state)}</span>
    </span>
  );
}

/** The ⋯ menu of a map: open it, edit it, see its layers stacked, rename it, delete it. */
export function MapMenu({
  row,
  rows,
  actions,
}: {
  row: MapRow;
  rows: MapRow[];
  actions: MapActions;
}) {
  const navigate = useNavigate();
  const stacked = row.kind === "sphere" && inStack(row.id, rows);
  return (
    <Menu label={`Actions for ${row.title}`} className="map-more">
      <MenuItem icon={ExternalLink} onSelect={() => navigate(mapUrl(row.id))}>
        Open
      </MenuItem>
      <MenuItem icon={SquarePen} onSelect={() => actions.onEdit(row)}>
        Edit
      </MenuItem>
      {stacked && (
        <MenuItem icon={Layers3} onSelect={() => actions.onStack(row)}>
          Layers stacked
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        icon={Pencil}
        disabled={actions.offline !== undefined}
        disabledReason={actions.offline}
        onSelect={() => actions.onRename(row)}
      >
        Rename…
      </MenuItem>
      <MenuItem
        icon={Trash2}
        danger
        disabled={actions.offline !== undefined}
        disabledReason={actions.offline}
        onSelect={() => actions.onDelete(row)}
      >
        Delete…
      </MenuItem>
    </Menu>
  );
}

/**
 * One map as one card. A map that has maps lying under it is drawn as a deck, with sheets behind
 * it; that is how it looks only, since every map still has a card of its own. The whole card is
 * the link that opens the map; the ⋯ button is a second stop.
 */
export function MapCard({
  row,
  rows,
  query,
  actions,
}: {
  row: MapRow;
  rows: MapRow[];
  query: string;
  actions: MapActions;
}) {
  const depth = deckDepth(row.id, rows);
  const stack = stackText(row, rows);
  return (
    <li className={`map-card${depth ? ` deck deck-${depth}` : ""}`}>
      <div className="map-face">
        <span className={`map-thumb${isDark(row.kind) ? " dark" : ""}`}>
          <MapArt row={row} />
          <span className="map-badge">{KIND_WORD[row.kind]}</span>
        </span>
        <div className="map-body">
          <h3>
            <Link to={mapUrl(row.id)} className="map-link" data-map={row.id}>
              <Marked text={row.title} query={query} />
            </Link>
          </h3>
          <span className="map-meta">{metaText(row)}</span>
          {stack && <span className="map-meta">{stack}</span>}
          <StateMark row={row} />
        </div>
      </div>
      <MapMenu row={row} rows={rows} actions={actions} />
    </li>
  );
}

/** One map as one row of the list, with the same facts as its card. */
export function MapRowItem({
  row,
  rows,
  query,
  actions,
}: {
  row: MapRow;
  rows: MapRow[];
  query: string;
  actions: MapActions;
}) {
  const stack = stackText(row, rows);
  return (
    <li className="map-row">
      <span className={`map-thumb${isDark(row.kind) ? " dark" : ""}`}>
        <MapArt row={row} />
      </span>
      <div className="map-row-name">
        <h3>
          <Link to={mapUrl(row.id)} className="map-link" data-map={row.id}>
            <Marked text={row.title} query={query} />
          </Link>
          {deckDepth(row.id, rows) > 0 && (
            <span className="map-layers" title={stack} role="img" aria-label={stack}>
              <Icon icon={Layers3} size="sm" />
            </span>
          )}
        </h3>
        <span className="map-sub">
          {KIND_WORD[row.kind]} · {metaText(row)}
          {stack ? ` · ${stack}` : ""}
        </span>
      </div>
      <span className="map-kind-cell">{KIND_WORD[row.kind]}</span>
      <span className="map-features">{row.features}</span>
      <span className="map-state-cell">
        <StateMark row={row} />
        {row.state === "published" && <span className="state">Published</span>}
      </span>
      <MapMenu row={row} rows={rows} actions={actions} />
    </li>
  );
}
