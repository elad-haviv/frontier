import {
  type Biome,
  biomeById,
  type MapFeature,
  type MapStyle,
  RIVER_WORDS,
  speedsText,
} from "@frontier/schema";
import { useId } from "react";
import { styleForBiome, withBiome, withPattern } from "../../map/biomes.ts";
import { styleOf } from "../../map/mapStyles.ts";
import { useBiomes } from "../../map/useBiomes.ts";
import { useMapStyles } from "../../map/useMapStyles.ts";
import { BiomePicker } from "./BiomePicker.tsx";

/** "On foot 0.6× · horse 0.55× · cart 0.35× · rivers lose water and can dry out". */
export function biomeMeaning(b: Biome): string {
  return `${speedsText(b.speed)} · ${RIVER_WORDS[b.rivers]}`;
}

/** What Explore is told of the land in a zone of this biome: "sand desert (in the Tharn Desert)". */
export function exploreLine(b: Biome, label: string | null): string {
  const named = label?.trim();
  return `The land here: ${b.explore}${named ? ` (${named})` : ""}; ${RIVER_WORDS[b.rivers]}.`;
}

/**
 * The style a zone gets when a biome is chosen for it: kept when it has one there is, else the
 * biome's usual style, which is added to the library first when it is not there yet.
 */
export function useBiomeStyle(): (
  zone: MapFeature,
  biome: string | null,
) => { feature: MapFeature; add: MapStyle | null } {
  const { styles } = useMapStyles();
  const { custom } = useBiomes();
  return (zone, id) => {
    let next = withBiome(zone, id);
    const biome = biomeById(id, custom);
    if (!biome || zone.kind !== "zone" || styleOf(zone, styles))
      return { feature: next, add: null };
    const { style, missing } = styleForBiome(biome, styles, null);
    next = { ...next, style } as MapFeature;
    return { feature: next, add: missing };
  };
}

/**
 * A zone's biome in its Edit tab: the picker, whether its pattern is drawn, and what the biome
 * means (the speeds, the rivers, Explore's words), which a phone has no hover tag to show.
 */
export function BiomeFields({
  feature,
  onChange,
}: {
  feature: Extract<MapFeature, { kind: "zone" }>;
  onChange: (next: MapFeature) => void;
}) {
  const id = useId();
  const { custom } = useBiomes();
  const { change: changeStyles } = useMapStyles();
  const styled = useBiomeStyle();
  const biome = biomeById(feature.biome, custom);
  const gone = !!feature.biome && !biome;
  return (
    <div className="field feature-biome">
      <span id={`${id}-biome`}>Biome</span>
      {gone && <em className="muted style-deleted">Biome: deleted</em>}
      <BiomePicker
        value={biome?.id ?? null}
        custom={custom}
        onChange={(next) => {
          const { feature: done, add } = styled(feature, next);
          if (add) void changeStyles((f) => ({ ...f, styles: [...f.styles, add] }));
          onChange(done);
        }}
      />
      {biome && (
        <>
          <label className="biome-pattern-check">
            <input
              type="checkbox"
              checked={feature.pattern !== false}
              onChange={(e) => onChange(withPattern(feature, e.target.checked))}
            />{" "}
            Draw its pattern
          </label>
          <p className="muted biome-meaning">{biomeMeaning(biome)}</p>
          <p className="muted biome-explore">{exploreLine(biome, feature.label)}</p>
        </>
      )}
    </div>
  );
}
