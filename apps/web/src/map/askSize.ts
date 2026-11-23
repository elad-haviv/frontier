/** Asks for the size of a map: the radius of a world, or the scale from a measured line. */
import { type Position, scaleFrom } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import type { useDialogs } from "../components/Dialogs.tsx";

/**
 * The map with its new radius or scale, or null when nothing changes. `measured` is the line just
 * measured on a flat map, when there is one.
 */
export async function askSize(
  map: MapFile,
  measured: Position[] | null,
  dialogs: ReturnType<typeof useDialogs>,
): Promise<MapFile | null> {
  if (map.space.kind === "sphere") {
    const answer = await dialogs.prompt({
      title: "The size of this world",
      body: "Give the radius to see distances as well as angles. Leave it empty when it is not known.",
      label: `Radius in ${map.space.unit}`,
      initial: map.space.radius === null ? "" : String(map.space.radius),
      inputMode: "decimal",
      action: "Set the radius",
    });
    if (answer === null) return null;
    const radius = answer.trim() === "" ? null : Number(answer);
    if (radius !== null && !(radius > 0)) return null;
    return { ...map, space: { ...map.space, radius } };
  } else if (measured) {
    const answer = await dialogs.prompt({
      title: "Set the scale from this line",
      body: "Say how long the line you measured really is. Distances on this map follow from it.",
      label: `Length in ${map.space.unit}`,
      inputMode: "decimal",
      action: "Set the scale",
    });
    const scale = answer ? scaleFrom(measured, Number(answer)) : null;
    if (scale) return { ...map, space: { ...map.space, scale } };
  }
  return null;
}
