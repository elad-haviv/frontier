import type { Relation } from "./types.js";

/** The kinds of relation this version knows. Any other kind is kept and not checked. */
export const KINDS = [
  "after",
  "before",
  "during",
  "starts_with",
  "ends_with",
  "overlaps",
  "longer_than",
  "shorter_than",
] as const;

export type Kind = (typeof KINDS)[number];

/** The kinds that are tested. `before` and `shorter_than` are tested as their opposites. */
export type TestedKind = Exclude<Kind, "before" | "shorter_than">;

export function isKind(kind: string): kind is Kind {
  return (KINDS as readonly string[]).includes(kind);
}

/** A relation as it is tested: `a` and `b` are exchanged for `before` and `shorter_than`. */
export interface Tested {
  readonly kind: TestedKind;
  readonly a: string;
  readonly b: string;
}

/** The relation as it is tested, or null for a kind this version does not know. */
export function asTested(relation: Pick<Relation, "a" | "kind" | "b">): Tested | null {
  const { kind, a, b } = relation;
  if (!isKind(kind)) return null;
  if (kind === "before") return { kind: "after", a: b, b: a };
  if (kind === "shorter_than") return { kind: "longer_than", a: b, b: a };
  return { kind, a, b };
}
