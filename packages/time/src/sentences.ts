import type { Check } from "./checks.js";
import { asTested, type Kind } from "./kinds.js";
import type { Part, Relation, Span } from "./types.js";

const SAYS: Record<Kind, string> = {
  after: "is after",
  before: "is before",
  during: "is during",
  starts_with: "starts with",
  ends_with: "ends with",
  overlaps: "overlaps",
  longer_than: "is longer than",
  shorter_than: "is shorter than",
};

export interface SentenceInput {
  readonly spans: readonly Span[];
  readonly relations: readonly Relation[];
}

/** How a span is named in a sentence. A view may pass its own, such as a linked entry's title. */
export type NameOf = (span: Span) => string;

const plainName: NameOf = (span) => span.name || "(unnamed)";

// Numbers are shown as typed, without the long tails binary fractions leave behind.
function show(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** The author's statement in words: "A is after B". */
export function statementOf(
  relation: Pick<Relation, "a" | "kind" | "b">,
  spans: readonly Span[],
  nameOf: NameOf = plainName,
): string {
  const name = (id: string): string => {
    const span = spans.find((s) => s.id === id);
    return span ? nameOf(span) : "(removed)";
  };
  const says = (SAYS as Record<string, string | undefined>)[relation.kind] ?? relation.kind;
  return `${name(relation.a)} ${says} ${name(relation.b)}`;
}

const A_PART: Record<Part, string> = { start: "a start", end: "an end", length: "a length" };

/**
 * The sentence shown for a relation's state. The design gives none for a relation that holds,
 * so that returns null.
 */
export function sentenceFor(
  check: Check,
  input: SentenceInput,
  nameOf: NameOf = plainName,
): string | null {
  const { relation } = check;
  const byId = (id: string): Span | undefined => input.spans.find((s) => s.id === id);
  const name = (id: string): string => {
    const span = byId(id);
    return span ? nameOf(span) : "(removed)";
  };
  const statement = statementOf(relation, input.spans, nameOf);

  switch (check.state) {
    case "holds":
      return null;
    case "broken":
      return "This names a span that was removed.";
    case "not_checked":
      // The design gives no sentence for this state.
      return "This kind of statement is not checked by this version.";
    case "contradicts": {
      const listed = check.circle
        .map((id) => input.relations.find((r) => r.id === id))
        .filter((r) => r !== undefined)
        .map((r) => statementOf(r, input.spans, nameOf));
      return `These statements go in a circle: ${listed.join("; ")}.`;
    }
    case "cannot_tell": {
      const missing = check.missing;
      if (!missing) return "To check this, give both spans their numbers.";
      // A span with an open start or end has no length, and typing one would not give it one.
      if (missing.open) {
        return `This cannot be checked while ${name(missing.span)} has an open start or end.`;
      }
      return `To check this, give ${name(missing.span)} ${A_PART[missing.part]}.`;
    }
    case "may_not_fit": {
      const d = check.deciding;
      if (!d) return `${statement} only if your ranges are narrower.`;
      const near = d.toward === "low" ? d.range.lo : d.range.hi;
      const far = d.toward === "low" ? d.range.hi : d.range.lo;
      if (d.part === "length") {
        return `${statement} only if ${name(d.span)} is nearer ${show(near)} years than ${show(far)}.`;
      }
      let verb = d.part === "start" ? "begins" : "ends";
      if (byId(d.span)?.point) verb = "is";
      return `${statement} only if ${name(d.span)} ${verb} nearer year ${show(near)} than year ${show(far)}.`;
    }
    case "does_not_fit": {
      // The fact is told about the spans as they were tested (exchanged for `before` and
      // `shorter_than`); what he said is told in his own direction.
      const tested = asTested(relation);
      if (!tested) return null;
      const a = name(tested.a);
      const b = name(tested.b);
      switch (tested.kind) {
        case "after":
          return `${a} begins before ${b} has ended; you said ${statement}.`;
        case "during":
          return check.longer
            ? `${a} is longer than ${b}; you said ${statement}.`
            : `${a} is not inside ${b}; you said ${statement}.`;
        case "starts_with":
          return `${a} and ${b} do not begin together; you said they do.`;
        case "ends_with":
          return `${a} and ${b} do not end together; you said they do.`;
        case "overlaps":
          return `${a} and ${b} do not overlap; you said they do.`;
        case "longer_than":
          return relation.kind === "shorter_than"
            ? `${name(relation.a)} is longer than ${name(relation.b)}; you said it is shorter.`
            : `${a} is shorter than ${b}; you said it is longer.`;
      }
    }
  }
}
