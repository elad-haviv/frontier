import { Maximize2, Minus, Plus } from "lucide-react";
import { IconButton } from "../ui/IconButton.tsx";

/** The zoom buttons in the corner of the map, each with its name and key in a tooltip. */
export function MapZoom({
  onZoom,
  onWhole,
}: {
  onZoom: (factor: number) => void;
  onWhole: () => void;
}) {
  return (
    <div className="map-zoom">
      <IconButton
        label="Zoom in"
        icon={Plus}
        shortcut="map.zoomIn"
        tipSide="left"
        onClick={() => onZoom(1.6)}
      />
      <IconButton
        label="Zoom out"
        icon={Minus}
        shortcut="map.zoomOut"
        tipSide="left"
        onClick={() => onZoom(1 / 1.6)}
      />
      <IconButton
        label="Show the whole map"
        icon={Maximize2}
        shortcut="map.fit"
        tipSide="left"
        onClick={onWhole}
      />
    </div>
  );
}
