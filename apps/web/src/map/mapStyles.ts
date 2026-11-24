/**
 * How a path or zone is drawn, from its style and its layer: the precedence of stage 13 §9. A
 * feature's style counts only when it is in the styles file and is for the feature's kind;
 * otherwise the feature is drawn as if it had none. Pure, so the overlay, the legend and the
 * samples all draw from the same answers.
 */
import {
  DASHES,
  type Dash,
  isLined,
  type MapFeature,
  type MapStyle,
  PLAIN_LOOK,
} from "@frontier/schema";

/** The colour of a line whose layer has none. */
export const INK = "#2a2420";

/** The look of one path or zone. */
export interface Paint {
  colour: string;
  /** In pixels. */
  width: number;
  /** The canvas dash pattern, already scaled by the width; empty for a solid line. */
  dash: number[];
  /** Dashes have butt caps, so a short dash keeps its gaps; solid lines have round ones. */
  cap: "round" | "butt";
  /** How strongly a zone is filled; 0 for a path. */
  fill: number;
  /** The style it is drawn in, or null for the plain look. */
  style: MapStyle | null;
}

/** The style a feature is drawn in: its own when it exists and is for its kind, else none. */
export function styleOf(feature: MapFeature, styles: readonly MapStyle[]): MapStyle | null {
  const id = !isLined(feature) ? undefined : feature.style;
  if (!id) return null;
  return styles.find((s) => s.id === id && s.for === feature.kind) ?? null;
}

/**
 * What the feature's tab says of its style: none chosen, one that is drawn, or one that names no
 * style of its kind any more ("Style: deleted").
 */
export function styleState(
  feature: MapFeature,
  styles: readonly MapStyle[],
): "none" | "found" | "deleted" {
  if (!isLined(feature) || !feature.style) return "none";
  return styleOf(feature, styles) ? "found" : "deleted";
}

/** A dash pattern for a line of this width: the pattern's units are widths. */
export const dashOf = (dash: Dash, width: number): number[] => DASHES[dash].map((n) => n * width);

/** The look of a path or zone: the style's, else the layer's colour and the plain look. */
export function paintOf(
  feature: MapFeature,
  layerColour: string | undefined,
  styles: readonly MapStyle[],
): Paint {
  const kind = feature.kind === "zone" ? "zone" : "path";
  const style = styleOf(feature, styles);
  const plain = PLAIN_LOOK[kind];
  const width = style?.width ?? plain.width;
  const dash = dashOf(style?.dash ?? plain.dash, width);
  return {
    colour: style?.color ?? layerColour ?? INK,
    width,
    dash,
    cap: dash.length > 0 ? "butt" : "round",
    fill: kind === "zone" ? (style?.fill ?? PLAIN_LOOK.zone.fill) : 0,
    style,
  };
}

/** The paper casing under a path: wider than its line, so it reads on any image. */
export const casingOf = (width: number): number => width + 3;

/** The accent drawn under a selected path (a casing) or zone (an outline), and at half strength for the hover. */
export const selectionOf = (kind: "path" | "zone", width: number): number =>
  kind === "path" ? width + 6 : width + 2;

/**
 * The second stroke an undated line gets, over the line in its own look: narrower, in the paper
 * colour, dotted, so the line looks perforated. Dots are one width long and two widths apart.
 */
export function undatedOf(width: number): { width: number; dash: number[] } {
  return { width: Math.max(1, width / 2), dash: [width, width * 2] };
}

/** A zone's fill as the two hex digits of its strength, drawn stronger while it is selected. */
export function fillAlpha(fill: number, picked: boolean): string {
  const strength = Math.min(1, picked ? fill + 2 / 15 : fill);
  return Math.round(strength * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * The legend: each style used by a feature drawn now, path styles first, then zone styles, each
 * in the order of the styles file. `drawn` holds the features in shown layers, present now.
 */
export function legendOf(drawn: readonly MapFeature[], styles: readonly MapStyle[]): MapStyle[] {
  const used = new Set<string>();
  for (const f of drawn) {
    const style = styleOf(f, styles);
    if (style) used.add(style.id);
  }
  const inUse = styles.filter((s) => used.has(s.id));
  return [...inUse.filter((s) => s.for === "path"), ...inUse.filter((s) => s.for === "zone")];
}

/** The styles of one kind, in the file's order, for a list or a choice. */
export const stylesFor = (styles: readonly MapStyle[], kind: MapStyle["for"]): MapStyle[] =>
  styles.filter((s) => s.for === kind);

/**
 * A name for a new style of a kind that no style of that kind has yet: "Path style", then
 * "Path style 2" and so on.
 */
export function freshName(styles: readonly MapStyle[], kind: MapStyle["for"]): string {
  const base = kind === "path" ? "Path style" : "Zone style";
  const taken = new Set(stylesFor(styles, kind).map((s) => s.name.trim().toLocaleLowerCase()));
  let n = 1;
  while (taken.has((n === 1 ? base : `${base} ${n}`).toLocaleLowerCase())) n++;
  return n === 1 ? base : `${base} ${n}`;
}

/** A feature with this style, or none: a missing key means no style. */
export function withStyle(feature: MapFeature, style: string | null): MapFeature {
  if (!isLined(feature)) return feature;
  const next = { ...feature } as MapFeature & { style?: string };
  if (style) next.style = style;
  else delete next.style;
  return next;
}
