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

export const SHIPPED_CASES: readonly ShippedCase[] = [
  {
    id: "living-memory",
    name: "Living memory",
    low: 80,
    high: 100,
    from: "an event witnessed by living people",
    to: "the point where no one remains who heard of it in ordinary conversation",
    source:
      "Jan Assmann, “Collective Memory and Cultural Identity”, trans. John Czaplicka, New German Critique 65, 1995, p. 127",
    quotation:
      "this horizon does not extend more than eighty to (at the very most) one hundred years into the past, which equals three or four generations or the Latin saeculum.",
    caveat:
      "A generalisation from oral-history studies, not a measurement. It limits informal, everyday memory only: what is given a fixed form, as ritual, text or monument, is not bound by it.",
    checked: "2026-11-21",
  },
  {
    id: "norse-greenland",
    name: "Norse Greenland, settlement to abandonment",
    low: 420,
    high: 470,
    from: "the Norse settlement of Greenland, about 985 CE",
    to: "the last reliable record in 1408, or the abandonment of the Eastern Settlement in the mid-15th century",
    source:
      "Marisa Borreggine et al., “Sea-level rise in Southwest Greenland as a contributor to Viking abandonment”, PNAS 120(17), 2023, Significance statement",
    quotation: "Vikings occupied Greenland from 985 CE to the mid-15th century.",
    caveat:
      "A small, remote colony that ended; it did not forget where it came from. The year 1408 is from a second source of which only the sentence was seen. The smaller Western Settlement ended about 1350.",
    checked: "2026-11-21",
  },
  {
    id: "hebrew",
    name: "Hebrew without native speakers",
    low: 1650,
    high: 1700,
    from: "the end of Hebrew as an everyday spoken language, about 200 CE",
    to: "its revival as a mother tongue, 1881–82",
    source: "Chaim Rabin, A Short History of the Hebrew Language, 1973 (page not confirmed)",
    quotation:
      "Hebrew ceased to be spoken about two generations later, around 200 C.E., after the completion of the Mishnah",
    caveat:
      "Kept, not lost: Hebrew never stopped being read, prayed and written. The end date is what histories generally assume. Only the quoted sentence of the source was seen, not the page around it.",
    checked: "2026-11-21",
  },
];
