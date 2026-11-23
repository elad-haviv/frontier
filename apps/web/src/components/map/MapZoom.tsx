/** The zoom buttons in the corner of the map. */
export function MapZoom({
  onZoom,
  onWhole,
}: {
  onZoom: (factor: number) => void;
  onWhole: () => void;
}) {
  return (
    <div className="map-zoom">
      <button type="button" aria-label="Zoom in" onClick={() => onZoom(1.6)}>
        +
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => onZoom(1 / 1.6)}>
        −
      </button>
      <button type="button" aria-label="Show the whole map" onClick={onWhole}>
        ⤢
      </button>
    </div>
  );
}
