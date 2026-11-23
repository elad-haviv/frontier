import "./OutlinePanel.css";

/** One line of the outline. */
export interface OutlineItem {
  level: number;
  text: string;
}

/**
 * A heading as written in Markdown, as the reader would see it: emphasis, code and link marks
 * left out, a link shown by its words.
 */
export function plainHeading(text: string): string {
  return (
    text
      .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target: string, label?: string) =>
        (label ?? target).replace(/#.*$/, ""),
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?u>/g, "")
      // A lone "_" is often part of a name, so only doubled ones are taken for marks.
      .replace(/(\*\*|__|~~|\*|`)/g, "")
      .trim()
  );
}

/**
 * The Outline tab: the entry's headings, levels 1 to 3, with the one the reader has reached
 * marked. Choosing one goes there. The entry page finds the headings in the drawn text; the
 * editor in the document, with the cursor's line as the one reached.
 */
export function OutlinePanel({
  items,
  current,
  onChoose,
}: {
  items: OutlineItem[];
  /** The index of the heading reached, or -1 before the first. */
  current: number;
  onChoose: (index: number) => void;
}) {
  const shown = items.map((h, i) => ({ ...h, i })).filter((h) => h.level <= 3);
  if (shown.length === 0) {
    return <p className="muted outline-empty">This entry has no headings yet.</p>;
  }
  // A deeper heading reached marks the level-3-or-higher heading it falls under.
  const marked = shown.findLast((h) => h.i <= current)?.i ?? -1;
  return (
    <nav className="outline-panel" aria-label="Outline">
      <ul>
        {shown.map((h) => (
          <li key={h.i} className={`outline-item outline-level-${h.level}`}>
            <button
              type="button"
              className="outline-link"
              aria-current={h.i === marked ? "location" : undefined}
              onClick={() => onChoose(h.i)}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
