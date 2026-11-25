import "./ResumeLine.css";

/**
 * How far below the top of the page area a heading counts as reached: just past the sticky line.
 * The same measure the sticky line uses to say where the reader is.
 */
const LINE = 72;

/**
 * The heading the reader has reached at the page area's present scroll position: the last
 * heading of the entry's text above the line, or null above the first.
 */
export function headingAt(area: HTMLElement): string | null {
  const line = area.getBoundingClientRect().top + LINE;
  let reached: string | null = null;
  for (const h of area.querySelectorAll<HTMLElement>(".prose h1, .prose h2, .prose h3")) {
    if (h.getBoundingClientRect().top <= line) reached = (h.textContent ?? "").trim() || null;
  }
  return reached;
}

/**
 * The thin line that says the page opened where reading stopped, with a way back to the top. It
 * sticks under the bar at the top of the page, so it is in view where the page opened.
 */
export function ResumeLine({
  heading,
  onTop,
}: {
  /** The heading the page opened under; null when it opened above the first. */
  heading: string | null;
  onTop: () => void;
}) {
  return (
    <p className="resume-line" role="status">
      <span className="resume-text">
        Back where you stopped{heading ? <>, under “{heading}”</> : ""}.
      </span>
      <button type="button" className="plain resume-top" onClick={onTop}>
        Start from the top
      </button>
    </p>
  );
}
