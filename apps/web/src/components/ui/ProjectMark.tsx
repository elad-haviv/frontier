import { PROJECT_COLOURS } from "@frontier/schema";
import "./ProjectMark.css";

/** The letter a project is marked with: the first letter or digit of its name, in capitals. */
export function letterOf(name: string): string {
  const first = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c));
  return (first ?? "?").toUpperCase();
}

/**
 * A project's mark: its letter on one of eight colours. It says nothing by itself (the name is
 * always beside it, or in the tooltip of a lone mark), so it is hidden from screen readers.
 */
export function ProjectMark({
  name,
  colour,
  size = "md",
}: {
  name: string;
  colour: number;
  size?: "sm" | "md" | "lg";
}) {
  const c = ((Math.trunc(colour) % PROJECT_COLOURS) + PROJECT_COLOURS) % PROJECT_COLOURS;
  return (
    <span className={`ui-project-mark ui-project-mark-${size} c${c}`} aria-hidden="true">
      {letterOf(name)}
    </span>
  );
}
