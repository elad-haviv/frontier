/**
 * Real-world cases the author can lay beside his own spans as rulers. Each figure is looked up
 * in a published source and the author accepts the list case by case before a case is added
 * here. None is produced by a model. Cases appear in Compare only and never enter a check.
 */
export interface ShippedCase {
  readonly id: string;
  readonly name: string;
  /** In Earth years. */
  readonly low: number;
  readonly high: number;
  /** What starts the clock and what stops it. */
  readonly from: string;
  readonly to: string;
  /** The work, with the place in it. */
  readonly source: string;
  /** A short quotation from the source that supports the figure. */
  readonly quotation: string;
  readonly caveat: string;
  /** The date the source was checked, as YYYY-MM-DD. */
  readonly checked: string;
}

export const SHIPPED_CASES: readonly ShippedCase[] = [];
