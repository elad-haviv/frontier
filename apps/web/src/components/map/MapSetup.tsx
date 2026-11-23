import type { MapFile } from "@frontier/schema";
import { lies, type OtherMap } from "../../map/layersBeneath.ts";

/** A flat space with measuring on again. */
function withoutSchematic(space: MapFile["space"]): MapFile["space"] {
  const next: Record<string, unknown> = { ...space };
  delete next.schematic;
  return next as MapFile["space"];
}

/** The map's own settings while editing: what it lies under, and whether it is schematic. */
export function MapSetup({
  id,
  map,
  otherMaps,
  onChange,
}: {
  id: string;
  map: MapFile;
  otherMaps: OtherMap[];
  onChange: (next: MapFile) => void;
}) {
  const schematic = map.space.kind === "flat" && map.space.schematic === true;
  return (
    <div className="map-setup">
      <h3>This map</h3>
      {map.space.kind === "sphere" && (
        <label className="field">
          <span>Lies under</span>
          <select
            aria-label="This map lies under"
            value={map.under ?? ""}
            onChange={(e) => {
              const next = { ...map } as MapFile;
              delete next.under;
              onChange(e.target.value ? { ...next, under: e.target.value } : next);
            }}
          >
            <option value="">Nothing: it is a world of its own</option>
            {otherMaps
              .filter((m) => m.space.kind === "sphere" && !lies(id, m.id, otherMaps))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {map.space.kind === "flat" && (
        <label className="check">
          <input
            type="checkbox"
            checked={schematic}
            onChange={(e) =>
              map.space.kind === "flat" &&
              onChange({
                ...map,
                space: e.target.checked
                  ? { ...map.space, schematic: true }
                  : withoutSchematic(map.space),
              })
            }
          />{" "}
          Schematic: a diagram, with no measuring
        </label>
      )}
    </div>
  );
}
