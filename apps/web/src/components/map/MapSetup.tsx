import type { MapFile } from "@frontier/schema";
import { useId } from "react";
import { lies, type OtherMap } from "../../map/layersBeneath.ts";
import { Combobox } from "../ui/Combobox.tsx";
import { mapOptions } from "./FeatureEditor.tsx";

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
  const label = useId();
  return (
    <div className="map-setup">
      <h3>This map</h3>
      {map.space.kind === "sphere" && (
        <div className="field">
          <span aria-hidden="true">Lies under</span>
          <span id={label} className="sr-only">
            This map lies under
          </span>
          <Combobox
            labelledBy={label}
            // A map cannot lie under one that lies under it.
            options={mapOptions(
              otherMaps.filter((m) => m.space.kind === "sphere" && !lies(id, m.id, otherMaps)),
              "Nothing: it is a world of its own",
            )}
            value={map.under ?? ""}
            onChange={(under) => {
              const next = { ...map } as MapFile;
              delete next.under;
              onChange(under ? { ...next, under } : next);
            }}
            findLabel="Find a map"
            empty="No globe has that name."
          />
        </div>
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
