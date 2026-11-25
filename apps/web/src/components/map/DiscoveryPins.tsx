import { makeView, type ViewState } from "@frontier/geo";
import type { Discovery } from "../../api.ts";
import type { useDiscovery } from "../../map/useDiscovery.ts";
import type { SpotKind } from "../../map/spots/spots.ts";
import { DiscoveryCard } from "../DiscoveryCard.tsx";
import { SPOT_ICONS } from "./Explore.tsx";

/** The "?" pins of what discovery proposed, where they are on the screen. */
export function DiscoveryPins({
  items,
  view,
  size,
  open,
  onOpen,
}: {
  items: Discovery[];
  view: ViewState;
  size: { width: number; height: number };
  /** The proposal whose card is open. */
  open: string | null;
  onOpen: (id: string) => void;
}) {
  return items.map((d) => {
    const at = makeView(view, size.width, size.height).project(d.at);
    if (!at || at[0] < -20 || at[1] < -20 || at[0] > size.width + 20 || at[1] > size.height + 20) {
      return null;
    }
    return (
      <button
        key={d.id}
        type="button"
        className={"discovery-pin" + (open === d.id ? " is-open" : "")}
        style={{ left: at[0], top: at[1] }}
        aria-label={`Proposed ${d.kind}: ${d.name}`}
        onClick={() => onOpen(d.id)}
      >
        ?
      </button>
    );
  });
}

/** The card of the proposal opened from its pin. Keeping it takes it off the pins. */
export function OpenDiscovery({
  map,
  discovery,
  onKept,
}: {
  map: string;
  discovery: ReturnType<typeof useDiscovery>;
  /** Called once a proposal is kept as a new entry with a marker. */
  onKept: (path: string) => void;
}) {
  const { found, setFound, openFound, setOpenFound } = discovery;
  const index = found.items.findIndex((d) => d.id === openFound);
  if (!openFound || index < 0) return null;
  const d = found.items[index]!;
  const Icon = d.spot && d.spot.kind in SPOT_ICONS ? SPOT_ICONS[d.spot.kind as SpotKind] : null;
  return (
    <DiscoveryCard
      key={openFound}
      map={map}
      discovery={d}
      step={{
        index,
        count: found.items.length,
        go: (by) =>
          setOpenFound(found.items[(index + by + found.items.length) % found.items.length]!.id),
      }}
      whereIcon={Icon ? <Icon size={14} aria-hidden /> : null}
      canArt={found.art}
      folders={found.folders}
      onChanged={(d) =>
        setFound((f) => ({ ...f, items: f.items.map((x) => (x.id === d.id ? d : x)) }))
      }
      onKept={(path) => {
        setFound((f) => ({ ...f, items: f.items.filter((x) => x.id !== openFound) }));
        setOpenFound(null);
        onKept(path);
      }}
      onDropped={() => {
        setFound((f) => ({ ...f, items: f.items.filter((x) => x.id !== openFound) }));
        setOpenFound(null);
      }}
      onClose={() => setOpenFound(null)}
    />
  );
}
