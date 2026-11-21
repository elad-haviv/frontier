/**
 * The parts of a chronicle file this package reads, written out here as plain shapes so the
 * package depends on nothing else in the workspace. The schema package's types have the same
 * shape, and extra keys on any item are ignored.
 */

/** The author's words plus a lowest and a highest value, in years. */
export interface Rough {
  readonly words: string;
  readonly low: number;
  readonly high: number;
}

/** A length also says whose clock it was counted on and, when typed as a count, of which unit. */
export interface RoughLength extends Rough {
  readonly clock: string;
  readonly unit?: string | undefined;
  readonly count?: readonly [number, number] | undefined;
}

/** A stored start or end: a rough number, "open", or null when the author gave none. */
export type End = Rough | "open" | null;

export interface Span {
  readonly id: string;
  readonly lane: string;
  readonly name: string;
  /** True for an event: a single moment with a start and no length. */
  readonly point: boolean;
  readonly start: End;
  readonly end: End;
  readonly length: RoughLength | null;
}

export interface Relation {
  readonly id: string;
  readonly a: string;
  /** A string, not a closed list: a kind this version does not know is kept and not checked. */
  readonly kind: string;
  readonly b: string;
}

export interface Unit {
  readonly id: string;
  readonly name: string;
  readonly low: number;
  readonly high: number;
}

export interface Lane {
  readonly id: string;
}

/** What the order and the checks are worked out from. */
export interface ChronicleInput {
  readonly lanes: readonly Lane[];
  readonly spans: readonly Span[];
  readonly relations: readonly Relation[];
}

/** A lowest and a highest value in years. Either may be infinite for an open end. */
export interface Range {
  readonly lo: number;
  readonly hi: number;
}

/** Which number of a span is meant. */
export type Part = "start" | "end" | "length";
